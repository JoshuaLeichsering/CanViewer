import { useState } from 'react';
import type { ByteOrder, DbcDatabase, DbcMessage, DbcSignal, SignalValueType } from '../lib/dbc/types';
import { editSignal, receiverOptions, signalDraft, type EditResult, type SignalDraft } from '../lib/dbc/edit';
import { useI18n } from '../lib/i18n';
import { EditDialog, SelectField, TextField } from './EditDialog';
import { Icon } from './Icon';

const BYTE_ORDERS: Array<[ByteOrder, string]> = [
  ['intel', 'Intel'],
  ['motorola', 'Motorola'],
];
// Signal type names stay untranslated, as everywhere in the app.
const VALUE_TYPES: Array<[SignalValueType, string]> = [
  ['unsigned', 'unsigned'],
  ['signed', 'signed'],
  ['float', 'float'],
  ['double', 'double'],
];

/** The "Edit signal" button of the signal card, and the dialog it opens. */
export function SignalEditor({
  db,
  message,
  signal,
  onApply,
}: {
  db: DbcDatabase;
  message: DbcMessage;
  signal: DbcSignal;
  onApply: (updated: DbcSignal) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SignalDraft | null>(null);
  const [errors, setErrors] = useState<EditResult<DbcSignal, keyof SignalDraft>['errors']>({});

  const open = () => {
    setDraft(signalDraft(signal));
    setErrors({});
  };
  const set = <K extends keyof SignalDraft>(key: K, value: SignalDraft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      // A float's length is checked against its type.
      if (key === 'valueType') delete next.length;
      return next;
    });
  };
  const submit = () => {
    if (!draft) return;
    const result = editSignal(db, message, signal, draft);
    if (result.value) {
      setDraft(null);
      onApply(result.value);
    } else setErrors(result.errors);
  };

  const nodes = receiverOptions(db, signal);
  // Receivers from the file keep the file's order, and new ones follow in the order they were
  // checked, so unchecking and checking one again gives back the file's list exactly.
  const toggleReceiver = (name: string, on: boolean) => {
    if (!draft) return;
    const next = on ? [...draft.receivers, name] : draft.receivers.filter((r) => r !== name);
    const original = signal.receivers;
    set('receivers', [...original.filter((r) => next.includes(r)), ...next.filter((r) => !original.includes(r))]);
  };

  return (
    <>
      <button className="btn tonal with-icon state" data-testid="edt-edit-signal" onClick={open}>
        <Icon name="edit" size={18} />
        {t('edtEditSignal')}
      </button>
      {draft && (
        <EditDialog
          title={t('edtSignalTitle', { name: signal.name })}
          submitLabel={t('edtApply')}
          onSubmit={submit}
          onCancel={() => setDraft(null)}
          testId="edt-signal-dialog"
        >
          <div className="edt-grid">
            <TextField label={t('edtName')} value={draft.name} onChange={(v) => set('name', v)} error={errors.name} testId="edt-signal-name" mono wide />
            <TextField label={t('edtStartBit')} value={draft.startBit} onChange={(v) => set('startBit', v)} error={errors.startBit} testId="edt-signal-start" mono inputMode="numeric" />
            <TextField label={t('edtLength')} value={draft.length} onChange={(v) => set('length', v)} error={errors.length} testId="edt-signal-length" mono inputMode="numeric" />
            <SelectField label={t('edtByteOrder')} value={draft.byteOrder} options={BYTE_ORDERS} onChange={(v) => set('byteOrder', v)} testId="edt-signal-order" />
            <SelectField label={t('edtValueType')} value={draft.valueType} options={VALUE_TYPES} onChange={(v) => set('valueType', v)} error={errors.valueType} testId="edt-signal-type" />
            <TextField label={t('edtFactor')} value={draft.factor} onChange={(v) => set('factor', v)} error={errors.factor} testId="edt-signal-factor" mono inputMode="decimal" />
            <TextField label={t('edtOffset')} value={draft.offset} onChange={(v) => set('offset', v)} error={errors.offset} testId="edt-signal-offset" mono inputMode="decimal" />
            <TextField label={t('edtMin')} value={draft.min} onChange={(v) => set('min', v)} error={errors.min} testId="edt-signal-min" mono inputMode="decimal" />
            <TextField label={t('edtMax')} value={draft.max} onChange={(v) => set('max', v)} error={errors.max} testId="edt-signal-max" mono inputMode="decimal" />
            <TextField label={t('edtUnit')} value={draft.unit} onChange={(v) => set('unit', v)} error={errors.unit} testId="edt-signal-unit" wide />
            <fieldset className="edt-field edt-wide edt-receivers">
              <legend>{t('edtReceivers')}</legend>
              {nodes.length === 0 ? (
                <span className="muted">{t('edtNoNodes')}</span>
              ) : (
                nodes.map((name) => (
                  <label key={name} className={`edt-chip ${draft.receivers.includes(name) ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={draft.receivers.includes(name)}
                      data-testid={`edt-signal-receiver-${name}`}
                      onChange={(e) => toggleReceiver(name, e.target.checked)}
                    />
                    {name}
                  </label>
                ))
              )}
            </fieldset>
            <TextField label={t('edtComment')} value={draft.comment} onChange={(v) => set('comment', v)} error={errors.comment} testId="edt-signal-comment" multiline />
          </div>
        </EditDialog>
      )}
    </>
  );
}
