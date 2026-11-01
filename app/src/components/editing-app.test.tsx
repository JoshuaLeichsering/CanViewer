// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { App } from '../App';
import { parseDbc } from '../lib/dbc/parser';
import { I18nProvider } from '../lib/i18n';
import { ThemeProvider } from '../lib/theme';
import { byTestId, click, queryTestId, render, text, type } from './dom-test-utils';
import demo from '../../../examples/demo.dbc?raw';

/**
 * Editing inside the whole app: the editors sit on the message page, an edit
 * follows the selection, the rail marks unsaved edits, and Save as DBC hands
 * out text that reads back with the edits.
 */
let downloads: Array<{ name: string; text: Promise<string> }>;
let view: ReturnType<typeof render> | undefined;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('canviewer.file', JSON.stringify({ name: 'demo.dbc', text: demo }));
  history.replaceState(null, '', '/#msg=256/EngineSpeed');
  downloads = [];
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, text: blobs.get(this.href)!.text() });
  });
});
afterEach(() => {
  view?.unmount();
  view = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
});

function start() {
  view = render(
    <I18nProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </I18nProvider>,
  );
}

const heading = () => text(document.querySelector('.page-header h1'));
const input = (id: string) => byTestId<HTMLInputElement>(id);
const snackbar = () => text(document.querySelector('.snackbar .msg'));
const unloadBlocked = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

function editMessage(fields: Record<string, string>) {
  click(byTestId('edt-edit-message'));
  for (const [id, value] of Object.entries(fields)) type(input(id), value);
  click(byTestId('edt-submit'));
}

async function openFile(name: string, content: string) {
  const fileInput = document.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File([content], name)] });
  await act(async () => {
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('editing in the app', () => {
  it('edits a message and a signal, follows the selection, and saves both as DBC', async () => {
    start();
    expect(heading()).toBe('EngineData');
    expect(queryTestId('edt-unsaved')).toBeNull();
    expect(unloadBlocked()).toBe(false);

    editMessage({ 'edt-message-name': 'EngineStatus', 'edt-message-id': '0x120' });
    expect(heading()).toBe('EngineStatus');
    // The page stays on the edited message under its new id, with the signal still selected.
    expect(location.hash).toBe('#msg=288/EngineSpeed');
    expect(text(document.querySelector('.list-pane'))).toContain('EngineStatus');
    expect(queryTestId('edt-unsaved')).not.toBeNull();
    expect(snackbar()).toBe('Change applied. Save as DBC to keep it.');
    expect(unloadBlocked()).toBe(true);

    click(byTestId('edt-edit-signal'));
    type(input('edt-signal-name'), 'EngineRpm');
    type(input('edt-signal-factor'), '0.5');
    click(byTestId('edt-submit'));
    expect(location.hash).toBe('#msg=288/EngineRpm');
    expect(text(document.querySelector('.signal-card h2'))).toBe('EngineRpm');
    const row = [...document.querySelectorAll('table.m3 tbody tr')].find((tr) => text(tr).includes('EngineRpm'))!;
    expect(row.classList.contains('selected')).toBe(true);
    expect(text(row)).toContain('0.5');

    click(byTestId('edt-save-dbc'));
    expect(downloads.map((d) => d.name)).toEqual(['demo.dbc']);
    const saved = await downloads[0].text;
    expect(saved).toContain('BO_ 288 EngineStatus: 8 ECM');
    expect(saved).toContain(' SG_ EngineRpm : 0|16@1+ (0.5,0) [0|16383.75] "rpm" TCM,ABS,IC');
    const reread = parseDbc(saved);
    expect(reread.problems).toEqual([]);
    expect(reread.messages.find((m) => m.name === 'EngineStatus')?.signals[0].comment).toBe('Crankshaft rotational speed.');

    expect(queryTestId('edt-unsaved')).toBeNull();
    expect(snackbar()).toBe('Saved demo.dbc');
    expect(unloadBlocked()).toBe(false);
  });

  it('a reload after saving restores what was saved, not the file before the edits', async () => {
    start();
    editMessage({ 'edt-message-name': 'EngineStatus' });
    click(byTestId('edt-save-dbc'));
    const saved = await downloads[0].text;
    expect(JSON.parse(localStorage.getItem('canviewer.file')!)).toEqual({ name: 'demo.dbc', text: saved });

    view!.unmount();
    start();
    expect(document.title).toBe('demo.dbc — CanViewer');
    expect(heading()).toBe('EngineStatus');
    expect(queryTestId('edt-unsaved')).toBeNull();
  });

  it('a file too large to store is not restored on reload, rather than the file before the edits', async () => {
    start();
    editMessage({ 'edt-message-name': 'EngineStatus' });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    click(byTestId('edt-save-dbc'));
    setItem.mockRestore();
    expect(downloads.map((d) => d.name)).toEqual(['demo.dbc']);
    expect(localStorage.getItem('canviewer.file')).toBeNull();
  });

  it('asks in its own dialog before another file replaces unsaved edits', async () => {
    start();
    editMessage({ 'edt-message-name': 'EngineStatus' });
    const confirm = vi.spyOn(window, 'confirm');
    await openFile('other.dbc', 'BO_ 1 Other: 8 X\n');
    const dialog = byTestId('edt-discard-dialog');
    expect(text(dialog.querySelector('h2'))).toBe('Discard unsaved edits?');
    expect(text(dialog.querySelector('.edt-hint'))).toBe('The edits to demo.dbc are not saved. Opening other.dbc discards them.');
    expect(text(byTestId('edt-submit'))).toBe('Discard');
    // The focus starts on Cancel, the safe choice.
    expect(document.activeElement).toBe(byTestId('edt-cancel'));
    click(byTestId('edt-cancel'));
    expect(queryTestId('edt-discard-dialog')).toBeNull();
    expect(heading()).toBe('EngineStatus');
    expect(queryTestId('edt-unsaved')).not.toBeNull();

    await openFile('other.dbc', 'BO_ 1 Other: 8 X\n');
    await act(async () => {
      byTestId('edt-submit').click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(queryTestId('edt-discard-dialog')).toBeNull();
    expect(document.title).toBe('other.dbc — CanViewer');
    expect(queryTestId('edt-unsaved')).toBeNull();
    expect(unloadBlocked()).toBe(false);
    // The browser's own confirm() is never used: a webview shows it only if its host implements it.
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks in German', async () => {
    localStorage.setItem('canviewer.lang', 'de');
    start();
    editMessage({ 'edt-message-name': 'EngineStatus' });
    await openFile('other.dbc', 'BO_ 1 Other: 8 X\n');
    const dialog = byTestId('edt-discard-dialog');
    expect(text(dialog.querySelector('h2'))).toBe('Ungespeicherte Änderungen verwerfen?');
    expect(text(dialog.querySelector('.edt-hint'))).toBe(
      'Die Änderungen an demo.dbc sind nicht gespeichert. Beim Öffnen von other.dbc gehen sie verloren.',
    );
    expect(text(byTestId('edt-submit'))).toBe('Verwerfen');
    expect(text(byTestId('edt-cancel'))).toBe('Abbrechen');
  });

  it('does not ask when there is nothing unsaved', async () => {
    start();
    await openFile('other.dbc', 'BO_ 1 Other: 8 X\n');
    expect(queryTestId('edt-discard-dialog')).toBeNull();
    expect(document.title).toBe('other.dbc — CanViewer');
  });
});
