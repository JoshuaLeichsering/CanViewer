// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// The Compare page (W9) as the app holds it: the open file, a comparison
// with another version read from the page's file input, and what is shown
// when reading that version fails. e2e/diff-check.mjs drives the same page
// in a browser, drop target and clipboard included.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { importWithCanmatrix } from '../lib/canmatrix/client';
import { DATABASE_INPUT_ACCEPT } from '../lib/canmatrix/formats';
import { ImportFailure } from '../lib/canmatrix/import-failure';
import { parseDbc } from '../lib/dbc/parser';
import type { DbcDatabase } from '../lib/dbc/types';
import { renderWithProviders } from '../test/render';
import { demoDb } from '../test/fixtures';
import { DiffView, type Comparison } from './DiffView';

vi.mock('../lib/canmatrix/client', () => ({ importWithCanmatrix: vi.fn() }));
const importMock = vi.mocked(importWithCanmatrix);
beforeEach(() => {
  importMock.mockReset();
});

// A path built from strings: under jsdom, URL is jsdom's (see test/fixtures.ts).
const DEMO_V2 = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo-v2.dbc')));

function Harness({ db = demoDb(), cluster }: { db?: DbcDatabase; cluster?: string }) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  return (
    <DiffView
      db={db}
      fileName="demo.dbc"
      cluster={cluster}
      comparison={comparison}
      onComparison={setComparison}
      onSelect={() => {}}
    />
  );
}

/** Node's File: jsdom's has no arrayBuffer(). */
const fileOf = (name: string, content: string | Uint8Array<ArrayBuffer>) => new NodeFile([content], name) as unknown as File;
const input = () => screen.getByTestId('dif-file-input') as HTMLInputElement;
const choose = (file: File) => fireEvent.change(input(), { target: { files: [file] } });

describe('DiffView', () => {
  it('starts empty, and accepts every format the app opens', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Compare versions');
    expect(screen.getByText('Compare demo.dbc with another version')).toBeTruthy();
    // Databases only: a log is never a version of a database.
    expect(input().accept).toBe(DATABASE_INPUT_ACCEPT);
    expect(input().accept).not.toMatch(/\.asc|\.log/);
  });

  it('compares the open file with the version chosen on the page, and swaps and closes the comparison', async () => {
    renderWithProviders(<Harness />);
    choose(fileOf('demo-v2.dbc', DEMO_V2));
    const versions = await screen.findByTestId('dif-versions');
    expect(versions.textContent).toContain('demo.dbc');
    expect(versions.textContent).toContain('demo-v2.dbc');
    expect(screen.getAllByTestId('dif-message').length).toBeGreaterThan(0);
    expect(importMock).not.toHaveBeenCalled();

    const before = () => versions.querySelector('.dif-version-name')?.textContent ?? '';
    expect(before()).toContain('demo.dbc');
    fireEvent.click(screen.getByRole('button', { name: 'Swap versions' }));
    expect(before()).toContain('demo-v2.dbc');

    fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
    expect(screen.queryByTestId('dif-versions')).toBeNull();
  });

  it('compares the cluster the open file shows when the other version has it', async () => {
    const cluster = (name: string, message: string) => ({
      name,
      db: parseDbc(`BU_: ECU\nBO_ 1 ${message}: 8 ECU\n`),
    });
    importMock.mockResolvedValue({
      clusters: [cluster('Motor', 'MotorStatus'), cluster('Comfort', 'SeatHeating')],
    });
    renderWithProviders(<Harness db={parseDbc('BU_: ECU\nBO_ 1 SeatHeating: 8 ECU\n')} cluster="Comfort" />);
    choose(fileOf('older.kcd', '<NetworkDefinition/>'));
    await screen.findByTestId('dif-versions');
    expect(importMock.mock.calls[0][0]).toBe('older.kcd');
    // Both versions hold SeatHeating: nothing differs.
    expect(screen.getByText(/^No differences/)).toBeTruthy();
  });

  it('tells a failure CanViewer names in the user’s language, and canmatrix’s own as it wrote it', async () => {
    importMock.mockRejectedValueOnce(new ImportFailure('no-database', 'technical detail'));
    importMock.mockRejectedValueOnce(new Error('XMLSyntaxError: not XML'));
    const { unmount } = renderWithProviders(<Harness />);
    choose(fileOf('empty.kcd', 'x'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not read empty.kcd: canmatrix found no CAN database in this file',
    );
    choose(fileOf('broken.kcd', 'x'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not read broken.kcd: XMLSyntaxError: not XML'));
    unmount();

    localStorage.setItem('canviewer.lang', 'de');
    importMock.mockRejectedValueOnce(new ImportFailure('no-database', 'technical detail'));
    renderWithProviders(<Harness />);
    choose(fileOf('empty.kcd', 'x'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'empty.kcd konnte nicht gelesen werden: canmatrix hat in dieser Datei keine CAN-Datenbank gefunden',
    );
  });
});
