import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';
import { copyText, downloadText, exportFile, type ExportKind } from '../lib/export/download';
import { cStruct } from '../lib/export/c-struct';
import { decodePseudoCode } from '../lib/export/pseudo-code';
import { useI18n, type MsgKey } from '../lib/i18n';
import { ExpMenuButton } from './ExpMenuButton';

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
      errorLabel={t('expExport')}
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
    try {
      await copyText(text);
    } catch (e) {
      throw new Error(t('expCopyFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
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
