/**
 * The last opened file, kept in the browser's localStorage so that it opens
 * again on the next start. Settings (language, theme) are stored separately
 * and are not affected by clearing it.
 */
export const STORED_FILE_KEY = 'canviewer.file';

export interface StoredFile {
  name: string;
  text: string;
}

/**
 * The stored file, or null when there is none, storage is unavailable, or the
 * stored value is not a file as this app writes it (for example corrupted, or
 * written by another version).
 */
export function readStoredFile(): StoredFile | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORED_FILE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const { name, text } = value as Record<string, unknown>;
    return typeof name === 'string' && typeof text === 'string' ? { name, text } : null;
  } catch {
    return null;
  }
}

/**
 * Forgets the stored file, so that the next start shows the welcome screen.
 * This is the escape hatch of the error boundary: a file that makes a view
 * crash would otherwise crash the app again on every start.
 */
export function clearStoredFile(): void {
  try {
    localStorage.removeItem(STORED_FILE_KEY);
  } catch {
    // Storage unavailable: then nothing was stored either.
  }
}
