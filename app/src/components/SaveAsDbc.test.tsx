// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDbc } from '../lib/dbc/parser';
import type { DbcDatabase } from '../lib/dbc/types';
import { I18nProvider } from '../lib/i18n';
import { dbcFileName, SaveAsDbcButton } from './SaveAsDbc';
import { byTestId, click, queryTestId, render, text } from './dom-test-utils';
import demo from '../../../examples/demo.dbc?raw';

/** What the button handed to the browser as downloads: file name and text. */
let downloads: Array<{ name: string; text: Promise<string> }>;
let view: ReturnType<typeof render> | undefined;

beforeEach(() => {
  downloads = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:test/${n++}`;
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
});

function setup(db: DbcDatabase, edited = false) {
  const onSaved = vi.fn();
  view = render(
    <I18nProvider>
      <SaveAsDbcButton db={db} fileName="demo.dbc" edited={edited} onSaved={onSaved} />
    </I18nProvider>,
  );
  return onSaved;
}

describe('dbcFileName', () => {
  it('gives the file the .dbc extension', () => {
    expect(dbcFileName('demo.dbc')).toBe('demo.dbc');
    expect(dbcFileName('system-4.2.arxml')).toBe('system-4.2.dbc');
    expect(dbcFileName('the_homer.kcd')).toBe('the_homer.dbc');
    expect(dbcFileName('noext')).toBe('noext.dbc');
    expect(dbcFileName('.dbc')).toBe('database.dbc');
  });
});

describe('SaveAsDbcButton', () => {
  it('saves a database the writer can hold at once, as text that reads back the same', async () => {
    const db = parseDbc(demo);
    const onSaved = setup(db);
    expect(byTestId('edt-save-dbc').getAttribute('aria-label')).toBe('Save as DBC');
    click(byTestId('edt-save-dbc'));
    expect(queryTestId('edt-issues-dialog')).toBeNull();
    expect(downloads.map((d) => d.name)).toEqual(['demo.dbc']);
    expect(onSaved).toHaveBeenCalledWith('demo.dbc');
    const saved = parseDbc(await downloads[0].text);
    expect(saved.messages).toEqual(db.messages);
    expect(saved.problems).toEqual([]);
  });

  it('marks unsaved edits', () => {
    setup(parseDbc(demo), true);
    expect(byTestId('edt-save-dbc').getAttribute('aria-label')).toBe('Save as DBC (unsaved edits)');
    expect(queryTestId('edt-unsaved')).not.toBeNull();
  });

  it('lists what DBC cannot hold before saving, and saves only when asked', async () => {
    const db = parseDbc(demo);
    db.messages[0].name = 'Engine Data';
    db.messages[0].signals[0].unit = 'r"pm';
    const onSaved = setup(db);
    click(byTestId('edt-save-dbc'));
    const dialog = byTestId('edt-issues-dialog');
    expect(text(dialog.querySelector('h2'))).toBe('Not everything can be written as DBC');
    expect([...dialog.querySelectorAll('li')].map(text)).toEqual([
      'BO_ 256 Engine Data name is not a DBC name (letters, digits and underscores only)',
      'SG_ Engine Data.EngineSpeed unit contains a double quote, which DBC cannot hold here',
    ]);
    // The focus starts on Cancel, the safe choice.
    expect(document.activeElement).toBe(byTestId('edt-cancel'));
    click(byTestId('edt-cancel'));
    expect(downloads).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();

    click(byTestId('edt-save-dbc'));
    click(byTestId('edt-submit'));
    expect(downloads.map((d) => d.name)).toEqual(['demo.dbc']);
    expect(await downloads[0].text).toContain('BO_ 256 Engine Data: 8 ECM');
    expect(onSaved).toHaveBeenCalledWith('demo.dbc');
  });

  it('speaks German', () => {
    localStorage.setItem('canviewer.lang', 'de');
    const db = parseDbc(demo);
    db.version = 'v"2';
    setup(db, true);
    expect(byTestId('edt-save-dbc').getAttribute('aria-label')).toBe('Als DBC speichern (ungespeicherte Änderungen)');
    click(byTestId('edt-save-dbc'));
    const dialog = byTestId('edt-issues-dialog');
    expect(text(dialog.querySelector('h2'))).toBe('Nicht alles lässt sich als DBC schreiben');
    expect(text(dialog.querySelector('li'))).toBe(
      'VERSION version enthält ein doppeltes Anführungszeichen, das DBC hier nicht aufnehmen kann',
    );
    expect(text(byTestId('edt-submit'))).toBe('Trotzdem speichern');
    localStorage.clear();
  });
});
