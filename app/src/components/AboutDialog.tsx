// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from 'react';
import { useI18n, type MsgKey } from '../lib/i18n';
import { EditDialog } from './EditDialog';
import './about.css';

/** Where the source code is, at every release tag. */
export const SOURCE_URL = 'https://github.com/JoshuaLeichsering/CanViewer';

/**
 * CanViewer's license files and the third-party notices, as the build puts
 * them next to index.html (scripts/vite-legal.ts): the web app serves them
 * from its own origin, and the desktop app has them in its bundle.
 */
export const LEGAL_DOCUMENTS: Array<{ file: string; label: MsgKey }> = [
  { file: 'COPYRIGHT.txt', label: 'abtDocCopyright' },
  { file: 'LICENSE.txt', label: 'abtDocGpl2' },
  { file: 'LICENSE-GPL-3.0.txt', label: 'abtDocGpl3' },
  { file: 'THIRD_PARTY_NOTICES.md', label: 'abtDocNotices' },
];

type Shown = { file: string; state: 'loading' } | { file: string; state: 'shown'; text: string } | { file: string; state: 'failed'; error: string };

/**
 * About CanViewer, from the settings menu: the version, the license and the
 * no-warranty statement (the "appropriate legal notices" of the GPL), the
 * source link, and the license files and notices. A document opens in the
 * dialog itself, read from the app's own origin, so that it works the same in
 * the desktop app, which opens no other window; a modified click still opens
 * the file in a new tab of the browser.
 */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    if (shown?.state !== 'loading') return;
    let current = true;
    const { file } = shown;
    fetch(new URL(file, document.baseURI))
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(
        (text) => current && setShown({ file, state: 'shown', text }),
        (e: unknown) => current && setShown({ file, state: 'failed', error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      current = false;
    };
  }, [shown]);

  const open = (e: React.MouseEvent, file: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setShown({ file, state: 'loading' });
  };

  const label = (file: string) => t(LEGAL_DOCUMENTS.find((d) => d.file === file)?.label ?? 'abtDocNotices');

  return (
    <EditDialog title={t('abtMenu')} onCancel={onClose} cancelLabel={t('abtClose')} testId="abt-dialog">
      <p className="abt-version" data-testid="abt-version">
        <b>CanViewer</b> · {t('abtVersion', { version: __APP_VERSION__ })}
      </p>
      <p className="edt-hint">{t('abtLicense')}</p>
      <p className="edt-hint">{t('abtPermission')}</p>
      <p className="edt-hint">{t('abtWarranty')}</p>
      <h3 className="abt-heading">{t('abtSource')}</h3>
      <p className="edt-hint">
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" data-testid="abt-source">
          {SOURCE_URL.replace(/^https:\/\//, '')}
        </a>
      </p>
      <h3 className="abt-heading">{t('abtDocuments')}</h3>
      <ul className="abt-docs">
        {LEGAL_DOCUMENTS.map((d) => (
          <li key={d.file}>
            <a
              href={d.file}
              target="_blank"
              rel="noopener"
              aria-current={shown?.file === d.file ? 'true' : undefined}
              data-testid="abt-doc"
              onClick={(e) => open(e, d.file)}
            >
              {t(d.label)}
            </a>{' '}
            <span className="abt-file">{d.file}</span>
          </li>
        ))}
      </ul>
      <p className="edt-hint">{t('abtDocsHint')}</p>
      {shown && (
        <div className="abt-shown" data-testid="abt-shown" aria-live="polite">
          {shown.state === 'loading' && <p className="edt-hint">{t('abtLoading', { name: shown.file })}</p>}
          {shown.state === 'failed' && (
            <p className="edt-hint abt-error" role="alert">
              {t('abtLoadFailed', { name: shown.file, error: shown.error })}
            </p>
          )}
          {shown.state === 'shown' && (
            <pre className="abt-text" tabIndex={0} aria-label={label(shown.file)} data-testid="abt-text">
              {shown.text}
            </pre>
          )}
        </div>
      )}
    </EditDialog>
  );
}
