import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Selection } from '../App';
import type { DbcDatabase } from '../lib/dbc/types';
import { occurrenceOf } from '../lib/dbc/identity';
import { decomposeJ1939Id } from '../lib/dbc/j1939';
import { useI18n, type MsgKey } from '../lib/i18n';
import { fmtNum, hexId } from '../lib/format';
import { openTraceFile, type LoadedTrace, type TraceProblemReason, type TraceSkipReason } from '../lib/trace';
import { decodeRow, replayTrace, rowMatches, traceIdHex, type Replay, type ReplayRow } from '../lib/trace/replay';
import { Icon } from './Icon';
import './trc.css';

type FrameFilter = 'all' | 'decoded' | 'unknown' | 'errors';

const PROBLEM_KEYS: Record<TraceProblemReason, MsgKey> = {
  unrecognized: 'trcProblemUnrecognized',
  badId: 'trcProblemBadId',
  badData: 'trcProblemBadData',
  lengthMismatch: 'trcProblemLengthMismatch',
  badTime: 'trcProblemBadTime',
};
const SKIP_KEYS: Record<TraceSkipReason, MsgKey> = {
  header: 'trcSkipHeader',
  comment: 'trcSkipComment',
  event: 'trcSkipEvent',
  status: 'trcSkipStatus',
  statistic: 'trcSkipStatistic',
  txRequest: 'trcSkipTxRequest',
};
const SHOWN_PROBLEMS = 100;
/** Browsers cap an element's height at a few million pixels; beyond this many rows, the filter has to narrow it down. */
const MAX_ROWS = 400_000;
const OVERSCAN = 10;

const hex = (data: Uint8Array) => [...data].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** Where the person was in a trace, so that leaving the view and coming back keeps the place. */
const remembered = new WeakMap<LoadedTrace, { query: string; filter: FrameFilter; selected: number | null; scrollTop: number }>();

/**
 * The Traces destination: a candump or Vector ASC log replayed through the
 * open database, as a table of decoded frames over time. Parsing and decoding
 * happen in this tab; the log is never sent anywhere.
 */
export function TraceView({
  db,
  fileName,
  trace,
  onTrace,
  onSelect,
}: {
  db: DbcDatabase;
  fileName: string;
  trace: LoadedTrace | null;
  onTrace: (trace: LoadedTrace | null) => void;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (file: File) => {
    setError(null);
    try {
      const loaded = await openTraceFile(file);
      if (loaded) onTrace(loaded);
      else setError(t('trcNotALog', { name: file.name }));
    } catch (e) {
      setError(t('trcReadFailed', { name: file.name, error: e instanceof Error ? e.message : String(e) }));
    }
  };
  const openDialog = () => inputRef.current?.click();

  const log = trace?.log;
  const started =
    log && log.timestamps === 'epoch' && log.frames.find((f) => f.time !== null)
      ? new Date(log.frames.find((f) => f.time !== null)!.time! * 1000).toISOString().replace('T', ' ').replace('Z', ' UTC')
      : log?.startedAt;

  return (
    <div className="trc-view" data-testid="trc-view">
      <input
        ref={inputRef}
        type="file"
        accept=".log,.asc,.txt"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="trc-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void open(file);
          e.target.value = '';
        }}
      />
      <header className="page-header split">
        <div style={{ minWidth: 0 }}>
          <div className="overline">{t('trcOverline', { file: fileName })}</div>
          <h1>{trace ? trace.name : t('trcTitle')}</h1>
          {log && (
            <div className="assist-chips">
              <span className="assist-chip">
                <Icon name="receipt_long" size={18} />
                {log.format === 'asc' ? t('trcFormatAsc') : t('trcFormatCandump')}
              </span>
              {started && <span className="assist-chip">{t('trcStarted', { when: started })}</span>}
            </div>
          )}
        </div>
        {trace && (
          <div className="trc-actions">
            <button className="btn text state" onClick={() => onTrace(null)}>
              {t('trcClose')}
            </button>
            <button className="btn outlined with-icon state" onClick={openDialog}>
              <Icon name="upload_file" size={18} />
              {t('trcOpenAnother')}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="banner error" role="alert">
          <Icon name="error" size={20} />
          <span>{error}</span>
        </div>
      )}

      {trace ? (
        <TraceBody key={trace.id} db={db} trace={trace} onSelect={onSelect} />
      ) : (
        <div className="card trc-empty">
          <h2>{t('trcEmptyTitle')}</h2>
          <p>{t('trcEmptyText', { file: fileName })}</p>
          <p className="trc-privacy">
            <Icon name="check_circle" size={18} />
            {t('trcPrivacy')}
          </p>
          <p>
            {t('trcExampleHint')} <code>examples/demo-candump.log</code>, <code>examples/demo.asc</code>
          </p>
          <div className="trc-actions">
            <button className="btn filled with-icon state" onClick={openDialog}>
              <Icon name="upload_file" size={18} />
              {t('trcOpen')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function passes(row: ReplayRow, filter: FrameFilter): boolean {
  switch (filter) {
    case 'decoded':
      return row.message !== undefined && row.frame.kind === 'data';
    case 'unknown':
      return row.message === undefined && row.frame.kind !== 'error';
    case 'errors':
      return row.frame.kind === 'error';
    default:
      return true;
  }
}

function TraceBody({ db, trace, onSelect }: { db: DbcDatabase; trace: LoadedTrace; onSelect: (s: Selection) => void }) {
  const { t } = useI18n();
  const memory = remembered.get(trace);
  const [query, setQuery] = useState(memory?.query ?? '');
  const [filter, setFilter] = useState<FrameFilter>(memory?.filter ?? 'all');
  const [selected, setSelected] = useState<number | null>(memory?.selected ?? null);
  const [scrollTop, setScrollTop] = useState(memory?.scrollTop ?? 0);
  const latest = useRef({ query, filter, selected, scrollTop });
  latest.current = { query, filter, selected, scrollTop };
  useEffect(() => () => void remembered.set(trace, latest.current), [trace]);

  const replay = useMemo(() => replayTrace(db, trace.log), [db, trace]);
  const filtered = useMemo(
    () => replay.rows.filter((r) => passes(r, filter) && rowMatches(r, query)),
    [replay, filter, query],
  );
  const rows = filtered.length > MAX_ROWS ? filtered.slice(0, MAX_ROWS) : filtered;
  const selectedRow = selected === null ? undefined : replay.rows[selected];
  const { log } = trace;

  const filters: Array<[FrameFilter, string]> = [
    ['all', t('filterAll')],
    ['decoded', t('trcFilterDecoded')],
    ['unknown', t('trcFilterUnknown')],
    ['errors', t('trcFilterErrors')],
  ];
  const skipped = (Object.entries(log.skipped) as Array<[TraceSkipReason, number]>).filter(([, n]) => n > 0);

  return (
    <>
      <Facts replay={replay} />

      {log.timestamps === 'delta' && (
        <div className="banner info">
          <Icon name="info" size={20} />
          <span>{t('trcTimesDelta')}</span>
        </div>
      )}
      {log.timestamps === 'none' && (
        <div className="banner info">
          <Icon name="info" size={20} />
          <span>{t('trcTimesNone')}</span>
        </div>
      )}
      {skipped.length > 0 && (
        <p className="trc-skipped" data-testid="trc-skipped">
          {t('trcSkippedTitle')} {skipped.map(([reason, n]) => `${n} ${t(SKIP_KEYS[reason])}`).join(' · ')}
        </p>
      )}

      <div className="trc-toolbar">
        <label className="trc-search">
          <Icon name="search" size={22} />
          <input
            type="search"
            placeholder={t('trcSearch')}
            aria-label={t('trcSearch')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query !== '' && (
            <button className="clear state" title={t('clearSearch')} aria-label={t('clearSearch')} onClick={() => setQuery('')}>
              <Icon name="close" size={20} />
            </button>
          )}
        </label>
        <div className="chips" role="radiogroup">
          {filters.map(([key, label]) => (
            <button
              key={key}
              role="radio"
              aria-checked={filter === key}
              className={`chip state ${filter === key ? 'on' : ''}`}
              onClick={() => setFilter(key)}
            >
              {filter === key && <Icon name="check" size={18} />}
              {label}
            </button>
          ))}
        </div>
        <span className="trc-count" data-testid="trc-count">
          {t('trcShownOf', { n: filtered.length, total: replay.frames })}
        </span>
      </div>
      {filtered.length > MAX_ROWS && (
        <div className="banner warn">
          <Icon name="warning" size={20} />
          <span>{t('trcTooMany', { n: MAX_ROWS })}</span>
        </div>
      )}

      <div className="trc-layout">
        <FrameTable rows={rows} selected={selected} onSelectRow={setSelected} scrollTop={scrollTop} onScroll={setScrollTop} />
        <FrameDetail db={db} row={selectedRow} onSelect={onSelect} />
      </div>

      {log.problems.length > 0 && (
        <div className="card table-card trc-problems" style={{ marginTop: 16 }} data-testid="trc-problems">
          <h2>{t('trcProblemsTitle', { n: log.problems.length })}</h2>
          <div className="card-note">{t('trcProblemsHint')}</div>
          <table className="m3">
            <thead>
              <tr>
                <th className="num">{t('thLine')}</th>
                <th>{t('thReason')}</th>
                <th>{t('thContent')}</th>
              </tr>
            </thead>
            <tbody>
              {log.problems.slice(0, SHOWN_PROBLEMS).map((p) => (
                <tr key={p.line}>
                  <td className="num">{p.line}</td>
                  <td className="nowrap">{t(PROBLEM_KEYS[p.reason])}</td>
                  <td className="mono wrap-anywhere">{p.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {log.problems.length > SHOWN_PROBLEMS && (
            <div className="card-note">{t('trcMoreProblems', { n: log.problems.length - SHOWN_PROBLEMS })}</div>
          )}
        </div>
      )}
    </>
  );
}

function Facts({ replay }: { replay: Replay }) {
  const { t } = useI18n();
  const facts: Array<[string, string]> = [
    [t('trcFactFrames'), String(replay.frames)],
    [t('trcFactDuration'), replay.duration === null ? '—' : t('trcSeconds', { n: replay.duration.toFixed(3) })],
    [t('trcFactIds'), String(replay.ids)],
    [t('trcFactDecoded'), t('trcDecodedOf', { n: replay.matchedFrames, total: replay.frames })],
    [t('trcFactUnknown'), String(replay.unknownIds)],
  ];
  return (
    <div className="facts" data-testid="trc-facts">
      {facts.map(([k, v]) => (
        <div className="fact" key={k}>
          <div className="k">{k}</div>
          <div className="v" title={v}>
            {v}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One line of decoded signals for the table: the active ones, with their unit or value description. */
const summaries = new WeakMap<ReplayRow, string>();
function summary(row: ReplayRow): string {
  let text = summaries.get(row);
  if (text === undefined) {
    const decoded = decodeRow(row) ?? [];
    text = decoded
      .filter((d) => d.active)
      .map((d) => `${d.signal.name} ${fmtNum(d.physical)}${d.signal.unit ? ` ${d.signal.unit}` : ''}${d.label ? ` (${d.label})` : ''}`)
      .join(' · ');
    summaries.set(row, text);
  }
  return text;
}

/**
 * The frames as a table that renders only the rows in view, so that logs
 * with hundreds of thousands of frames stay quick. ↑/↓, Page Up/Down, Home
 * and End move the selection while the table has the focus.
 */
function FrameTable({
  rows,
  selected,
  onSelectRow,
  scrollTop,
  onScroll,
}: {
  rows: ReplayRow[];
  selected: number | null;
  onSelectRow: (index: number) => void;
  scrollTop: number;
  onScroll: (top: number) => void;
}) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);
  const [height, setHeight] = useState(600);
  const [rowHeight, setRowHeight] = useState(37);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    el.scrollTop = scrollTop;
    setHeight(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
    // On mount only: restore the remembered scroll position and start watching the size.
  }, []);
  // Rows are as high as the styles make them; measure one rather than assume.
  useLayoutEffect(() => {
    const row = viewport.current?.querySelector<HTMLTableRowElement>('tr[data-row]');
    const measured = row?.getBoundingClientRect().height;
    if (measured && Math.abs(measured - rowHeight) > 0.5) setRowHeight(measured);
  });

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN);
  const visible = rows.slice(first, last);

  const scrollIntoView = (position: number) => {
    const el = viewport.current;
    if (!el) return;
    const headHeight = head.current?.getBoundingClientRect().height ?? 0;
    const top = position * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight + headHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight + headHeight - el.clientHeight;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const position = selected === null ? -1 : rows.findIndex((r) => r.index === selected);
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    let next: number;
    switch (e.key) {
      case 'ArrowDown':
        next = position + 1;
        break;
      case 'ArrowUp':
        next = position < 0 ? 0 : position - 1;
        break;
      case 'PageDown':
        next = position + page;
        break;
      case 'PageUp':
        next = position - page;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = rows.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    next = Math.min(rows.length - 1, Math.max(0, next));
    onSelectRow(rows[next].index);
    scrollIntoView(next);
  };

  return (
    <div className="card trc-table-card">
      <div
        ref={viewport}
        className="trc-viewport"
        tabIndex={0}
        role="region"
        aria-label={t('trcTableLabel')}
        onScroll={(e) => onScroll(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
        data-testid="trc-viewport"
      >
        <table className="m3 trc-table">
          <colgroup>
            <col style={{ width: 104 }} />
            <col style={{ width: 76 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 48 }} />
            <col style={{ width: 212 }} />
            <col style={{ width: 148 }} />
            <col />
          </colgroup>
          <thead ref={head}>
            <tr>
              <th className="num">{t('trcThTime')}</th>
              <th className="num">{t('trcThDelta')}</th>
              <th>{t('trcThChannel')}</th>
              <th>{t('thId')}</th>
              <th className="num">{t('trcThLen')}</th>
              <th>{t('trcThData')}</th>
              <th>{t('thMessage')}</th>
              <th>{t('thSignals')}</th>
            </tr>
          </thead>
          <tbody>
            {first > 0 && (
              <tr aria-hidden="true">
                <td className="trc-spacer" colSpan={8} style={{ height: first * rowHeight }} />
              </tr>
            )}
            {visible.map((row) => (
              <FrameRow key={row.index} row={row} selected={row.index === selected} onSelect={onSelectRow} />
            ))}
            {last < rows.length && (
              <tr aria-hidden="true">
                <td className="trc-spacer" colSpan={8} style={{ height: (rows.length - last) * rowHeight }} />
              </tr>
            )}
          </tbody>
        </table>
        {rows.length === 0 && <div className="card-note" style={{ paddingTop: 16 }}>{t('trcNoMatch')}</div>}
      </div>
    </div>
  );
}

function FrameRow({ row, selected, onSelect }: { row: ReplayRow; selected: boolean; onSelect: (index: number) => void }) {
  const { t } = useI18n();
  const { frame } = row;
  const data =
    frame.kind === 'remote' ? t('trcKindRemote') : frame.kind === 'error' && frame.data.length === 0 ? t('trcKindError') : hex(frame.data);
  return (
    <tr
      data-row={row.index}
      data-testid="trc-row"
      className={`clickable ${selected ? 'selected' : ''}`}
      aria-selected={selected}
      onClick={() => onSelect(row.index)}
    >
      <td className="num" title={t('trcDetailFrame', { n: row.index + 1, line: frame.line })}>
        {row.time === null ? '—' : row.time.toFixed(6)}
      </td>
      <td className="num">{row.delta === null ? '—' : (row.delta * 1000).toFixed(3)}</td>
      <td>
        {frame.channel}
        {frame.direction && <span className="trc-muted"> · {frame.direction === 'rx' ? 'Rx' : 'Tx'}</span>}
      </td>
      <td className="id">{frame.kind === 'error' ? '—' : traceIdHex(frame)}</td>
      <td className="num">{frame.kind === 'remote' ? (frame.dlc ?? '—') : frame.data.length}</td>
      <td className={frame.kind === 'data' || frame.data.length > 0 ? 'trc-data' : 'trc-muted'} title={hex(frame.data)}>
        {data}
        {frame.isFd && <span className="tag trc-tag">FD</span>}
      </td>
      <td title={row.message?.name}>
        {frame.kind === 'error' ? (
          <span className="trc-muted">{t('trcKindError')}</span>
        ) : row.message ? (
          <>
            {row.message.name}
            {row.matchedBy === 'pgn' && <span className="tag trc-tag">{t('trcByPgn')}</span>}
          </>
        ) : (
          <span className="trc-muted">{t('trcUnknownId')}</span>
        )}
      </td>
      <td className="trc-signals" title={summary(row)}>
        {summary(row)}
      </td>
    </tr>
  );
}

function FrameDetail({ db, row, onSelect }: { db: DbcDatabase; row?: ReplayRow; onSelect: (s: Selection) => void }) {
  const { t } = useI18n();
  if (!row) {
    return (
      <div className="card trc-detail muted" data-testid="trc-detail">
        {t('trcDetailHint')}
      </div>
    );
  }
  const { frame, message } = row;
  const decoded = decodeRow(row);
  const open = (signal?: string) =>
    message && onSelect({ kind: 'message', rawId: message.rawId, occ: occurrenceOf(db, message), signal });
  const title =
    frame.kind === 'error' ? t('trcKindError') : message ? message.name : `${hexId(frame.id, frame.isExtended)}`;

  const notes: string[] = [];
  if (frame.kind === 'error') notes.push(t('trcErrorNote'));
  else if (frame.kind === 'remote') notes.push(t('trcRemoteNote'));
  if (frame.kind !== 'error' && !message) notes.push(t('trcUnknownNote'));
  if (message && row.matchedBy === 'pgn') {
    const pgn = decomposeJ1939Id(frame.id).pgn;
    notes.push(t('trcPgnNote', { pgn: `${pgn} (0x${pgn.toString(16).toUpperCase()})`, id: hexId(message.id, true) }));
  }
  if (message && frame.kind === 'data' && frame.data.length !== message.dlc) {
    notes.push(t('trcLengthNote', { n: frame.data.length, m: message.dlc }));
  }

  const facts: Array<[string, string]> = [
    [t('trcThTime'), row.time === null ? '—' : row.time.toFixed(6)],
    [t('trcThDelta'), row.delta === null ? '—' : (row.delta * 1000).toFixed(3)],
    [t('trcThChannel'), frame.channel + (frame.direction ? ` · ${frame.direction === 'rx' ? 'Rx' : 'Tx'}` : '')],
    [t('thId'), frame.kind === 'error' ? `0x${frame.id.toString(16).toUpperCase()}` : hexId(frame.id, frame.isExtended)],
    [t('trcThLen'), frame.kind === 'remote' ? String(frame.dlc ?? '—') : t('factDlcValue', { n: frame.data.length })],
    ['CAN FD', frame.isFd ? [frame.brs ? 'BRS' : '', frame.esi ? 'ESI' : ''].filter(Boolean).join(' · ') || '✓' : '—'],
  ];

  return (
    <div className="card signal-card trc-detail" data-testid="trc-detail">
      <div className="card-overline">{t('trcDetailFrame', { n: row.index + 1, line: frame.line })}</div>
      <h2 className="signal-title">{title}</h2>
      <div className="kv-grid">
        {facts.map(([k, v]) => (
          <div className="kv" key={k}>
            <div className="k">{k}</div>
            <div className="v mono">{v}</div>
          </div>
        ))}
      </div>
      {frame.data.length > 0 && <p className="trc-hex">{hex(frame.data)}</p>}
      {notes.map((note) => (
        <div key={note} className="banner info">
          <Icon name="info" size={20} />
          <span>{note}</span>
        </div>
      ))}
      {decoded && decoded.length > 0 && (
        <div className="decoded" data-testid="trc-detail-signals">
          {decoded.map(({ signal, raw, physical, label, active }, i) => (
            <div
              key={`${signal.name}#${i}`}
              className={`decoded-row ${active ? '' : 'inactive'}`}
              title={`${t('thRaw')} ${fmtNum(raw)}`}
              onClick={() => open(signal.name)}
            >
              <span className="name">{signal.name}</span>
              <span className="value">{active ? `${fmtNum(physical)}${signal.unit ? ` ${signal.unit}` : ''}` : '—'}</span>
              <span className="extra">{active ? label ?? '' : t('muxInactive')}</span>
            </div>
          ))}
        </div>
      )}
      {message && (
        <div className="trc-actions">
          <button className="btn tonal with-icon state" onClick={() => open()}>
            <Icon name="chevron_right" size={18} />
            {t('trcOpenMessage')}
          </button>
        </div>
      )}
    </div>
  );
}
