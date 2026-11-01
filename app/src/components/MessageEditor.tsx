// SPDX-License-Identifier: GPL-2.0-or-later
import { useState } from 'react';
import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';
import { editMessage, messageDraft, type EditResult, type MessageDraft } from '../lib/dbc/edit';
import { useI18n } from '../lib/i18n';
import { CheckField, EditDialog, SelectField, TextField } from './EditDialog';
import { Icon } from './Icon';

/** The "Edit message" button of the message page, and the dialog it opens. */
export function MessageEditor({
  db,
  message,
  onApply,
}: {
  db: DbcDatabase;
  message: DbcMessage;
  onApply: (updated: DbcMessage) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [errors, setErrors] = useState<EditResult<DbcMessage, keyof MessageDraft>['errors']>({});

  const open = () => {
    setDraft(messageDraft(message));
    setErrors({});
  };
  const set = <K extends keyof MessageDraft>(key: K, value: MessageDraft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      // The ID's error depends on the extended flag as well.
      if (key === 'extended') delete next.id;
      return next;
    });
  };
  const submit = () => {
    if (!draft) return;
    const result = editMessage(db, message, draft);
    if (result.value) {
      setDraft(null);
      onApply(result.value);
    } else setErrors(result.errors);
  };

  const senders: Array<[string, string]> = [['', t('edtNoSender')], ...db.nodes.map((n): [string, string] => [n.name, n.name])];
  if (message.sender !== '' && !senders.some(([name]) => name === message.sender)) senders.push([message.sender, message.sender]);

  return (
    <>
      <button className="btn outlined with-icon state" data-testid="edt-edit-message" onClick={open}>
        <Icon name="edit" size={18} />
        {t('edtEditMessage')}
      </button>
      {draft && (
        <EditDialog
          title={t('edtMessageTitle', { name: message.name })}
          submitLabel={t('edtApply')}
          onSubmit={submit}
          onCancel={() => setDraft(null)}
          testId="edt-message-dialog"
        >
          <div className="edt-grid">
            <TextField label={t('edtName')} value={draft.name} onChange={(v) => set('name', v)} error={errors.name} testId="edt-message-name" mono wide />
            <TextField label={t('edtId')} value={draft.id} onChange={(v) => set('id', v)} error={errors.id} testId="edt-message-id" mono />
            <div className="edt-field edt-check-cell">
              <CheckField label={t('edtExtended')} checked={draft.extended} onChange={(v) => set('extended', v)} testId="edt-message-extended" />
            </div>
            <TextField label={t('edtDlc')} value={draft.dlc} onChange={(v) => set('dlc', v)} error={errors.dlc} testId="edt-message-dlc" mono inputMode="numeric" />
            <SelectField label={t('edtSender')} value={draft.sender} options={senders} onChange={(v) => set('sender', v)} error={errors.sender} testId="edt-message-sender" />
            <TextField label={t('edtComment')} value={draft.comment} onChange={(v) => set('comment', v)} error={errors.comment} testId="edt-message-comment" multiline />
          </div>
        </EditDialog>
      )}
    </>
  );
}
