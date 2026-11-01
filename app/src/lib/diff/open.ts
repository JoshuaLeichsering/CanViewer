import { importWithCanmatrix, type ImportStage } from '../canmatrix/client';
import { canmatrixFormatFor } from '../canmatrix/formats';
import { parseDbc } from '../dbc/parser';
import type { DbcDatabase } from '../dbc/types';

/**
 * Reads the other version of a database for diff mode the way the app opens a
 * file: DBC with CanViewer's own parser, every other format through canmatrix
 * in the import worker (loaded on first use). Nothing leaves the machine.
 */
export async function readDatabaseFile(file: File, onStage?: (stage: ImportStage) => void): Promise<DbcDatabase> {
  if (canmatrixFormatFor(file.name)) return (await importWithCanmatrix(file, onStage)).db;
  return parseDbc(decodeDbc(await file.arrayBuffer()));
}

/** DBC files from Vector tools are often Windows-1252; fall back to it when the bytes are not UTF-8. */
export function decodeDbc(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
