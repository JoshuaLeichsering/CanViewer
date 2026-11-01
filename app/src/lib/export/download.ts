import type { DbcDatabase } from '../dbc/types';
import { exportStem, messagesCsv, messagesJson, signalsCsv } from './table';

/**
 * Everything here stays on the machine: a download is a Blob handed to the
 * browser (or the desktop app's webview, which saves it to the Downloads
 * folder), and copying goes to the system clipboard. Nothing is sent anywhere.
 */

export type ExportKind = 'messagesCsv' | 'signalsCsv' | 'messagesJson';

/** Byte order mark: lets spreadsheet programs read the CSV as UTF-8. JSON must not have one (RFC 8259). */
const BOM = '﻿';

/** The file name, media type and content of one export of the database. */
export function exportFile(db: DbcDatabase, fileName: string, kind: ExportKind): { name: string; type: string; text: string } {
  const stem = exportStem(fileName);
  switch (kind) {
    case 'messagesCsv':
      return { name: `${stem}.messages.csv`, type: 'text/csv;charset=utf-8', text: BOM + messagesCsv(db) };
    case 'signalsCsv':
      return { name: `${stem}.signals.csv`, type: 'text/csv;charset=utf-8', text: BOM + signalsCsv(db) };
    case 'messagesJson':
      return { name: `${stem}.messages.json`, type: 'application/json', text: messagesJson(db, fileName) };
  }
}

/** Save text as a file, through a Blob URL and a temporary `<a download>`. */
export function downloadText(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once can cancel a download that has not started reading the Blob yet.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Put text on the clipboard; falls back to a selected text area where the Clipboard API is missing or refused. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Not available here (no secure context, or permission denied): try the old way.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('the clipboard is not available');
}
