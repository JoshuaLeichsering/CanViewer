import { useMemo } from 'react';
import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { isCanFd } from '../lib/dbc/canfd';
import { hexId } from '../lib/format';

function messageMatches(message: DbcMessage, query: string): boolean {
  const q = query.toLowerCase();
  if (message.name.toLowerCase().includes(q)) return true;
  // Match the displayed (zero-padded) form as well as the raw hex digits with
  // leading zeros stripped, so both "0x064" and "64" find id 100.
  if (hexId(message.id, message.isExtended).toLowerCase().includes(q)) return true;
  const stripped = q.replace(/^0x/, '').replace(/^0+(?=[0-9a-f])/, '');
  if (stripped !== '' && /^[0-9a-f]+$/.test(stripped) && message.id.toString(16).includes(stripped)) {
    return true;
  }
  if (String(message.id).includes(q)) return true;
  return message.signals.some((s) => s.name.toLowerCase().includes(q));
}

export function Sidebar({
  db,
  selection,
  onSelect,
  search,
  onSearch,
}: {
  db: DbcDatabase;
  selection: Selection;
  onSelect: (s: Selection) => void;
  search: string;
  onSearch: (q: string) => void;
}) {
  const query = search.trim();

  const messages = useMemo(() => {
    const sorted = [...db.messages].sort((a, b) => a.id - b.id);
    return query === '' ? sorted : sorted.filter((m) => messageMatches(m, query));
  }, [db, query]);

  const nodes = useMemo(
    () =>
      query === ''
        ? db.nodes
        : db.nodes.filter((n) => n.name.toLowerCase().includes(query.toLowerCase())),
    [db, query],
  );

  const valueTables = useMemo(
    () =>
      query === ''
        ? db.valueTables
        : db.valueTables.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())),
    [db, query],
  );

  return (
    <div className="sidebar">
      <div className="search-box">
        <input
          type="search"
          placeholder="Search messages, signals, nodes…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="tree-section">
        <div className="tree-header">Network</div>
        <button
          className={`tree-item ${selection.kind === 'overview' ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'overview' })}
        >
          <span className="name">Overview</span>
          {db.problems.length > 0 && <span className="pill warn">{db.problems.length}</span>}
        </button>
        <button
          className={`tree-item ${selection.kind === 'graph' ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'graph' })}
        >
          <span className="name">ECU network</span>
        </button>
      </div>

      <div className="tree-section">
        <div className="tree-header">
          Messages ({messages.length}
          {query !== '' ? ` / ${db.messages.length}` : ''})
        </div>
        {messages.map((m) => {
          const occ = occurrenceOf(db, m);
          const active =
            selection.kind === 'message' && selection.rawId === m.rawId && selection.occ === occ;
          return (
            <button
              key={`${m.rawId}.${occ}`}
              className={`tree-item ${active ? 'active' : ''}`}
              onClick={() => onSelect({ kind: 'message', rawId: m.rawId, occ })}
              title={`${hexId(m.id, m.isExtended)} ${m.name} — ${m.signals.length} signals`}
            >
              <span className="id">{hexId(m.id, m.isExtended)}</span>
              <span className="name">{m.name}</span>
              {m.isExtended && <span className="pill ext">EXT</span>}
              {isCanFd(db, m) && <span className="pill fd">FD</span>}
              <span className="count">{m.signals.length}</span>
            </button>
          );
        })}
        {messages.length === 0 && <div className="tree-empty">no matches</div>}
      </div>

      <div className="tree-section">
        <div className="tree-header">Nodes ({nodes.length})</div>
        {nodes.map((n) => (
          <button
            key={n.name}
            className={`tree-item ${
              selection.kind === 'node' && selection.name === n.name ? 'active' : ''
            }`}
            onClick={() => onSelect({ kind: 'node', name: n.name })}
          >
            <span className="name">{n.name}</span>
          </button>
        ))}
        {nodes.length === 0 && <div className="tree-empty">no matches</div>}
      </div>

      {db.valueTables.length > 0 && (
        <div className="tree-section">
          <div className="tree-header">Value tables ({valueTables.length})</div>
          {valueTables.map((t) => (
            <button
              key={t.name}
              className={`tree-item ${
                selection.kind === 'valueTable' && selection.name === t.name ? 'active' : ''
              }`}
              onClick={() => onSelect({ kind: 'valueTable', name: t.name })}
            >
              <span className="name">{t.name}</span>
              <span className="count">{Object.keys(t.values).length}</span>
            </button>
          ))}
          {valueTables.length === 0 && <div className="tree-empty">no matches</div>}
        </div>
      )}
    </div>
  );
}
