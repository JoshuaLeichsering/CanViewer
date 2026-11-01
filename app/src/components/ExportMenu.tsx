// SPDX-License-Identifier: GPL-2.0-or-later
import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';
import { copyText, downloadText, exportFile, type ExportKind } from '../lib/export/download';
import { cStruct } from '../lib/export/c-struct';
import { decodePseudoCode } from '../lib/export/pseudo-code';
import { useI18n, type MsgKey } from '../lib/i18n';
import { ExpMenuButton, ExpMenuError } from './ExpMenuButton';

const EXPORTS: Array<[ExportKind, MsgKey]> = [
  ['messagesCsv', 'expMessagesCsv'],
  ['signalsCsv', 'expSignalsCsv'],
  ['messagesJson', 'expMessagesJson'],
];

/** The overview's "Export" menu: the message and signal list as CSV or JSON, saved as a download. */
export function ExportMenu({ db, fileName }: { db: DbcDatabase; fileName: string }) {
  const { t } = useI18n();
  return (
    <ExpMenuButton
      label={t('expExport')}
      title={t('expExportTitle')}
      icon="download"
      okLabel={t('expExported')}
      errorLabel={t('expExportFailedShort')}
      errorText={t('expExportFailed')}
      testId="exp-export-button"
      items={EXPORTS.map(([kind, label]) => ({
        key: kind,
        label: t(label),
        run: async () => {
          const file = exportFile(db, fileName, kind);
          downloadText(file.name, file.type, file.text);
          return t('expExportedFile', { name: file.name });
        },
      }))}
    />
  );
}

/** The message page's "Copy as" menu: the message as a C struct or as decode pseudo-code. */
export function CopyCodeMenu({ db, message, fileName }: { db: DbcDatabase; message: DbcMessage; fileName: string }) {
  const { t } = useI18n();
  const copy = async (text: string, done: string) => {
    if (!(await copyText(text))) throw new ExpMenuError(t('expClipboardUnavailable'));
    return done;
  };
  return (
    <ExpMenuButton
      className="exp-push"
      label={t('expCopyAs')}
      title={t('expCopyTitle')}
      icon="content_copy"
      okLabel={t('expCopied')}
      errorLabel={t('expCopyFailedShort')}
      errorText={t('expCopyFailed')}
      testId="exp-copy-button"
      items={[
        {
          key: 'cStruct',
          label: t('expCStruct'),
          run: () => copy(cStruct(db, message, fileName), t('expCopiedCStruct', { name: message.name })),
        },
        {
          key: 'pseudoCode',
          label: t('expPseudoCode'),
          run: () => copy(decodePseudoCode(db, message, fileName), t('expCopiedPseudoCode', { name: message.name })),
        },
      ]}
    />
  );
}
