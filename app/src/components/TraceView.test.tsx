// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// The Traces view (W10) as the app holds it: a log opened from the page, the
// facts, the filters and the search, the table by mouse and keyboard, a
// frame's detail with the way to its message, and leaving and coming back.
// e2e/trc-traces-encoder.mjs drives the same view in a browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { Selection } from '../App';
import { openTraceFile, type LoadedTrace } from '../lib/trace';
import { renderWithProviders } from '../test/render';
import { demoDb } from '../test/fixtures';
import { TraceView } from './TraceView';

// A path built from strings: under jsdom, URL is jsdom's (see test/fixtures.ts).
const example = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../examples', name), 'utf8');
const CANDUMP = example('demo-candump.log');
const ASC = example('demo.asc');
/** Node's File: jsdom's has no arrayBuffer(). */
const fileOf = (name: string, content: string | Uint8Array<ArrayBuffer>) => new NodeFile([content], name) as unknown as File;

// jsdom has no layout: give the table a viewport tall enough for every row of the sample logs.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2000);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function Harness({ initial = null, onSelect = () => {} }: { initial?: LoadedTrace | null; onSelect?: (s: Selection) => void }) {
  const [trace, setTrace] = useState<LoadedTrace | null>(initial);
  return <TraceView db={demoDb()} fileName="demo.dbc" trace={trace} onTrace={setTrace} onSelect={onSelect} />;
}

const input = () => screen.getByTestId('trc-file-input') as HTMLInputElement;
async function choose(file: File) {
  await act(async () => {
    fireEvent.change(input(), { target: { files: [file] } });
  });
}
const rows = () => screen.queryAllByTestId('trc-row');
const count = () => screen.getByTestId('trc-count').textContent;
const fact = (label: string) =>
  [...screen.getByTestId('trc-facts').querySelectorAll('.fact')].find((f) => f.querySelector('.k')?.textContent === label)
    ?.querySelector('.v')?.textContent;
const loaded = async (name: string, text: string) => (await openTraceFile(fileOf(name, text)))!;

describe('TraceView: opening a log', () => {
  it('starts empty, says the log stays in the tab, and opens a candump log from the page', async () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trace');
    expect(screen.getByText('Replay a log through this database')).toBeTruthy();
    expect(screen.getByText('The log is read and decoded in this browser tab; it is never uploaded.')).toBeTruthy();
    expect(input().accept).toBe('.log,.asc,.txt');

    await choose(fileOf('demo-candump.log', CANDUMP));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('demo-candump.log');
    expect(screen.getByText('candump log')).toBeTruthy();
    expect(screen.getByText(/^Started 2026-/)).toBeTruthy();
    expect(fact('Frames')).toBe('17');
    expect(count()).toBe('17 of 17 frames');
    expect(rows()).toHaveLength(17);
    expect(within(rows()[0]).getByText('EngineData')).toBeTruthy();
  });

  it('reads a Vector ASC log, with what it read but does not show', async () => {
    renderWithProviders(<Harness initial={await loaded('demo.asc', ASC)} />);
    expect(screen.getByText('Vector ASC log')).toBeTruthy();
    expect(screen.getByTestId('trc-skipped').textContent).toMatch(/^Read but not shown:/);
    // The ASC log has an error frame, which the Error frames chip lists alone.
    fireEvent.click(screen.getByRole('radio', { name: 'Error frames' }));
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getAllByText('error frame').length).toBeGreaterThan(0);
  });

  it('says so when a file is not a log, and when it cannot be read', async () => {
    renderWithProviders(<Harness />);
    await choose(fileOf('notes.log', 'just some text\n'));
    expect(screen.getByRole('alert').textContent).toBe('notes.log is neither a candump nor a Vector ASC log.');
    const broken = fileOf('broken.log', 'x');
    broken.arrayBuffer = () => Promise.reject(new Error('the file went away'));
    await choose(broken);
    expect(screen.getByRole('alert').textContent).toBe('Could not read broken.log: the file went away');
  });

  it('closes the log, and opens another one from the page', async () => {
    renderWithProviders(<Harness initial={await loaded('demo-candump.log', CANDUMP)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close log' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trace');
    expect(rows()).toHaveLength(0);
    await choose(fileOf('demo.asc', ASC));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('demo.asc');
    expect(screen.getByRole('button', { name: 'Open another log…' })).toBeTruthy();
  });
});

describe('TraceView: the frames', () => {
  it('filters by kind and by search, and says when nothing matches', async () => {
    renderWithProviders(<Harness initial={await loaded('demo-candump.log', CANDUMP)} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Unknown ID' }));
    const unknown = rows().length;
    expect(unknown).toBeGreaterThan(0);
    expect(rows().every((r) => r.textContent?.includes('not in the database'))).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Decoded' }));
    expect(rows().length + unknown).toBeLessThanOrEqual(17);
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by message, signal or ID' }), {
      target: { value: 'BrakeData' },
    });
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => r.textContent?.includes('BrakeData'))).toBe(true);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no such frame' } });
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('No frames match.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(rows()).toHaveLength(17);
  });

  it('shows a frame’s signals, and links to its message and to a signal', async () => {
    const onSelect = vi.fn();
    renderWithProviders(<Harness initial={await loaded('demo-candump.log', CANDUMP)} onSelect={onSelect} />);
    expect(screen.getByTestId('trc-detail').textContent).toBe('Select a frame to see all of its signals.');
    fireEvent.click(rows()[0]);
    const detail = screen.getByTestId('trc-detail');
    expect(detail.querySelector('h2')?.textContent).toBe('EngineData');
    expect(rows()[0].getAttribute('aria-selected')).toBe('true');
    const signals = within(detail).getByTestId('trc-detail-signals');
    const first = signals.querySelector('.decoded-row .name')!;
    fireEvent.click(first);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'message', rawId: 256, occ: 0, signal: first.textContent });
    fireEvent.click(within(detail).getByRole('button', { name: 'Open message' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'message', rawId: 256, occ: 0, signal: undefined });
  });

  it('explains frames the database does not decode as they are', async () => {
    renderWithProviders(<Harness initial={await loaded('demo-candump.log', CANDUMP)} />);
    const row = (text: string) => rows().find((r) => r.textContent?.includes(text))!;
    fireEvent.click(row('remote frame'));
    expect(screen.getByText('A remote frame requests data and carries none.')).toBeTruthy();
    fireEvent.click(row('DEADBEEF'.replace(/(..)(?=.)/g, '$1 ')));
    expect(screen.getByText('The database has no message with this id.')).toBeTruthy();
    // The last frame of the log is EngineData with 2 of its 8 bytes.
    fireEvent.click(rows()[16]);
    expect(screen.getByText('The frame has 2 bytes, the database 8; signals beyond the frame are not decoded.')).toBeTruthy();
  });

  it('moves the selection with the keyboard', async () => {
    renderWithProviders(<Harness initial={await loaded('demo-candump.log', CANDUMP)} />);
    const table = screen.getByTestId('trc-viewport');
    const selectedIndex = () => rows().findIndex((r) => r.getAttribute('aria-selected') === 'true');
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    expect(selectedIndex()).toBe(0);
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    expect(selectedIndex()).toBe(1);
    fireEvent.keyDown(table, { key: 'End' });
    expect(selectedIndex()).toBe(16);
    fireEvent.keyDown(table, { key: 'PageUp' });
    expect(selectedIndex()).toBeLessThan(16);
    fireEvent.keyDown(table, { key: 'Home' });
    expect(selectedIndex()).toBe(0);
    fireEvent.keyDown(table, { key: 'PageDown' });
    expect(selectedIndex()).toBeGreaterThan(0);
    fireEvent.keyDown(table, { key: 'ArrowUp' });
    fireEvent.keyDown(table, { key: 'x' });
    expect(selectedIndex()).toBeGreaterThanOrEqual(0);
  });

  it('keeps the search, the filter and the selected frame when the view is left and opened again', async () => {
    const trace = await loaded('demo-candump.log', CANDUMP);
    const { unmount } = renderWithProviders(<Harness initial={trace} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'EngineData' } });
    fireEvent.click(rows()[1]);
    unmount();
    renderWithProviders(<Harness initial={trace} />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('EngineData');
    expect(rows()[1].getAttribute('aria-selected')).toBe('true');
  });
});
