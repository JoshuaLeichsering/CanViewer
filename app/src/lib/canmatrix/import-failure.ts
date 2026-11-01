/**
 * Why an import failed, when CanViewer knows the reason rather than
 * canmatrix: the file holds no CAN database, or the Python runtime or the
 * format's packages could not be loaded (offline before the first import,
 * say). The UI shows these in the user's language (app/src/lib/import/messages.ts);
 * canmatrix's own errors are shown as canmatrix wrote them.
 */
export type ImportFailureReason = 'no-database' | 'runtime' | 'packages';

export class ImportFailure extends Error {
  readonly reason: ImportFailureReason;

  /** `message` is the technical detail, in English, for the console and for tests. */
  constructor(reason: ImportFailureReason, message: string) {
    super(message);
    this.name = 'ImportFailure';
    this.reason = reason;
  }
}

/** The file was read, but holds no CAN cluster. */
export function noDatabase(): ImportFailure {
  return new ImportFailure('no-database', 'canmatrix found no CAN database in this file');
}
