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
    expect(onSaved).toHaveBeenCalledWith('demo.dbc', await downloads[0].text);
    const saved = parseDbc(await downloads[0].text);
    expect(saved.messages).toEqual(db.messages);
    expect(saved.problems).toEqual([]);
  });

  it('saves a duplicate message id at once: its message is kept and written', async () => {
    const db = parseDbc('BO_ 1 First: 8 A\nBO_ 1 Second: 8 A\n');
    expect(db.problems).toHaveLength(1);
    setup(db);
    click(byTestId('edt-save-dbc'));
    expect(queryTestId('edt-issues-dialog')).toBeNull();
    expect(parseDbc(await downloads[0].text).messages).toEqual(db.messages);
  });

  it('lists what the file holds that CanViewer does not model or could not read, and saves only when asked', async () => {
    const db = parseDbc(UNMODELED);
    const onSaved = setup(db);
    click(byTestId('edt-save-dbc'));
    const dialog = byTestId('edt-issues-dialog');
    expect(text(dialog.querySelector('h2'))).toBe('Not everything can be written as DBC');
    expect(text(dialog.querySelector('.edt-hint'))).toBe(
      'The file holds what CanViewer does not model or could not read, and the saved file will not have it:',
    );
    expect([...byTestId('edt-loss-list').querySelectorAll('li')].map(text)).toEqual([
      '5 statements CanViewer does not model: EV_ (1×) · BA_DEF_REL_ (1×) · BA_REL_ (2×) · SIG_GROUP_ (1×)',
      '1 parse problem: a line CanViewer could not use (listed in the overview)',
    ]);
    // Nothing the writer has to report: the issue list is not there.
    expect(queryTestId('edt-issue-list')).toBeNull();
    expect(document.activeElement).toBe(byTestId('edt-cancel'));
    click(byTestId('edt-cancel'));
    expect(downloads).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();

    click(byTestId('edt-save-dbc'));
    click(byTestId('edt-submit'));
    expect(downloads.map((d) => d.name)).toEqual(['demo.dbc']);
    const saved = parseDbc(await downloads[0].text);
    expect(saved.skipped).toEqual({ NS_: 1, BS_: 1 });
    expect(saved.problems).toEqual([]);
    expect(saved.messages).toEqual(db.messages);
    expect(onSaved).toHaveBeenCalledWith('demo.dbc', await downloads[0].text);
  });

  it('lists the losses first and the writer issues after them', () => {
    const db = parseDbc(UNMODELED);
    db.messages[0].name = 'M 1';
    setup(db);
    click(byTestId('edt-save-dbc'));
    const dialog = byTestId('edt-issues-dialog');
    expect([...dialog.querySelectorAll('.edt-hint')].map(text)).toEqual([
      'The file holds what CanViewer does not model or could not read, and the saved file will not have it:',
      'The DBC format cannot hold these items as they are. A saved file would read back without them, or with them changed.',
    ]);
    expect([...byTestId('edt-issue-list').querySelectorAll('li')].map(text)).toEqual([
      'BO_ 1 M 1 name is not a DBC name (letters, digits and underscores only)',
    ]);
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
    expect(onSaved).toHaveBeenCalledWith('demo.dbc', await downloads[0].text);
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

  it('lists the losses in German, in the singular and the plural', () => {
    localStorage.setItem('canviewer.lang', 'de');
    const db = parseDbc('BO_ 1 M: 8 A\nSIG_GROUP_ 1 G 1 : S;\nCM_ BO_ 9 "x";\nCM_ BU_ Ghost "y";\n');
    setup(db);
    click(byTestId('edt-save-dbc'));
    expect(text(byTestId('edt-issues-dialog').querySelector('.edt-hint'))).toBe(
      'Die Datei enthält, was CanViewer nicht abbildet oder nicht lesen konnte, und das fehlt in der gespeicherten Datei:',
    );
    expect([...byTestId('edt-loss-list').querySelectorAll('li')].map(text)).toEqual([
      '1 Anweisung, die CanViewer nicht abbildet: SIG_GROUP_ (1×)',
      '2 Parse-Probleme: Zeilen, die CanViewer nicht verwenden konnte (in der Übersicht aufgeführt)',
    ]);
    localStorage.clear();
  });
});

/** Statements CanViewer recognizes but does not model, and a CM_ for a signal the file does not define. */
const UNMODELED = [
  'BU_: A B',
  'BO_ 1 M: 8 A',
  ' SG_ S : 0|8@1+ (1,0) [0|255] "" B',
  'EV_ Env: 0 [0|1] "" 0 1 DUMMY_NODE_VECTOR0 Vector__XXX;',
  'CM_ SG_ 1 Ghost "dangling";',
  'BA_DEF_REL_ BU_SG_REL_ "Timeout" INT 0 100;',
  'BA_REL_ "Timeout" BU_SG_REL_ A SG_ 1 S 5;',
  'BA_REL_ "Timeout" BU_SG_REL_ B SG_ 1 S 6;',
  'SIG_GROUP_ 1 Group 1 : S;',
  '',
].join('\n');
