// SPDX-License-Identifier: GPL-2.0-or-later
import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Selection } from '../App';
import type { ImportStage } from '../lib/canmatrix/client';
import { FILE_INPUT_ACCEPT } from '../lib/canmatrix/formats';
import { ImportFailure } from '../lib/canmatrix/import-failure';
import { occurrenceOf } from '../lib/dbc/identity';
import type { DbcAttributeDefinition, DbcDatabase, DbcMessage, DbcNode, DbcValueTable } from '../lib/dbc/types';
import {
  countChanges,
  diffDatabases,
  diffLines,
  hasChanges,
  type ChangeKind,
  type ItemDiff,
  type MessageDiff,
  type SignalDiff,
} from '../lib/diff/diff';
import type { FieldChange } from '../lib/diff/fields';
import { readDatabaseFile } from '../lib/diff/open';
import { IMP_FAILURE_TEXT } from '../lib/import/messages';
import { hexId } from '../lib/format';
import { useI18n, type MsgKey } from '../lib/i18n';
import { changedFields, fieldLabel, formatValue, signalNotation, signalTally } from './diffFormat';
import { Icon } from './Icon';
import './diff.css';

/** The other version of the open file, and which of the two is the later one. */
export interface Comparison {
  name: string;
  db: DbcDatabase;
  /** The versions were swapped: the open file is the later version. */
  openIsLater: boolean;
}

/** What the app can ask of the Compare page: a file dropped on it is the other version. */
export interface DiffViewHandle {
  openOther: (file: File) => void;
}

type Filter = 'all' | Exclude<ChangeKind, 'unchanged'>;

const KIND_KEYS: Record<Exclude<ChangeKind, 'unchanged'>, MsgKey> = {
  added: 'difKindAdded',
  removed: 'difKindRemoved',
  changed: 'difKindChanged',
};

const IMPORT_STAGE_KEYS = {
  runtime: 'importRuntime',
  packages: 'importPackages',
  reading: 'importReading',
} as const;


/**
 * Diff mode: the open file against another version of the same database.
 * The open file is the earlier version until the two are swapped. Changes are
 * listed per message (with their signals) and for the database's nodes, value
 * tables, attribute definitions and own properties; see app/src/lib/diff/diff.ts
 * for what is compared and how objects are matched.
 *
 * The other version is opened from the page or dropped on it (the app hands a
 * dropped file to openOther). The comparison belongs to the open file: the app
 * ends it when another file is opened.
 */
export const DiffView = forwardRef<
  DiffViewHandle,
  {
    db: DbcDatabase;
    fileName: string;
    /** The cluster the open file shows, when it was imported from a file with clusters. */
    cluster?: string;
    comparison: Comparison | null;
    onComparison: (c: Comparison | null) => void;
    onSelect: (s: Selection) => void;
  }
>(function DiffView({ db, fileName, cluster, comparison, onComparison, onSelect }, ref) {
  const { t, tn } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState<{ name: string; stage: ImportStage | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);

  const open = { name: fileName, db };
  const other = comparison && { name: comparison.name, db: comparison.db };
  const before = comparison?.openIsLater ? other : open;
  const after = comparison?.openIsLater ? open : other;
  const beforeDb = before?.db;
  const afterDb = after?.db;
  const diff = useMemo(() => (beforeDb && afterDb ? diffDatabases(beforeDb, afterDb) : null), [beforeDb, afterDb]);
  const counts = useMemo(() => diff && countChanges(diff), [diff]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 3000);
    return () => clearTimeout(timer);
  }, [copied]);

  const readOther = async (file: File) => {
    if (loading) return;
    setError(null);
    setLoading({ name: file.name, stage: null });
    try {
      const otherDb = await readDatabaseFile(file, (stage) => setLoading({ name: file.name, stage }), cluster);
      onComparison({ name: file.name, db: otherDb, openIsLater: comparison?.openIsLater ?? false });
      setFilter('all');
      setExpanded(new Set());
    } catch (e) {
      // A failure CanViewer names (no database, runtime or format support not
      // loaded) is told in the user's language, as when a file is opened.
      const error = e instanceof ImportFailure ? t(IMP_FAILURE_TEXT[e.reason]) : e instanceof Error ? e.message : String(e);
      setError(t('importFailed', { name: file.name, error }));
    } finally {
      setLoading(null);
    }
  };

  useImperativeHandle(ref, () => ({ openOther: (file) => void readOther(file) }));

  const openDialog = () => inputRef.current?.click();

  const copy = async () => {
    if (!diff || !before || !after) return;
    try {
      await navigator.clipboard.writeText([`--- ${before.name}`, `+++ ${after.name}`, ...diffLines(diff)].join('\n') + '\n');
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  /** The open file's message, to link to the viewer, if it has one. */
  const openMessage = (m: MessageDiff) => (comparison?.openIsLater ? m.after : m.before);
  const goTo = (message: DbcMessage) =>
    onSelect({ kind: 'message', rawId: message.rawId, occ: occurrenceOf(db, message) });

  const toggle = (index: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const listed =
    diff?.messages
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => m.kind !== 'unchanged' && (filter === 'all' || m.kind === filter)) ?? [];

  return (
    <div className="dif-view">
      <input
        ref={inputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="dif-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void readOther(file);
          e.target.value = '';
        }}
      />
      <header className="page-header">
        <div className="overline">{t('difOverline', { file: fileName })}</div>
        <h1>{t('difTitle')}</h1>
      </header>

      {loading && (
        <div className="banner info" role="status">
          <Icon name="progress_activity" size={20} className="spinner dif-spinner" />
          <span>{t(IMPORT_STAGE_KEYS[loading.stage ?? 'reading'], { name: loading.name })}</span>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          <Icon name="error" size={20} />
          <span>{error}</span>
        </div>
      )}

      {!comparison || !before || !after || !diff || !counts ? (
        <div className="card dif-empty">
          <Icon name="difference" size={40} className="dif-empty-icon" />
          <h2>{t('difEmptyTitle', { file: fileName })}</h2>
          <p>{t('difEmptyText', { file: fileName })}</p>
          <button className="btn filled with-icon state" onClick={openDialog} disabled={!!loading}>
            <Icon name="upload_file" size={18} />
            {t('difOpenOther')}
          </button>
          <p className="formats">{t('difEmptyFormats')}</p>
        </div>
      ) : (
        <>
          <div className="dif-versions" data-testid="dif-versions">
            <Version label={t('difBefore')} name={before.name} isOpen={!comparison.openIsLater} openLabel={t('difOpenFile')} />
            <button
              className="dif-swap state"
              title={t('difSwap')}
              aria-label={t('difSwap')}
              onClick={() => {
                onComparison({ ...comparison, openIsLater: !comparison.openIsLater });
                setExpanded(new Set());
              }}
            >
              <Icon name="swap_horiz" />
            </button>
            <Version label={t('difAfter')} name={after.name} isOpen={comparison.openIsLater} openLabel={t('difOpenFile')} />
            <div className="dif-version-actions">
              {hasChanges(diff) && (
                <>
                  <span role="status" className="dif-copy-status">
                    {copied === 'ok' ? t('difCopied') : copied === 'failed' ? t('difCopyFailed') : ''}
                  </span>
                  <button className="btn text with-icon state" onClick={copy} data-testid="dif-copy">
                    <Icon name="content_copy" size={18} />
                    {t('difCopy')}
                  </button>
                </>
              )}
              <button className="btn outlined with-icon state" onClick={openDialog} disabled={!!loading}>
                <Icon name="upload_file" size={18} />
                {t('difOpenOther')}
              </button>
              <button className="btn text state" onClick={() => onComparison(null)}>
                {t('difClose')}
              </button>
            </div>
          </div>

          <div className="facts wide" data-testid="dif-counts">
            {(
              [
                ['difMessagesAdded', counts.messages.added],
                ['difMessagesRemoved', counts.messages.removed],
                ['difMessagesChanged', counts.messages.changed],
                ['difSignalsAdded', counts.signals.added],
                ['difSignalsRemoved', counts.signals.removed],
                ['difSignalsChanged', counts.signals.changed],
              ] as Array<[MsgKey, number]>
            ).map(([key, n]) => (
              <div className="fact" key={key}>
                <div className="k">{t(key)}</div>
                <div className="v">{n}</div>
              </div>
            ))}
          </div>

          <div className="banner-stack">
            {!hasChanges(diff) && (
              <div className="banner ok">
                <Icon name="check_circle" size={20} />
                <span>{t('difNoChanges')}</span>
              </div>
            )}
            {[before, after]
              .filter((side) => side.db.problems.length > 0)
              .map((side) => (
                <div className="banner warn" key={side === before ? 'before' : 'after'}>
                  <Icon name="warning" size={20} />
                  <span>{tn('difProblemsOne', 'difProblemsMany', side.db.problems.length, { name: side.name })}</span>
                </div>
              ))}
          </div>

          {counts.messages.added + counts.messages.removed + counts.messages.changed > 0 && (
            <div className="card table-card dif-messages">
              <div className="dif-card-head">
                <h2>{t('statMessages')}</h2>
                <div className="chips" role="radiogroup" aria-label={t('statMessages')}>
                  {(['all', 'added', 'removed', 'changed'] as Filter[]).map((key) => {
                    const n =
                      key === 'all'
                        ? counts.messages.added + counts.messages.removed + counts.messages.changed
                        : counts.messages[key];
                    return (
                      <button
                        key={key}
                        role="radio"
                        aria-checked={filter === key}
                        className={`chip state ${filter === key ? 'on' : ''}`}
                        onClick={() => setFilter(key)}
                      >
                        {filter === key && <Icon name="check" size={18} />}
                        {key === 'all' ? t('difFilterAll') : t(KIND_KEYS[key])} · {n}
                      </button>
                    );
                  })}
                </div>
              </div>
              <table className="m3 dif-table">
                <thead>
                  <tr>
                    <th className="dif-toggle-col" aria-hidden="true" />
                    <th>{t('difThChange')}</th>
                    <th>{t('thId')}</th>
                    <th>{t('thName')}</th>
                    <th>{t('thSignals')}</th>
                    <th>{t('difThWhat')}</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.length === 0 && (
                    <tr>
                      <td colSpan={6} className="dif-none">
                        {t('noMessagesFilter')}
                      </td>
                    </tr>
                  )}
                  {listed.map(({ m, index }) => {
                    const shown = (m.after ?? m.before)!;
                    const inOpen = openMessage(m);
                    const isOpen = expanded.has(index);
                    const tally = signalTally(m);
                    const renamed = m.before && m.after && m.before.name !== m.after.name;
                    return (
                      <Fragment key={index}>
                        <tr className={`dif-row dif-row-${m.kind}`} data-testid="dif-message">
                          <td className="dif-toggle-col">
                            <button
                              className="dif-toggle state"
                              aria-expanded={isOpen}
                              aria-label={t('difShowDetails', { name: shown.name })}
                              onClick={() => toggle(index)}
                            >
                              <Icon name="chevron_right" size={20} />
                            </button>
                          </td>
                          <td>
                            <Badge kind={m.kind} label={t(KIND_KEYS[m.kind as Exclude<ChangeKind, 'unchanged'>])} />
                          </td>
                          <td className="id nowrap">
                            {m.before && m.after && m.before.id !== m.after.id
                              ? `${hexId(m.before.id, m.before.isExtended)} → ${hexId(m.after.id, m.after.isExtended)}`
                              : hexId(shown.id, shown.isExtended)}
                          </td>
                          <td className="strong nowrap">
                            {renamed && (
                              <>
                                <del className="dif-old-name">{m.before!.name}</del>{' '}
                              </>
                            )}
                            {inOpen ? (
                              <button
                                className="dif-link"
                                title={t('difOpenInViewer', { name: inOpen.name })}
                                onClick={() => goTo(inOpen)}
                              >
                                {shown.name}
                              </button>
                            ) : (
                              shown.name
                            )}
                          </td>
                          <td className="nowrap">
                            {m.kind === 'changed'
                              ? t('difSignalsSummary', tally)
                              : tn('signalsOne', 'signalsMany', shown.signals.length)}
                          </td>
                          <td className="comment">{m.kind === 'changed' ? changedFields(m, t).join(', ') : ''}</td>
                        </tr>
                        {isOpen && (
                          <tr className="dif-detail">
                            <td />
                            <td colSpan={5}>
                              {m.changes.length > 0 && <ChangeTable changes={m.changes} />}
                              <SignalList signals={m.signals.filter((s) => s.kind !== 'unchanged')} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {counts.messages.unchanged > 0 && (
                <div className="card-note dif-note">
                  {tn('difUnchangedOne', 'difUnchangedMany', counts.messages.unchanged)}
                </div>
              )}
            </div>
          )}

          <DatabaseCard
            fields={diff.database}
            definitions={diff.attributeDefinitions}
            nodes={diff.nodes}
            valueTables={diff.valueTables}
          />
        </>
      )}
    </div>
  );
});

function Version({ label, name, isOpen, openLabel }: { label: string; name: string; isOpen: boolean; openLabel: string }) {
  return (
    <div className="dif-version">
      <div className="dif-version-k">{label}</div>
      <div className="dif-version-name">
        <span>{name}</span>
        {isOpen && <span className="tag">{openLabel}</span>}
      </div>
    </div>
  );
}

function Badge({ kind, label }: { kind: ChangeKind; label: string }) {
  return <span className={`dif-badge dif-${kind}`}>{label}</span>;
}

function Value({ field, value }: { field: string; value: FieldChange['before'] }) {
  const { t } = useI18n();
  const text = formatValue(field, value, t);
  return text === undefined ? (
    <span className="dif-absent" title={value === undefined ? t('difAbsent') : undefined}>
      —
    </span>
  ) : (
    <span className="dif-value">{text}</span>
  );
}

function ChangeTable({ changes }: { changes: FieldChange[] }) {
  const { t } = useI18n();
  return (
    <table className="dif-changes">
      <thead>
        <tr>
          <th>{t('difField')}</th>
          <th>{t('difThBefore')}</th>
          <th>{t('difThAfter')}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.field}>
            <td className="dif-field">{fieldLabel(c.field, t)}</td>
            <td className="dif-before">
              <Value field={c.field} value={c.before} />
            </td>
            <td className="dif-after">
              <Value field={c.field} value={c.after} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Changed signals with their changes; added and removed ones in DBC notation. */
function SignalList({ signals }: { signals: SignalDiff[] }) {
  const { t } = useI18n();
  if (signals.length === 0) return null;
  return (
    <ul className="dif-items">
      {signals.map((s, i) => (
        <li key={`${s.name}.${i}`}>
          <div className="dif-item-head">
            <Badge kind={s.kind} label={t(KIND_KEYS[s.kind as Exclude<ChangeKind, 'unchanged'>])} />
            <span className="dif-item-name">{s.name}</span>
            {s.kind !== 'changed' && <span className="mono muted dif-notation">{signalNotation((s.after ?? s.before)!)}</span>}
          </div>
          {s.changes.length > 0 && <ChangeTable changes={s.changes} />}
        </li>
      ))}
    </ul>
  );
}

const APPLIES_TO: Record<DbcAttributeDefinition['objectType'], MsgKey> = {
  '': 'appliesNetwork',
  BU_: 'appliesNode',
  BO_: 'appliesMessage',
  SG_: 'appliesSignal',
  EV_: 'appliesEnvVar',
};

/** Changes to the database's own properties, nodes, value tables and attribute definitions. */
function DatabaseCard({
  fields,
  definitions,
  nodes,
  valueTables,
}: {
  fields: FieldChange[];
  definitions: ItemDiff<DbcAttributeDefinition>[];
  nodes: ItemDiff<DbcNode>[];
  valueTables: ItemDiff<DbcValueTable>[];
}) {
  const { t, tn } = useI18n();
  const changed = <T,>(items: ItemDiff<T>[]) => items.filter((i) => i.kind !== 'unchanged');
  const sections: Array<{ title: string; items: Array<{ diff: ItemDiff<unknown>; name: string; note?: string }> }> = [
    {
      title: t('statNodes'),
      items: changed(nodes).map((d) => ({ diff: d, name: d.name })),
    },
    {
      title: t('statValueTables'),
      items: changed(valueTables).map((d) => ({
        diff: d,
        name: d.name,
        note: d.kind === 'changed' ? undefined : tn('entriesOne', 'entriesMany', Object.keys((d.after ?? d.before)!.values).length),
      })),
    },
    {
      title: t('attrDefsTitle'),
      items: changed(definitions).map((d) => {
        const def = (d.after ?? d.before)!;
        return { diff: d, name: def.name, note: t(APPLIES_TO[def.objectType]) };
      }),
    },
  ].filter((s) => s.items.length > 0);
  if (fields.length === 0 && sections.length === 0) return null;
  return (
    <div className="card dif-database" data-testid="dif-database">
      <h2>{t('difDatabaseTitle')}</h2>
      {fields.length > 0 && (
        <section>
          <h3>{t('difDatabaseFields')}</h3>
          <ChangeTable changes={fields} />
        </section>
      )}
      {sections.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          <ul className="dif-items">
            {s.items.map(({ diff, name, note }) => (
              <li key={diff.name}>
                <div className="dif-item-head">
                  <Badge kind={diff.kind} label={t(KIND_KEYS[diff.kind as Exclude<ChangeKind, 'unchanged'>])} />
                  <span className="dif-item-name">{name}</span>
                  {note && <span className="muted">{note}</span>}
                </div>
                {diff.changes.length > 0 && <ChangeTable changes={diff.changes} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
