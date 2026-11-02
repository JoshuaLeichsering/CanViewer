// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { EditError } from '../lib/dbc/edit';
import { useI18n } from '../lib/i18n';
import './editing.css';

const FOCUSABLE = 'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])';

/**
 * A Material 3 dialog holding a form, for the editors and the Save as DBC
 * check. It is modal: it takes the focus when it opens and gives it back when
 * it closes, keeps Tab inside, and Escape cancels. Clicking the scrim does not
 * close it, so a stray click cannot throw away what was typed. Without
 * `onSubmit` it has one button, which closes it (the About dialog).
 */
export function EditDialog({
  title,
  submitLabel,
  onSubmit,
  onCancel,
  cancelLabel,
  children,
  testId,
}: {
  title: string;
  submitLabel?: string;
  onSubmit?: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const form = formRef.current;
    const first =
      form?.querySelector<HTMLElement>('.edt-dialog-body input, .edt-dialog-body select, .edt-dialog-body textarea') ??
      form?.querySelector<HTMLElement>('.edt-dialog-actions button');
    first?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !formRef.current) return;
    const items = [...formRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="edt-scrim">
      <form
        ref={formRef}
        className="edt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        noValidate
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          (onSubmit ?? onCancel)();
        }}
      >
        <h2 id={titleId} className="edt-dialog-title">
          {title}
        </h2>
        <div className="edt-dialog-body">{children}</div>
        <div className="edt-dialog-actions">
          <button type="button" className="btn text state" data-testid="edt-cancel" onClick={onCancel}>
            {cancelLabel ?? t('edtCancel')}
          </button>
          {onSubmit && (
            <button type="submit" className="btn filled state" data-testid="edt-submit">
              {submitLabel}
            </button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** The error text of a field, translated; the lib returns i18n keys. */
function useErrorText(error?: EditError): string | undefined {
  const { t } = useI18n();
  return error ? t(error.key, error.params) : undefined;
}

export function TextField({
  label,
  value,
  onChange,
  error,
  testId,
  mono = false,
  multiline = false,
  wide = false,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: EditError;
  testId: string;
  mono?: boolean;
  multiline?: boolean;
  wide?: boolean;
  inputMode?: 'decimal' | 'numeric' | 'text';
}) {
  const helpId = useId();
  const errorText = useErrorText(error);
  const common = {
    value,
    'data-testid': testId,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': errorText ? helpId : undefined,
    spellCheck: false,
    autoComplete: 'off',
  } as const;
  return (
    <div className={`edt-field ${wide || multiline ? 'edt-wide' : ''}`}>
      <label className={`text-field edt-text-field ${multiline ? 'edt-multiline' : ''} ${mono ? 'edt-mono' : ''} ${error ? 'invalid' : ''}`}>
        <span className="field-label">{label}</span>
        {multiline ? (
          <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input {...common} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
        )}
      </label>
      {errorText && (
        <div className="field-help error" id={helpId}>
          {errorText}
        </div>
      )}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  error,
  testId,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
  error?: EditError;
  testId: string;
}) {
  const helpId = useId();
  const errorText = useErrorText(error);
  return (
    <div className="edt-field">
      <label className={`text-field edt-text-field ${error ? 'invalid' : ''}`}>
        <span className="field-label">{label}</span>
        <select
          value={value}
          data-testid={testId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorText ? helpId : undefined}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
      </label>
      {errorText && (
        <div className="field-help error" id={helpId}>
          {errorText}
        </div>
      )}
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}) {
  return (
    <label className="edt-check">
      <input type="checkbox" checked={checked} data-testid={testId} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
