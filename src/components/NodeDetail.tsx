import type { DbcDatabase, DbcNode } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
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
          <span className="pill node">Node</span>
        </div>
        <div className="meta-row">
          <span>
            Transmits <b>{txMessages.length}</b> messages
          </span>
          <span>
            Receives <b>{rxRows.length}</b> signals
          </span>
        </div>
        {node.comment && <div className="comment-box">{node.comment}</div>}
      </div>

      <div className="card">
        <h2>Transmitted messages</h2>
        {txMessages.length === 0 ? (
          <div className="muted">This node transmits no messages.</div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>ID</th>
                <th>Message</th>
                <th className="num">DLC</th>
                <th className="num">Signals</th>
                <th className="num">Cycle (ms)</th>
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
        <h2>Received signals</h2>
        {rxRows.length === 0 ? (
          <div className="muted">This node receives no signals.</div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Signal</th>
                <th>In message</th>
                <th>ID</th>
                <th>Unit</th>
                <th>From</th>
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

      <AttributesCard title="Node attributes" attributes={node.attributes} />
    </div>
  );
}
