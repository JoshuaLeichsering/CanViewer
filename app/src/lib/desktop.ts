// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * True in the desktop app. The Tauri shell (desktop/) defines this global in
 * every page it shows, before the app's own scripts run; a browser never does.
 */
export function inDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
