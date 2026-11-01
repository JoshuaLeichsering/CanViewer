import { useState } from 'react';
import type { DbcDatabase } from '../lib/dbc/types';
import { notWritten, writeDbc, type DbcNotWritten, type DbcWriteIssueKind, type DbcWriteResult } from '../lib/dbc/writer';
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

/**
 * Hands the text to the browser as a download; nothing leaves the machine.
 * In the desktop app, the webview saves a blob: download only through a
 * download handler in the shell (desktop/src/main.rs).
 */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking at once can cancel a download that has not started reading the Blob yet.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

interface Pending {
  result: DbcWriteResult;
  lost: DbcNotWritten;
}

/**
 * The rail's Save as DBC button. It writes the database with the DBC writer
 * (UTF-8) and saves it as a download. When the saved file would lack
 * something, a dialog lists it first and saves only on Save anyway, so that
 * nothing is lost silently: what the file held that CanViewer does not model
 * or could not read, and what the writer reports the DBC format cannot hold.
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
  onSaved: (savedAs: string, text: string) => void;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);

  const save = (result: DbcWriteResult) => {
    const name = dbcFileName(fileName);
    download(name, result.text);
    setPending(null);
    onSaved(name, result.text);
  };
  const start = () => {
    const result = writeDbc(db);
    const lost = notWritten(db);
    if (result.issues.length > 0 || lost.skipped.length > 0 || lost.problems > 0) setPending({ result, lost });
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
          onSubmit={() => save(pending.result)}
          onCancel={() => setPending(null)}
          testId="edt-issues-dialog"
        >
          {(pending.lost.skipped.length > 0 || pending.lost.problems > 0) && <LostList lost={pending.lost} />}
          {pending.result.issues.length > 0 && (
            <>
              <p className="edt-hint">{t('edtIssuesHint')}</p>
              <ul className="edt-issues" data-testid="edt-issue-list">
                {pending.result.issues.slice(0, SHOWN_ISSUES).map((issue, i) => (
                  <li key={i}>
                    <code>{issue.where}</code> <code className="edt-issue-field">{issue.field}</code> {t(ISSUE_TEXT[issue.kind])}
                  </li>
                ))}
              </ul>
              {pending.result.issues.length > SHOWN_ISSUES && (
                <p className="edt-hint">{t('edtIssuesMore', { n: pending.result.issues.length - SHOWN_ISSUES })}</p>
              )}
            </>
          )}
        </EditDialog>
      )}
    </>
  );
}

/** What the file held that the model does not: the statements it skipped and the lines it could not use. */
function LostList({ lost }: { lost: DbcNotWritten }) {
  const { t } = useI18n();
  const statements = lost.skipped.reduce((sum, [, count]) => sum + count, 0);
  // The same spelling as the overview's "Not displayed" strip.
  const list = lost.skipped.map(([keyword, count]) => `${keyword} (${count}×)`).join(' · ');
  return (
    <>
      <p className="edt-hint">{t('edtLossHint')}</p>
      <ul className="edt-issues" data-testid="edt-loss-list">
        {statements > 0 && (
          <li data-testid="edt-loss-skipped">
            {t(statements === 1 ? 'edtLossSkippedOne' : 'edtLossSkippedMany', { n: statements, list })}
          </li>
        )}
        {lost.problems > 0 && (
          <li data-testid="edt-loss-problems">
            {t(lost.problems === 1 ? 'edtLossProblemsOne' : 'edtLossProblemsMany', { n: lost.problems })}
          </li>
        )}
      </ul>
    </>
  );
}
