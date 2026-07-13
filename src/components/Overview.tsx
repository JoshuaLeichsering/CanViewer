import type { DbcDatabase } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { isCanFd } from '../lib/dbc/canfd';
import { decomposeJ1939Id, isJ1939Database, PGN_NAMES } from '../lib/dbc/j1939';
import { useI18n } from '../lib/i18n';
import { hexId } from '../lib/format';
import { AttributesCard } from './AttributesCard';

/** Rendering tens of thousands of problem rows would freeze the UI. */
const MAX_PROBLEM_ROWS = 200;

export function Overview({
  db,
  onSelect,
}: {
  db: DbcDatabase;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useI18n();
  const totalSignals = db.messages.reduce((n, m) => n + m.signals.length, 0);
  const skippedEntries = Object.entries(db.skipped);
  const j1939Db = isJ1939Database(db);

  const appliesTo = {
    '': t('appliesNetwork'),
    BU_: t('appliesNode'),
    BO_: t('appliesMessage'),
    SG_: t('appliesSignal'),
    EV_: t('appliesEnvVar'),
  };

  return (
    <div>
      <div className="stat-row">
        <div className="stat">
          <div className="value">{db.messages.length}</div>
          <div className="label">{t('statMessages')}</div>
        </div>
        <div className="stat">
          <div className="value">{totalSignals}</div>
          <div className="label">{t('statSignals')}</div>
        </div>
        <div className="stat">
          <div className="value">{db.nodes.length}</div>
          <div className="label">{t('statNodes')}</div>
        </div>
        <div className="stat">
          <div className="value">{db.valueTables.length}</div>
          <div className="label">{t('statValueTables')}</div>
        </div>
        <div className="stat">
          <div className="value">{db.attributeDefinitions.length}</div>
          <div className="label">{t('statAttrDefs')}</div>
        </div>
      </div>

      {db.comment && (
        <div className="card">
          <h2>{t('dbComment')}</h2>
          <div className="comment-box">{db.comment}</div>
        </div>
      )}

      {db.problems.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <h2>{t('parseProblemsTitle', { n: db.problems.length })}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {t('parseProblemsHint')}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th className="num">{t('thLine')}</th>
                  <th>{t('thReason')}</th>
                  <th>{t('thContent')}</th>
                </tr>
              </thead>
              <tbody>
                {db.problems.slice(0, MAX_PROBLEM_ROWS).map((p, i) => (
                  <tr key={i}>
                    <td className="num">{p.line}</td>
                    <td className="problem-reason">{p.reason}</td>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>
                      {p.text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {db.problems.length > MAX_PROBLEM_ROWS && (
            <div className="muted" style={{ marginTop: 8 }}>
              {t('moreProblems', { n: db.problems.length - MAX_PROBLEM_ROWS })}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>{t('statMessages')}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead>
              <tr>
                <th>{t('thId')}</th>
                {j1939Db && <th className="num">PGN</th>}
                <th>{t('thName')}</th>
                <th className="num">{t('dlc')}</th>
                <th className="num">{t('thSignals')}</th>
                <th>{t('thSender')}</th>
                <th className="num">{t('thCycle')}</th>
                <th>{t('thComment')}</th>
              </tr>
            </thead>
            <tbody>
              {[...db.messages]
                .sort((a, b) => a.id - b.id)
                .map((m) => (
                  <tr
                    key={`${m.rawId}.${occurrenceOf(db, m)}`}
                    className="clickable"
                    onClick={() =>
                      onSelect({ kind: 'message', rawId: m.rawId, occ: occurrenceOf(db, m) })
                    }
                  >
                    <td className="mono">
                      {hexId(m.id, m.isExtended)}
                      {m.isExtended && (
                        <>
                          {' '}
                          <span className="pill ext">EXT</span>
                        </>
                      )}
                      {isCanFd(db, m) && (
                        <>
                          {' '}
                          <span className="pill fd">FD</span>
                        </>
                      )}
                    </td>
                    {j1939Db && (
                      <td
                        className="num"
                        title={m.isExtended ? PGN_NAMES[decomposeJ1939Id(m.id).pgn] : undefined}
                      >
                        {m.isExtended ? decomposeJ1939Id(m.id).pgn : ''}
                      </td>
                    )}
                    <td>
                      <b>{m.name}</b>
                    </td>
                    <td className="num">{m.dlc}</td>
                    <td className="num">{m.signals.length}</td>
                    <td>{m.sender || '—'}</td>
                    <td className="num">
                      {m.attributes.GenMsgCycleTime !== undefined
                        ? String(m.attributes.GenMsgCycleTime)
                        : ''}
                    </td>
                    <td className="muted" style={{ maxWidth: 340 }}>
                      {m.comment?.split('\n')[0] ?? ''}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {db.attributeDefinitions.length > 0 && (
        <div className="card">
          <h2>{t('attrDefsTitle')}</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>{t('thName')}</th>
                  <th>{t('thAppliesTo')}</th>
                  <th>{t('thType')}</th>
                  <th className="num">Min</th>
                  <th className="num">Max</th>
                  <th>{t('thDefault')}</th>
                  <th>{t('thEnumValues')}</th>
                </tr>
              </thead>
              <tbody>
                {db.attributeDefinitions.map((d) => (
                  <tr key={d.objectType + d.name}>
                    <td>
                      <b>{d.name}</b>
                    </td>
                    <td>{appliesTo[d.objectType]}</td>
                    <td>{d.valueType}</td>
                    <td className="num">{d.min ?? ''}</td>
                    <td className="num">{d.max ?? ''}</td>
                    <td className="mono">{d.defaultValue !== undefined ? String(d.defaultValue) : ''}</td>
                    <td className="muted">{d.enumValues?.join(', ') ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AttributesCard title={t('networkAttributes')} attributes={db.attributes} />

      {skippedEntries.length > 0 && (
        <div className="card">
          <h3>{t('skippedTitle')}</h3>
          <div className="muted">
            {skippedEntries.map(([kw, count]) => `${kw} (${count}×)`).join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}
