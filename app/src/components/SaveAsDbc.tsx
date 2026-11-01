import { useState } from 'react';
import type { DbcDatabase } from '../lib/dbc/types';
import { writeDbc, type DbcWriteIssueKind, type DbcWriteResult } from '../lib/dbc/writer';
import { useI18n, type MsgKey } from '../lib/i18n';
import { EditDialog } from './EditDialog';
import { Icon } from './Icon';

const ISSUE_TEXT: Record<DbcWriteIssueKind, MsgKey> = {
  identifier: 'edtIssueIdentifier',
  listName: 'edtIssueListName',
  quote: 'edtIssueQuote',
  backslash: 'edtIssueBackslash',
  integer: 'edtIssueInteger',
  signalBits: 'edtIssueSignalBits',
  enumIndex: 'edtIssueEnumIndex',
  number: 'edtIssueNumber',
  ambiguous: 'edtIssueAmbiguous',
};

/** How many issues the dialog lists before it summarizes the rest. */
const SHOWN_ISSUES = 100;

/** The name a database is saved under: its file name with .dbc as the extension. */
export function dbcFileName(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]*$/, '');
  return `${base === '' ? 'database' : base}.dbc`;
}

/** Hands the text to the browser as a download; nothing leaves the machine. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * The rail's Save as DBC button. It writes the database with the DBC writer
 * (UTF-8) and saves it as a download. When the writer reports something the
 * DBC format cannot hold, a dialog lists it first, so nothing is lost
 * silently.
 */
export function SaveAsDbcButton({
  db,
  fileName,
  edited,
  onSaved,
}: {
  db: DbcDatabase;
  fileName: string;
  edited: boolean;
  onSaved: (savedAs: string) => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<DbcWriteResult | null>(null);

  const save = (result: DbcWriteResult) => {
    const name = dbcFileName(fileName);
    download(name, result.text);
    setPending(null);
    onSaved(name);
  };
  const start = () => {
    const result = writeDbc(db);
    if (result.issues.length > 0) setPending(result);
    else save(result);
  };

  const label = edited ? t('edtSaveAsDbcEdited') : t('edtSaveAsDbc');
  return (
    <>
      <button className="rail-icon-btn state edt-save" title={label} aria-label={label} data-testid="edt-save-dbc" onClick={start}>
        <Icon name="download" />
        {edited && <span className="edt-save-dot" data-testid="edt-unsaved" />}
      </button>
      {pending && (
        <EditDialog
          title={t('edtIssuesTitle')}
          submitLabel={t('edtSaveAnyway')}
          onSubmit={() => save(pending)}
          onCancel={() => setPending(null)}
          testId="edt-issues-dialog"
        >
          <p className="edt-hint">{t('edtIssuesHint')}</p>
          <ul className="edt-issues">
            {pending.issues.slice(0, SHOWN_ISSUES).map((issue, i) => (
              <li key={i}>
                <code>{issue.where}</code> <code className="edt-issue-field">{issue.field}</code> {t(ISSUE_TEXT[issue.kind])}
              </li>
            ))}
          </ul>
          {pending.issues.length > SHOWN_ISSUES && (
            <p className="edt-hint">{t('edtIssuesMore', { n: pending.issues.length - SHOWN_ISSUES })}</p>
          )}
        </EditDialog>
      )}
    </>
  );
}
