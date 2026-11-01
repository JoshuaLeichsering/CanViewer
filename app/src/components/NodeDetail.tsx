// SPDX-License-Identifier: GPL-2.0-or-later
import type { DbcDatabase, DbcNode } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { isJ1939Database } from '../lib/dbc/j1939';
import { useI18n } from '../lib/i18n';
import { hexId } from '../lib/format';
import { messageTag, MessageTag } from './MessageTag';

export function NodeDetail({
  db,
  fileName,
  node,
  onSelect,
}: {
  db: DbcDatabase;
  fileName: string;
  node: DbcNode;
  onSelect: (s: Selection) => void;
}) {
  const { t, tn } = useI18n();
  const j1939Db = isJ1939Database(db);
  const txMessages = db.messages.filter((m) => m.sender === node.name || m.transmitters.includes(node.name));
  const rxRows = db.messages.flatMap((message) =>
    message.signals.filter((signal) => signal.receivers.includes(node.name)).map((signal) => ({ message, signal })),
  );
  // Node attributes sit in the facts strip next to the traffic counts.
  const facts: Array<[string, string]> = [
    [t('factTransmits'), tn('messagesOne', 'messagesMany', txMessages.length)],
    [t('factReceives'), tn('signalsOne', 'signalsMany', rxRows.length)],
    ...Object.entries(node.attributes).map(([k, v]) => [k, String(v)] as [string, string]),
  ];

  return (
    <div>
      <header className="page-header">
        <div className="overline">{t('nodeOverline', { file: fileName })}</div>
        <h1>{node.name}</h1>
        {node.comment && <p className="lead">{node.comment}</p>}
      </header>

      <div className="facts wide">
        {facts.map(([k, v]) => (
          <div className="fact" key={k}>
            <div className="k">{k}</div>
            <div className="v" title={v}>
              {v}
            </div>
          </div>
        ))}
      </div>

      <div className="card table-card">
        <h2>{t('txTitle')}</h2>
        {txMessages.length === 0 ? (
          <div className="card-note">{t('txNone')}</div>
        ) : (
          <table className="m3">
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
                  onClick={() => onSelect({ kind: 'message', rawId: m.rawId, occ: occurrenceOf(db, m) })}
                >
                  <td className="id">{hexId(m.id, m.isExtended)}</td>
                  <td className="strong nowrap">
                    {m.name}
                    <MessageTag tag={messageTag(db, m, j1939Db)} />
                  </td>
                  <td className="num">{m.dlc}</td>
                  <td className="num">{m.signals.length}</td>
                  <td className="num">
                    {m.attributes.GenMsgCycleTime !== undefined ? String(m.attributes.GenMsgCycleTime) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card table-card">
        <h2>{t('rxTitle')}</h2>
        {rxRows.length === 0 ? (
          <div className="card-note">{t('rxNone')}</div>
        ) : (
          <table className="m3">
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
                  <td className="strong">{signal.name}</td>
                  <td>{message.name}</td>
                  <td className="id">{hexId(message.id, message.isExtended)}</td>
                  <td>{signal.unit || '—'}</td>
                  <td className="comment">{message.sender || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
