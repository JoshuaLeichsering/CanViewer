// SPDX-License-Identifier: GPL-2.0-or-later
import { useI18n } from '../lib/i18n';
import { EditDialog } from './EditDialog';

/**
 * Asks before another file replaces unsaved edits. An in-app dialog rather
 * than window.confirm, which a webview shows only if its host implements it,
 * so it asks the same way in every browser and in the desktop app. The focus
 * starts on Cancel, the safe choice.
 */
export function DiscardEditsDialog({
  fileName,
  nextName,
  onDiscard,
  onCancel,
}: {
  fileName: string;
  nextName: string;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <EditDialog title={t('edtDiscardTitle')} submitLabel={t('edtDiscard')} onSubmit={onDiscard} onCancel={onCancel} testId="edt-discard-dialog">
      <p className="edt-hint">{t('edtDiscardText', { name: fileName, next: nextName })}</p>
    </EditDialog>
  );
}
