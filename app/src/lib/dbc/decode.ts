/**
 * The text of a DBC file. DBC files from Vector tools are often Windows-1252,
 * so the bytes are read as UTF-8 when they are valid UTF-8 and as
 * Windows-1252 otherwise. Used wherever the app opens a DBC file.
 */
export function decodeDbc(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
