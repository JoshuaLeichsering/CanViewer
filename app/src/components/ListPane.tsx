// SPDX-License-Identifier: GPL-2.0-or-later
import { useMemo, useRef } from 'react';
import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { isCanFd } from '../lib/dbc/canfd';
import { isJ1939Database } from '../lib/dbc/j1939';
import { useI18n } from '../lib/i18n';
import { hexId } from '../lib/format';
import { onListKeyDown } from '../lib/keyboard';
import { shouldVirtualize } from '../lib/virtual-window';
import { Icon } from './Icon';
import { messageTag, MessageTag } from './MessageTag';
import { useHintFits } from './useHintFits';
import { VirtualList, type VirtualListHandle } from './VirtualList';

export type MessageFilter = 'all' | 'ext' | 'fd';

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

/** Material list pane for the Messages, Nodes and Tables destinations. */
export function ListPane(props: {
  db: DbcDatabase;
  kind: 'messages' | 'nodes' | 'tables';
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Selection by the arrow keys, which keeps the list in view on narrow screens (defaults to onSelect). */
  onBrowse?: (s: Selection) => void;
  search: string;
  onSearch: (q: string) => void;
  filter: MessageFilter;
  onFilter: (f: MessageFilter) => void;
}) {
  const { t } = useI18n();
  const label = { messages: t('railMessages'), nodes: t('railNodes'), tables: t('statValueTables') }[props.kind];
  return (
    // Named, so that the pane is a landmark region.
    <section className="list-pane" aria-label={label}>
      {props.kind === 'messages' && <MessageList {...props} />}
      {props.kind === 'nodes' && <NodeList {...props} />}
      {props.kind === 'tables' && <TableList {...props} />}
    </section>
  );
}

function MessageList({
  db,
  selection,
  onSelect,
  onBrowse = onSelect,
  search,
  onSearch,
  filter,
  onFilter,
}: Parameters<typeof ListPane>[0]) {
  const { t, tn } = useI18n();
  const query = search.trim();
  const j1939Db = useMemo(() => isJ1939Database(db), [db]);
  const messages = useMemo(() => {
    const sorted = [...db.messages].sort((a, b) => a.id - b.id);
    return sorted.filter(
      (m) =>
        (filter === 'all' || (filter === 'ext' && m.isExtended) || (filter === 'fd' && isCanFd(db, m))) &&
        (query === '' || messageMatches(m, query)),
    );
  }, [db, query, filter]);
  const activeIndex =
    selection.kind === 'message'
      ? messages.findIndex((m) => m.rawId === selection.rawId && occurrenceOf(db, m) === selection.occ)
      : -1;

  const searchRef = useRef<HTMLInputElement>(null);
  const hintRef = useRef<HTMLElement>(null);
  const hintFits = useHintFits(searchRef, hintRef, t('searchPlaceholder'), search === '');
  const listRef = useRef<VirtualListHandle>(null);
  const selectionOf = (m: DbcMessage): Selection => ({ kind: 'message', rawId: m.rawId, occ: occurrenceOf(db, m) });
  // From the search field, ↓ goes to the selected message (or the first match)
  // and Enter opens it.
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (messages.length === 0 || (e.key !== 'ArrowDown' && e.key !== 'Enter')) return;
    e.preventDefault();
    const index = Math.max(activeIndex, 0);
    if (e.key === 'Enter') return onSelect(selectionOf(messages[index]));
    if (activeIndex < 0) onBrowse(selectionOf(messages[0]));
    // The row may be out of view, and in a long list not rendered yet.
    listRef.current?.focusRow(index);
  };

  const filters: Array<[MessageFilter, string]> = [
    ['all', t('filterAll')],
    ['ext', t('filterExtended')],
    ['fd', t('filterFd')],
  ];

  return (
    <>
      <div className="list-top">
        <label className="search-field">
          <Icon name="search" size={22} />
          <input
            ref={searchRef}
            type="search"
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            aria-keyshortcuts="/"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          {search === '' && (
            <kbd ref={hintRef} className={hintFits ? 'rgh-kbd' : 'rgh-kbd rgh-kbd-off'} aria-hidden="true">
              /
            </kbd>
          )}
          {search !== '' && (
            <button className="clear state" title={t('clearSearch')} aria-label={t('clearSearch')} onClick={() => onSearch('')}>
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
              onClick={() => onFilter(key)}
            >
              {filter === key && <Icon name="check" size={18} />}
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="list-label">
        {t('listMessages', {
          n: query !== '' || filter !== 'all' ? `${messages.length} / ${db.messages.length}` : messages.length,
        })}
      </div>
      <VirtualList
        handleRef={listRef}
        className="list-scroll"
        items={messages}
        virtual={shouldVirtualize(db.messages.length)}
        estimatedRowHeight={60}
        activeKey={selection.kind === 'message' ? `${selection.rawId}.${selection.occ}` : undefined}
        activeIndex={activeIndex}
        onKeyDown={(e) =>
          onListKeyDown(
            e,
            messages.length,
            (i) => {
              onBrowse(selectionOf(messages[i]));
              // Home and End in a long list go to rows that are not rendered yet.
              listRef.current?.focusRow(i);
            },
            () => searchRef.current?.focus(),
          )
        }
        renderItem={(m, i) => {
          const occ = occurrenceOf(db, m);
          const active = selection.kind === 'message' && selection.rawId === m.rawId && selection.occ === occ;
          const cycle = m.attributes.GenMsgCycleTime;
          const sub = [
            m.sender,
            tn('signalsOne', 'signalsMany', m.signals.length),
            cycle !== undefined && Number(cycle) > 0 ? t('cycleMs', { n: String(cycle) }) : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <button
              key={`${m.rawId}.${occ}`}
              className={`list-item state ${active ? 'active' : ''}`}
              aria-current={active ? 'true' : undefined}
              data-rgh-index={i}
              onClick={() => onSelect({ kind: 'message', rawId: m.rawId, occ })}
            >
              <span className="id">{hexId(m.id, m.isExtended)}</span>
              <span className="text">
                <span className="title">{m.name}</span>
                <span className="sub">{sub}</span>
              </span>
              <MessageTag tag={messageTag(db, m, j1939Db)} />
            </button>
          );
        }}
      >
        {messages.length === 0 && (
          <div className="list-empty">
            {query !== '' ? t('noMessagesMatch', { q: query }) : t('noMessagesFilter')}
          </div>
        )}
      </VirtualList>
    </>
  );
}

function NodeList({ db, selection, onSelect, onBrowse = onSelect }: Parameters<typeof ListPane>[0]) {
  const { t } = useI18n();
  const counts = useMemo(
    () =>
      new Map(
        db.nodes.map((n) => [
          n.name,
          {
            tx: db.messages.filter((m) => m.sender === n.name || m.transmitters.includes(n.name)).length,
            rx: db.messages.reduce((k, m) => k + m.signals.filter((s) => s.receivers.includes(n.name)).length, 0),
          },
        ]),
      ),
    [db],
  );
  return (
    <>
      <div className="list-label">{t('listNodes', { n: db.nodes.length })}</div>
      <div
        className="list-scroll"
        onKeyDown={(e) => onListKeyDown(e, db.nodes.length, (i) => onBrowse({ kind: 'node', name: db.nodes[i].name }))}
      >
        {db.nodes.map((n, i) => {
          const active = selection.kind === 'node' && selection.name === n.name;
          const c = counts.get(n.name)!;
          const sub = [n.comment?.split('\n')[0], t('txRx', { tx: c.tx, rx: c.rx })].filter(Boolean).join(' · ');
          return (
            <button
              key={n.name}
              data-rgh-index={i}
              className={`list-item state ${active ? 'active' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect({ kind: 'node', name: n.name })}
            >
              <span className="avatar">{n.name.slice(0, 2)}</span>
              <span className="text">
                <span className="title">{n.name}</span>
                <span className="sub">{sub}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function TableList({ db, selection, onSelect, onBrowse = onSelect }: Parameters<typeof ListPane>[0]) {
  const { t, tn } = useI18n();
  return (
    <>
      <div className="list-label">{t('listTables', { n: db.valueTables.length })}</div>
      <div
        className="list-scroll"
        onKeyDown={(e) =>
          onListKeyDown(e, db.valueTables.length, (i) => onBrowse({ kind: 'valueTable', name: db.valueTables[i].name }))
        }
      >
        {db.valueTables.map((tbl, i) => {
          const active = selection.kind === 'valueTable' && selection.name === tbl.name;
          return (
            <button
              key={tbl.name}
              data-rgh-index={i}
              className={`list-item state ${active ? 'active' : ''}`}
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect({ kind: 'valueTable', name: tbl.name })}
            >
              <Icon name="table_rows" />
              <span className="text">
                <span className="title">{tbl.name}</span>
                <span className="sub">{tn('entriesOne', 'entriesMany', Object.keys(tbl.values).length)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
