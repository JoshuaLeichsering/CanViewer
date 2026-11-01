import type { Selection } from '../App';
import { replaceMessage, replaceSignal } from '../lib/dbc/edit';
import { occurrenceOf } from '../lib/dbc/identity';
import type { DbcDatabase, DbcMessage, DbcSignal } from '../lib/dbc/types';
import { MessageEditor } from './MessageEditor';
import { SignalEditor } from './SignalEditor';

/** Applies an edited database, and the selection that shows the edited object. */
export type OnEdit = (db: DbcDatabase, selection: Selection) => void;

/**
 * The editors of the message page, for MessageDetail's action slots. An edit
 * replaces the message or signal in a new database; the selection follows a
 * changed id or signal name, so the page stays on what was edited.
 */
export function messageEditActions(
  db: DbcDatabase,
  message: DbcMessage,
  selectedSignal: string | undefined,
  onEdit: OnEdit,
): { headerActions: React.ReactNode; signalActions: (signal: DbcSignal) => React.ReactNode } {
  const select = (next: DbcDatabase, m: DbcMessage, signal: string | undefined): Selection => ({
    kind: 'message',
    rawId: m.rawId,
    occ: occurrenceOf(next, m),
    signal,
  });
  return {
    headerActions: (
      <MessageEditor
        db={db}
        message={message}
        onApply={(updated) => {
          const next = replaceMessage(db, message, updated);
          onEdit(next, select(next, updated, selectedSignal));
        }}
      />
    ),
    signalActions: (signal) => (
      <SignalEditor
        db={db}
        message={message}
        signal={signal}
        onApply={(updated) => {
          const next = replaceSignal(db, message, signal, updated);
          onEdit(next.db, select(next.db, next.message, updated.name));
        }}
      />
    ),
  };
}
