// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DbcMessage } from '../lib/dbc/types';
import { useI18n, type MsgKey } from '../lib/i18n';
import { fmtNum, muxLabel } from '../lib/format';
import { activateProps } from '../lib/keyboard';
import {
  SIGNAL_COLUMNS,
  compileFilter,
  hasActiveFilter,
  nextSort,
  signalRows,
  type SignalColumn,
  type SignalFilters,
  type SignalSort,
} from '../lib/signal-table';
import { signalNumber, signalTone } from './BitMatrix';
import { Icon } from './Icon';
import './SignalTable.css';

export interface SignalTableState {
  sort: SignalSort | null;
  filters: SignalFilters;
  filtersOpen: boolean;
}

const LABEL_KEYS: Record<SignalColumn, MsgKey | undefined> = {
  name: 'thName',
  mux: 'thMux',
  startBit: 'thStart',
  length: 'thLength',
  byteOrder: 'thByteOrder',
  valueType: 'thType',
  factor: 'thFactor',
  offset: 'thOffset',
  min: undefined,
  max: undefined,
  unit: 'thUnit',
  receivers: 'thReceivers',
};

/**
 * The signal table of a message, with sortable and filterable columns.
 *
 * Each header is a button: a click sorts ascending, the next descending, the
 * third returns to file order; the header carries aria-sort while it sorts.
 * The filter row under the headers opens from the card's Filter button.
 * Sort and filters stay when another message is shown, like the list search.
 */
export function SignalTable({
  message,
  selectedSignal,
  onToggleSignal,
  initial,
}: {
  message: DbcMessage;
  selectedSignal?: string;
  onToggleSignal: (name: string) => void;
  /** Starting sort and filters (the default is file order, unfiltered, filters closed). */
  initial?: Partial<SignalTableState>;
}) {
  const { t, lang } = useI18n();
  const [sort, setSort] = useState<SignalSort | null>(initial?.sort ?? null);
  const [filters, setFilters] = useState<SignalFilters>(initial?.filters ?? {});
  const [filtersOpen, setFiltersOpen] = useState(initial?.filtersOpen ?? false);
  // Screen readers hear the order and count only after the user changed them.
  const [announce, setAnnounce] = useState(false);
  const focusFirstFilter = useRef(false);
  const firstFilter = useRef<HTMLInputElement>(null);
  const id = useId();

  const label = (column: SignalColumn) => {
    const key = LABEL_KEYS[column];
    return key ? t(key) : column === 'min' ? 'Min' : 'Max';
  };

  const rows = useMemo(() => signalRows(message.signals, sort, filters, lang), [message, sort, filters, lang]);
  const invalid = useMemo(
    () => SIGNAL_COLUMNS.filter((c) => !compileFilter(c.key, filters[c.key] ?? '').valid).map((c) => c.key),
    [filters],
  );
  const filtered = hasActiveFilter(filters);

  useEffect(() => {
    if (filtersOpen && focusFirstFilter.current) firstFilter.current?.focus();
    focusFirstFilter.current = false;
  }, [filtersOpen]);

  const sortBy = (column: SignalColumn) => {
    setSort(nextSort(sort, column));
    setAnnounce(true);
  };
  const setFilter = (column: SignalColumn, text: string) => {
    setFilters((f) => ({ ...f, [column]: text }));
    setAnnounce(true);
  };
  const clearFilters = () => {
    setFilters({});
    setAnnounce(true);
  };
  /** The Clear filters buttons disappear once clicked: keep the focus in the filter row. */
  const clearFiltersAndRefocus = () => {
    clearFilters();
    firstFilter.current?.focus();
  };
  const toggleFilters = () => {
    // Closing the row also drops its filters: hidden filters would hide signals unnoticed.
    if (filtersOpen) clearFilters();
    else focusFirstFilter.current = true;
    setFiltersOpen(!filtersOpen);
  };

  const shown = t('tblShown', { n: rows.length, total: message.signals.length });
  const status = [
    sort
      ? t(sort.direction === 'ascending' ? 'tblSortedAsc' : 'tblSortedDesc', { col: label(sort.column) })
      : t('tblFileOrder'),
    filtered ? shown : '',
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <div className="card table-card">
      <div className="tbl-head">
        <h2 id={`${id}title`}>{t('signalsTitle')}</h2>
        {filtered && <span className="tbl-count">{shown}</span>}
        <span className="tbl-actions">
          {filtered && (
            <button type="button" className="btn text state" onClick={clearFiltersAndRefocus}>
              {t('tblClearFilters')}
            </button>
          )}
          <button
            type="button"
            className={`btn text with-icon state tbl-filter-toggle ${filtersOpen ? 'on' : ''}`}
            aria-expanded={filtersOpen}
            aria-controls={`${id}filters`}
            onClick={toggleFilters}
          >
            <Icon name={filtersOpen ? 'filter_list_off' : 'filter_list'} size={18} />
            {t('tblFilter')}
          </button>
        </span>
      </div>
      <div className="tbl-help" id={`${id}help`} hidden={!filtersOpen}>
        {t('tblFilterHelp')}
      </div>
      {invalid.map((column) => (
        <div key={column} className="tbl-help error" id={`${id}err-${column}`}>
          {t('tblInvalid', { col: label(column) })}
        </div>
      ))}
      <span className="visually-hidden" role="status">
        {announce ? status : ''}
      </span>
      {/* The table scrolls sideways on its own, so the title and the filter controls stay in view. */}
      <div className="tbl-scroll">
        <table className="m3" aria-labelledby={`${id}title`} data-testid="tbl-signals">
          <thead>
            <tr>
              {SIGNAL_COLUMNS.map(({ key, numeric }) => {
                const direction = sort?.column === key ? sort.direction : undefined;
                const next: MsgKey = !direction ? 'tblSortAsc' : direction === 'ascending' ? 'tblSortDesc' : 'tblSortReset';
                return (
                  <th key={key} scope="col" className={numeric ? 'num' : undefined} aria-sort={direction}>
                    <button
                      type="button"
                      className={`tbl-sort state ${direction ? 'on' : ''}`}
                      title={t(next)}
                      onClick={() => sortBy(key)}
                    >
                      {label(key)}
                      <Icon
                        name={direction === 'descending' ? 'arrow_downward' : 'arrow_upward'}
                        size={16}
                        className="tbl-sort-icon"
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
            <tr className="tbl-filter-row" id={`${id}filters`} hidden={!filtersOpen}>
              {SIGNAL_COLUMNS.map(({ key, numeric }, i) => {
                const bad = invalid.includes(key);
                const text = filters[key] ?? '';
                return (
                  <td key={key} className={numeric ? 'num' : undefined}>
                    {/* The box holds the field's place in the column; the field
                        itself grows over its neighbours while focused. */}
                    <div className="tbl-filter-box">
                      <input
                        ref={i === 0 ? firstFilter : undefined}
                        className="tbl-filter"
                        size={1}
                        value={text}
                        title={text || undefined}
                        style={{ '--tbl-chars': Math.min(text.length + 2, 24) } as CSSProperties}
                        aria-label={t('tblFilterColumn', { col: label(key) })}
                        aria-describedby={bad ? `${id}help ${id}err-${key}` : `${id}help`}
                        aria-invalid={bad || undefined}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setFilter(key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape' && text !== '') {
                            e.preventDefault();
                            setFilter(key, '');
                          }
                        }}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ signal, index }) => (
              <tr
                key={signal.name + index}
                className={`clickable ${selectedSignal === signal.name ? 'selected' : ''}`}
                aria-current={selectedSignal === signal.name ? 'true' : undefined}
                {...activateProps(() => onToggleSignal(signal.name))}
              >
                <td>
                  <span className="sig-name">
                    <span className={`sig-chip tone-${signalTone(index)}`}>{signalNumber(index)}</span>
                    {signal.name}
                  </span>
                </td>
                <td className="mono">{signal.multiplex.role !== 'none' ? muxLabel(signal.multiplex) : ''}</td>
                <td className="num">{signal.startBit}</td>
                <td className="num">{signal.length}</td>
                <td>{signal.byteOrder === 'intel' ? 'Intel' : 'Motorola'}</td>
                <td>{signal.valueType}</td>
                <td className="num">{fmtNum(signal.factor)}</td>
                <td className="num">{fmtNum(signal.offset)}</td>
                <td className="num">{fmtNum(signal.min)}</td>
                <td className="num">{fmtNum(signal.max)}</td>
                <td>{signal.unit}</td>
                <td className="comment">{signal.receivers.join(', ')}</td>
              </tr>
            ))}
            {rows.length === 0 && filtered && (
              <tr className="tbl-empty">
                <td colSpan={SIGNAL_COLUMNS.length}>
                  {t('tblNoMatch')}{' '}
                  <button type="button" className="btn text state" onClick={clearFiltersAndRefocus}>
                    {t('tblClearFilters')}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
