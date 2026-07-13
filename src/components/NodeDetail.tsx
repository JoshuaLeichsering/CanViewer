import type { DbcDatabase, DbcNode } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { isCanFd } from '../lib/dbc/canfd';
import { useI18n } from '../lib/i18n';
import { hexId } from '../lib/format';
import { AttributesCard } from './AttributesCard';

export function NodeDetail({
  db,
  node,
  onSelect,
}: {
  db: DbcDatabase;
  node: DbcNode;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useI18n();
  const txMessages = db.messages.filter(
    (m) => m.sender === node.name || m.transmitters.includes(node.name),
  );
  const rxRows = db.messages.flatMap((message) =>
    message.signals
      .filter((signal) => signal.receivers.includes(node.name))
      .map((signal) => ({ message, signal })),
  );

  return (
    <div>
      <div className="card">
        <div className="detail-header">
          <h1>{node.name}</h1>
          <span className="pill node">{t('pillNode')}</span>
        </div>
        <div className="meta-row">
          <span>
            {t('transmitsPrefix')} <b>{txMessages.length}</b> {t('messagesSuffix')}
          </span>
          <span>
            {t('receivesPrefix')} <b>{rxRows.length}</b> {t('signalsSuffix')}
          </span>
        </div>
        {node.comment && <div className="comment-box">{node.comment}</div>}
      </div>

      <div className="card">
        <h2>{t('txTitle')}</h2>
        {txMessages.length === 0 ? (
          <div className="muted">{t('txNone')}</div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>{t('thId')}</th>
                <th>{t('thMessage')}</th>
                <th className="num">{t('dlc')}</th>
                <th className="num">{t('thSignals')}</th>
                <th className="num">{t('thCycle')}</th>
              </tr>
            </thead>
            <tbody>
              {txMessages.map((m) => (
                <tr
                  key={`${m.rawId}.${occurrenceOf(db, m)}`}
                  className="clickable"
                  onClick={() =>
                    onSelect({ kind: 'message', rawId: m.rawId, occ: occurrenceOf(db, m) })
                  }
                >
                  <td className="mono">{hexId(m.id, m.isExtended)}</td>
                  <td>
                    <b>{m.name}</b>
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
                  <td className="num">{m.dlc}</td>
                  <td className="num">{m.signals.length}</td>
                  <td className="num">
                    {m.attributes.GenMsgCycleTime !== undefined
                      ? String(m.attributes.GenMsgCycleTime)
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>{t('rxTitle')}</h2>
        {rxRows.length === 0 ? (
          <div className="muted">{t('rxNone')}</div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>{t('thSignal')}</th>
                <th>{t('thInMessage')}</th>
                <th>{t('thId')}</th>
                <th>{t('thUnit')}</th>
                <th>{t('thFrom')}</th>
              </tr>
            </thead>
            <tbody>
              {rxRows.map(({ message, signal }, i) => (
                <tr
                  key={`${message.rawId}.${occurrenceOf(db, message)}/${signal.name}#${i}`}
                  className="clickable"
                  onClick={() =>
                    onSelect({
                      kind: 'message',
                      rawId: message.rawId,
                      occ: occurrenceOf(db, message),
                      signal: signal.name,
                    })
                  }
                >
                  <td>
                    <b>{signal.name}</b>
                  </td>
                  <td>{message.name}</td>
                  <td className="mono">{hexId(message.id, message.isExtended)}</td>
                  <td>{signal.unit}</td>
                  <td className="muted">{message.sender || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AttributesCard title={t('nodeAttributes')} attributes={node.attributes} />
    </div>
  );
}
