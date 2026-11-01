import { useI18n, type MsgKey } from '../lib/i18n';
import { Icon } from './Icon';

export type ListKind = 'messages' | 'nodes' | 'tables';

const LABEL: Record<ListKind, MsgKey> = {
  messages: 'rghBackMessages',
  nodes: 'rghBackNodes',
  tables: 'rghBackTables',
};

/**
 * Back from a detail to its list. Only shown on narrow screens, where the list
 * pane and the detail take turns (narrow.css); hidden otherwise.
 */
export function BackToList({ kind, onBack }: { kind: ListKind; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <button className="btn text with-icon state rgh-back" onClick={onBack}>
      <Icon name="arrow_back" size={18} />
      {t(LABEL[kind])}
    </button>
  );
}
