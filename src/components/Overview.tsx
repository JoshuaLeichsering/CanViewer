import type { DbcDatabase } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { isCanFd } from '../lib/dbc/canfd';
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
  const totalSignals = db.messages.reduce((n, m) => n + m.signals.length, 0);
  const skippedEntries = Object.entries(db.skipped);

  return (
    <div>
      <div className="stat-row">
        <div className="stat">
          <div className="value">{db.messages.length}</div>
          <div className="label">Messages</div>
        </div>
        <div className="stat">
          <div className="value">{totalSignals}</div>
          <div className="label">Signals</div>
        </div>
        <div className="stat">
          <div className="value">{db.nodes.length}</div>
          <div className="label">Nodes</div>
        </div>
        <div className="stat">
          <div className="value">{db.valueTables.length}</div>
          <div className="label">Value tables</div>
        </div>
        <div className="stat">
          <div className="value">{db.attributeDefinitions.length}</div>
          <div className="label">Attribute defs</div>
        </div>
      </div>

      {db.comment && (
        <div className="card">
          <h2>Database comment</h2>
          <div className="comment-box">{db.comment}</div>
        </div>
      )}

      {db.problems.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <h2>⚠ Parse problems ({db.problems.length})</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            These lines could not be understood and were skipped — the rest of the file is
            loaded normally.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th className="num">Line</th>
                  <th>Reason</th>
                  <th>Content</th>
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
              … and {db.problems.length - MAX_PROBLEM_ROWS} more problems not shown.
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Messages</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th className="num">DLC</th>
                <th className="num">Signals</th>
                <th>Sender</th>
                <th className="num">Cycle (ms)</th>
                <th>Comment</th>
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
          <h2>Attribute definitions</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Applies to</th>
                  <th>Type</th>
                  <th className="num">Min</th>
                  <th className="num">Max</th>
                  <th>Default</th>
                  <th>Enum values</th>
                </tr>
              </thead>
              <tbody>
                {db.attributeDefinitions.map((d) => (
                  <tr key={d.objectType + d.name}>
                    <td>
                      <b>{d.name}</b>
                    </td>
                    <td>
                      {{ '': 'Network', BU_: 'Node', BO_: 'Message', SG_: 'Signal', EV_: 'Env var' }[
                        d.objectType
                      ]}
                    </td>
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

      <AttributesCard title="Network attributes" attributes={db.attributes} />

      {skippedEntries.length > 0 && (
        <div className="card">
          <h3>Not displayed (parsed &amp; skipped)</h3>
          <div className="muted">
            {skippedEntries.map(([kw, count]) => `${kw} (${count}×)`).join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}
