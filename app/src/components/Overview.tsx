import type { DbcDatabase } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { isCanFd } from '../lib/dbc/canfd';
import { decomposeJ1939Id, isJ1939Database, PGN_NAMES } from '../lib/dbc/j1939';
import { useI18n } from '../lib/i18n';
import { hexId } from '../lib/format';
import { Icon } from './Icon';
import { ExportMenu } from './ExportMenu';
import { messageTag, MessageTag } from './MessageTag';

/** Rendering tens of thousands of problem rows would freeze the UI. */
const MAX_PROBLEM_ROWS = 200;

export function Overview({
  db,
  fileName,
  onSelect,
}: {
  db: DbcDatabase;
  fileName: string;
  onSelect: (s: Selection) => void;
}) {
  const { t, tn } = useI18n();
  const totalSignals = db.messages.reduce((n, m) => n + m.signals.length, 0);
  const skippedEntries = Object.entries(db.skipped);
  const networkAttributes = Object.entries(db.attributes);
  const j1939Db = isJ1939Database(db);
  const j1939Count = db.messages.filter((m) => messageTag(db, m, j1939Db) === 'J1939').length;
  const fdCount = db.messages.filter((m) => isCanFd(db, m)).length;

  const appliesTo = {
    '': t('appliesNetwork'),
    BU_: t('appliesNode'),
    BO_: t('appliesMessage'),
    SG_: t('appliesSignal'),
    EV_: t('appliesEnvVar'),
  };

  const detectedParts = [
    j1939Count > 0 ? tn('j1939One', 'j1939Many', j1939Count) : '',
    fdCount > 0 ? tn('fdOne', 'fdMany', fdCount) : '',
  ].filter(Boolean);

  const stats: Array<[string, number]> = [
    [t('statMessages'), db.messages.length],
    [t('statSignals'), totalSignals],
    [t('statNodes'), db.nodes.length],
    [t('statValueTables'), db.valueTables.length],
    [t('statAttrDefs'), db.attributeDefinitions.length],
  ];

  return (
    <div>
      <header className="page-header exp-header">
        <div className="overline">
          {db.version ? t('overviewOverline', { v: db.version }) : t('overviewOverlineNoVersion')}
        </div>
        <h1>{fileName}</h1>
        <ExportMenu db={db} fileName={fileName} />
        {db.comment && <p className="lead">{db.comment}</p>}
      </header>

      <div className="facts wide large">
        {stats.map(([label, value]) => (
          <div className="fact" key={label}>
            <div className="k">{label}</div>
            <div className="v">{value}</div>
          </div>
        ))}
      </div>

      {db.problems.length > 0 ? (
        <>
          <div className="banner error">
            <Icon name="error" size={20} />
            <span>
              <b>{tn('problemsOne', 'problemsMany', db.problems.length)}.</b> {t('parseProblemsHint')}
            </span>
          </div>
          <div className="card table-card">
            <h2>{t('parseProblemsTitle', { n: db.problems.length })}</h2>
            <table className="m3">
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
                    <td className="nowrap" style={{ color: 'var(--error)' }}>
                      {p.reason}
                    </td>
                    <td className="mono wrap-anywhere">{p.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {db.problems.length > MAX_PROBLEM_ROWS && (
              <div className="card-note" style={{ paddingTop: 12 }}>
                {t('moreProblems', { n: db.problems.length - MAX_PROBLEM_ROWS })}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="banner ok">
          <Icon name="check_circle" size={20} />
          <span>
            {t('statusOk')}
            {detectedParts.length > 0 && (
              <> {t('detected', { list: detectedParts.join(` ${t('andWord')} `) })}</>
            )}
          </span>
        </div>
      )}

      <div className="card table-card">
        <h2>{t('statMessages')}</h2>
        <table className="m3">
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
                  onClick={() => onSelect({ kind: 'message', rawId: m.rawId, occ: occurrenceOf(db, m) })}
                >
                  <td className="id">{hexId(m.id, m.isExtended)}</td>
                  {j1939Db && (
                    <td className="num" title={m.isExtended ? PGN_NAMES[decomposeJ1939Id(m.id).pgn] : undefined}>
                      {m.isExtended ? decomposeJ1939Id(m.id).pgn : ''}
                    </td>
                  )}
                  <td className="strong nowrap">
                    {m.name}
                    <MessageTag tag={messageTag(db, m, j1939Db)} />
                  </td>
                  <td className="num">{m.dlc}</td>
                  <td className="num">{m.signals.length}</td>
                  <td>{m.sender || '—'}</td>
                  <td className="num">
                    {m.attributes.GenMsgCycleTime !== undefined ? String(m.attributes.GenMsgCycleTime) : ''}
                  </td>
                  <td className="comment">{m.comment?.split('\n')[0] ?? ''}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {db.attributeDefinitions.length > 0 && (
        <div className="card table-card">
          <h2>{t('attrDefsTitle')}</h2>
          <table className="m3">
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
                  <td className="strong">{d.name}</td>
                  <td>{appliesTo[d.objectType]}</td>
                  <td className="mono">{d.valueType}</td>
                  <td className="num">{d.min ?? ''}</td>
                  <td className="num">{d.max ?? ''}</td>
                  <td className="mono">{d.defaultValue !== undefined ? String(d.defaultValue) : ''}</td>
                  <td className="comment">{d.enumValues?.join(', ') ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {networkAttributes.length > 0 && (
        <div className="strip">
          <span className="strip-label">{t('networkAttributes')}</span>
          {networkAttributes.map(([name, value]) => (
            <span key={name}>
              {name} <span className="val">{String(value)}</span>
            </span>
          ))}
        </div>
      )}

      {skippedEntries.length > 0 && (
        <div className="strip">
          <span className="strip-label">{t('skippedTitle')}</span>
          <span className="muted">{skippedEntries.map(([kw, count]) => `${kw} (${count}×)`).join(' · ')}</span>
        </div>
      )}
    </div>
  );
}
