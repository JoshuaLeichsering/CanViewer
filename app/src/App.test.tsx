// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { File as NodeFile } from 'node:buffer';
import { renderWithProviders } from './test/render';
import { DEMO_DBC_TEXT, dbcOf } from './test/fixtures';
import { importWithCanmatrix, type ImportStage } from './lib/canmatrix/client';
import { App } from './App';

// The canmatrix import runs Pyodide in a Web Worker, which jsdom has not; the
// worker and its client have their own tests.
vi.mock('./lib/canmatrix/client', () => ({ importWithCanmatrix: vi.fn() }));
const importMock = vi.mocked(importWithCanmatrix);

/** jsdom's File has no arrayBuffer(); Node's has, and that is all App reads. */
const fileOf = (name: string, content: string | Uint8Array<ArrayBuffer>) =>
  new NodeFile([content], name) as unknown as File;
const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement;
const openFile = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const openDemo = async () => {
  openFile(fileOf('demo.dbc', DEMO_DBC_TEXT));
  await screen.findByRole('heading', { level: 1, name: 'demo.dbc' });
};
const rail = (label: string) =>
  [...document.querySelectorAll('.rail-item')].find((b) => b.querySelector('.label')?.textContent === label) as HTMLButtonElement;
const h1 = () => screen.getByRole('heading', { level: 1 }).textContent;
const hash = () => window.location.hash;
const storeFile = (name: string, text: string) => localStorage.setItem('canviewer.file', JSON.stringify({ name, text }));

beforeEach(() => {
  history.replaceState(null, '', '/');
  importMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App: welcome', () => {
  it('welcomes with an open button, the drop hint and the formats, and nothing to navigate', () => {
    renderWithProviders(<App />);
    expect(document.querySelector('.brand')?.textContent).toBe('CanViewer');
    expect(screen.getByText('A viewer for CAN database files.')).toBeTruthy();
    expect(screen.getByText('…or drop a file anywhere in this window')).toBeTruthy();
    expect(screen.getByText(/DBC files open instantly/)).toBeTruthy();
    expect(screen.getByText('examples/demo.dbc')).toBeTruthy();
    expect(document.title).toBe('CanViewer — CAN Database Viewer');
    for (const label of ['Overview', 'Messages', 'Network', 'Nodes', 'Tables']) expect(rail(label).disabled).toBe(true);
    expect(document.querySelector('.list-pane')).toBeNull();
    expect(document.querySelector('.snackbar')).toBeNull();
  });

  it('opens the file dialog from the welcome card and from the rail', () => {
    renderWithProviders(<App />);
    const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Open file…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    expect(click).toHaveBeenCalledTimes(2);
  });
});

describe('App: opening a DBC file', () => {
  it('shows the overview, names the file in the title and remembers it', async () => {
    renderWithProviders(<App />);
    await openDemo();
    expect(document.title).toBe('demo.dbc — CanViewer');
    expect(JSON.parse(localStorage.getItem('canviewer.file')!)).toEqual({ name: 'demo.dbc', text: DEMO_DBC_TEXT });
    expect(rail('Overview').getAttribute('aria-current')).toBe('page');
    expect(rail('Messages').disabled).toBe(false);
    // A clean file: no problem badge.
    expect(rail('Overview').querySelector('.rail-badge')).toBeNull();
    // The input is reset so that the same file can be opened again.
    expect(fileInput().value).toBe('');
  });

  it('reads a Latin-1 file when it is not valid UTF-8', async () => {
    renderWithProviders(<App />);
    // "Gänge" in windows-1252: 0xE4 alone is not UTF-8.
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const bytes = new Uint8Array([...ascii('VERSION ""\nCM_ "G'), 0xe4, ...ascii('nge";\n')]);
    openFile(fileOf('latin1.dbc', bytes));
    await screen.findByRole('heading', { level: 1, name: 'latin1.dbc' });
    expect(screen.getByText('Gänge')).toBeTruthy();
  });

  it('badges the overview with the number of parse problems', async () => {
    renderWithProviders(<App />);
    openFile(fileOf('broken.dbc', 'VERSION ""\nBU_: A\nBO_ nonsense\nBO_ more nonsense\n'));
    await screen.findByRole('heading', { level: 1, name: 'broken.dbc' });
    expect(rail('Overview').querySelector('.rail-badge')?.textContent).toBe('2');
  });

  it('disables the destinations a file has nothing for', async () => {
    renderWithProviders(<App />);
    openFile(fileOf('bare.dbc', 'VERSION ""\n'));
    await screen.findByRole('heading', { level: 1, name: 'bare.dbc' });
    expect(rail('Overview').disabled).toBe(false);
    expect(rail('Network').disabled).toBe(false);
    expect(rail('Messages').disabled).toBe(true);
    expect(rail('Nodes').disabled).toBe(true);
    expect(rail('Tables').disabled).toBe(true);
  });

  it('still opens a file that is too large to remember', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    renderWithProviders(<App />);
    await openDemo();
    expect(localStorage.getItem('canviewer.file')).toBeNull();
  });

  it('opens a dropped file and shows the drop overlay only for file drags', async () => {
    renderWithProviders(<App />);
    const app = document.querySelector('.app')!;
    fireEvent.dragEnter(app, { dataTransfer: { types: ['text/plain'] } });
    expect(document.querySelector('.drop-overlay')).toBeNull();
    fireEvent.dragEnter(app, { dataTransfer: { types: ['Files'] } });
    fireEvent.dragEnter(app, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop the file to open it')).toBeTruthy();
    // Leaving a child element keeps the overlay; leaving the window removes it.
    fireEvent.dragLeave(app, { dataTransfer: { types: ['text/plain'] } });
    fireEvent.dragLeave(app, { dataTransfer: { types: ['Files'] } });
    expect(document.querySelector('.drop-overlay')).toBeTruthy();
    fireEvent.dragLeave(app, { dataTransfer: { types: ['Files'] } });
    expect(document.querySelector('.drop-overlay')).toBeNull();

    fireEvent.dragOver(app);
    fireEvent.dragEnter(app, { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(app, { dataTransfer: { types: ['Files'], files: [fileOf('demo.dbc', DEMO_DBC_TEXT)] } });
    expect(document.querySelector('.drop-overlay')).toBeNull();
    await screen.findByRole('heading', { level: 1, name: 'demo.dbc' });
  });

  it('ignores a drop without a file', () => {
    renderWithProviders(<App />);
    fireEvent.drop(document.querySelector('.app')!, { dataTransfer: { types: ['Files'], files: [] } });
    expect(screen.getByText('A viewer for CAN database files.')).toBeTruthy();
  });
});

describe('App: navigation and deep links', () => {
  it('walks every destination, keeps the URL hash in step and returns to the last item', async () => {
    renderWithProviders(<App />);
    await openDemo();
    expect(hash()).toBe('');

    fireEvent.click(rail('Messages'));
    expect(h1()).toBe('EngineData');
    expect(document.querySelector('.app')!.className).toContain('with-list');
    expect(hash()).toBe('#msg=256');
    const list = document.querySelector('.list-pane') as HTMLElement;
    fireEvent.click(within(list).getByText('BrakeData'));
    expect(h1()).toBe('BrakeData');
    expect(hash()).toBe('#msg=768');
    fireEvent.click(document.querySelector('.bitlayout .cell.used')!);
    expect(hash()).toBe('#msg=768/WheelSpeedFL');

    fireEvent.click(rail('Nodes'));
    expect(h1()).toBe('ECM');
    expect(hash()).toBe('#node=ECM');
    fireEvent.click(within(document.querySelector('.list-pane') as HTMLElement).getByText('Tester'));
    expect(hash()).toBe('#node=Tester');

    fireEvent.click(rail('Tables'));
    expect(h1()).toBe('GearPositions');
    expect(hash()).toBe('#vt=GearPositions');

    fireEvent.click(rail('Network'));
    expect(h1()).toBe('ECU network');
    expect(hash()).toBe('#graph');
    expect(document.querySelector('.list-pane')).toBeNull();

    fireEvent.click(rail('Overview'));
    expect(h1()).toBe('demo.dbc');
    expect(hash()).toBe('');

    // Each destination comes back to what it showed last.
    fireEvent.click(rail('Messages'));
    expect(h1()).toBe('BrakeData');
    expect(hash()).toBe('#msg=768/WheelSpeedFL');
    fireEvent.click(rail('Nodes'));
    expect(h1()).toBe('Tester');
  });

  it('opens a message from the overview and a signal from a node', async () => {
    renderWithProviders(<App />);
    await openDemo();
    fireEvent.click(screen.getByText('PowerData').closest('tr')!);
    expect(h1()).toBe('PowerData');
    expect(hash()).toBe('#msg=1280');
    fireEvent.click(rail('Nodes'));
    fireEvent.click(screen.getByText('TorqueConverterLock').closest('tr')!);
    expect(h1()).toBe('GearboxData');
    expect(hash()).toBe('#msg=512/TorqueConverterLock');
  });

  it('uses the occurrence in the hash for a duplicate id', async () => {
    renderWithProviders(<App />);
    openFile(
      fileOf(
        'dup.dbc',
        'VERSION ""\nBU_: A\nBO_ 5 First: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\nBO_ 5 Second: 8 A\n SG_ T : 0|8@1+ (1,0) [0|255] "" A\n',
      ),
    );
    await screen.findByRole('heading', { level: 1, name: 'dup.dbc' });
    fireEvent.click(screen.getByText('Second').closest('tr')!);
    expect(hash()).toBe('#msg=5.1');
    expect(h1()).toBe('Second');
  });

  it.each([
    ['#msg=1024/MuxSelector', 'DiagData'],
    ['#msg=2364539904', 'J1939_EEC1'],
    ['#node=TCM', 'TCM'],
    ['#vt=OnOff', 'OnOff'],
    ['#graph', 'ECU network'],
    ['#msg=999', 'demo.dbc'],
    ['#msg=256.3', 'demo.dbc'],
    ['#node=Nobody', 'demo.dbc'],
    ['#vt=Nothing', 'demo.dbc'],
    ['#unknown', 'demo.dbc'],
  ])('restores the stored file on start and opens the deep link %s', (link, heading) => {
    storeFile('demo.dbc', DEMO_DBC_TEXT);
    history.replaceState(null, '', `/${link}`);
    renderWithProviders(<App />);
    expect(h1()).toBe(heading);
  });

  it('decodes a selected signal from a deep link', () => {
    storeFile('demo.dbc', DEMO_DBC_TEXT);
    history.replaceState(null, '', '/#msg=1024/SensorVoltage');
    renderWithProviders(<App />);
    expect(document.querySelector('.signal-card h2')?.textContent).toBe('SensorVoltage');
  });

  it('starts empty when the stored file is unreadable', () => {
    localStorage.setItem('canviewer.file', '{not json');
    history.replaceState(null, '', '/#node=TCM');
    renderWithProviders(<App />);
    expect(screen.getByText('A viewer for CAN database files.')).toBeTruthy();
    // The hash is left alone while nothing is open.
    expect(hash()).toBe('#node=TCM');
  });

  it('starts on the overview of a stored file without a hash', () => {
    storeFile('demo.dbc', DEMO_DBC_TEXT);
    renderWithProviders(<App />);
    expect(h1()).toBe('demo.dbc');
  });

  it('resets the view when another file is opened', async () => {
    storeFile('demo.dbc', DEMO_DBC_TEXT);
    history.replaceState(null, '', '/#node=TCM');
    renderWithProviders(<App />);
    expect(h1()).toBe('TCM');
    openFile(fileOf('other.dbc', 'VERSION ""\nBU_: X\n'));
    await screen.findByRole('heading', { level: 1, name: 'other.dbc' });
    expect(hash()).toBe('');
    // The rail no longer returns to a node of the old file.
    fireEvent.click(rail('Nodes'));
    expect(h1()).toBe('X');
  });
});

describe('App: copying a link', () => {
  it('copies the address and confirms it briefly', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    storeFile('demo.dbc', DEMO_DBC_TEXT);
    history.replaceState(null, '', '/#msg=256');
    renderWithProviders(<App />);
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    });
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/#msg=256');
    // The snackbar's status; the signal table has a live region of its own.
    const snackbar = () => screen.queryAllByRole('status').find((s) => s.classList.contains('snackbar')) ?? null;
    expect(snackbar()?.textContent).toBe('Link copied');
    act(() => vi.advanceTimersByTime(2999));
    expect(snackbar()).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(snackbar()).toBeNull();
  });

  it('says so when the clipboard is not available, until dismissed', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    storeFile('demo.dbc', DEMO_DBC_TEXT);
    history.replaceState(null, '', '/#msg=256');
    renderWithProviders(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not copy the link');
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('App: importing other formats through canmatrix', () => {
  it('shows each loading stage, then the imported database, and forgets the stored DBC', async () => {
    let finish!: () => void;
    let stage!: (s: ImportStage) => void;
    importMock.mockImplementation((_name, _bytes, onStage) => {
      stage = onStage!;
      return new Promise((resolve) => {
        finish = () =>
          resolve({
            clusters: [
              { name: 'CAN1', db: dbcOf('BU_: Gateway\nBO_ 1 Imported: 8 Gateway\n SG_ S : 0|8@1+ (1,0) [0|255] "" Gateway') },
            ],
            timings: { runtimeMs: 1, packagesMs: 1, readMs: 1 },
          });
      });
    });
    storeFile('demo.dbc', DEMO_DBC_TEXT);
    renderWithProviders(<App />);
    openFile(fileOf('system.arxml', '<AUTOSAR/>'));
    // The import progress's status; the overview's export menu has a live region of its own.
    const progress = () => within(screen.getByTestId('imp-progress')).getByRole('status').textContent;
    await screen.findByTestId('imp-progress');
    expect(progress()).toBe('Loading the Python runtime to read system.arxml…');
    // Progress cannot be dismissed.
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    act(() => stage('packages'));
    expect(progress()).toBe('Loading format support for system.arxml…');
    act(() => stage('reading'));
    expect(progress()).toBe('Reading system.arxml with canmatrix…');
    await act(async () => finish());

    expect(h1()).toBe('system.arxml');
    // The progress is gone, and no snackbar took its place.
    expect(screen.queryByTestId('imp-progress')).toBeNull();
    expect(document.querySelector('.snackbar')).toBeNull();
    expect(document.title).toBe('system.arxml — CanViewer');
    expect(localStorage.getItem('canviewer.file')).toBeNull();
    expect(importMock.mock.calls[0][0]).toBe('system.arxml');
  });

  it('reports a failed import and keeps the file that was open', async () => {
    importMock.mockRejectedValue(new Error('canmatrix found no CAN database in this file'));
    renderWithProviders(<App />);
    await openDemo();
    openFile(fileOf('empty.kcd', '<NetworkDefinition/>'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not read empty.kcd: canmatrix found no CAN database in this file');
    expect(h1()).toBe('demo.dbc');
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a failure that is not an Error', async () => {
    importMock.mockRejectedValue('worker gone');
    renderWithProviders(<App />);
    openFile(fileOf('x.sym', 'FormatVersion=6.0'));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not read x.sym: worker gone');
  });

  it('forgets an earlier error when the next file opens', async () => {
    importMock.mockRejectedValue(new Error('boom'));
    renderWithProviders(<App />);
    openFile(fileOf('x.sym', 'junk'));
    await screen.findByRole('alert');
    await openDemo();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('survives storage that cannot be written while importing', async () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    importMock.mockResolvedValue({
      clusters: [{ name: 'CAN', db: dbcOf('BU_: A') }],
      timings: { runtimeMs: 0, packagesMs: 0, readMs: 0 },
    });
    renderWithProviders(<App />);
    openFile(fileOf('a.json', '{}'));
    await waitFor(() => expect(h1()).toBe('a.json'));
  });
});
