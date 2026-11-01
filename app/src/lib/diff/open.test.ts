// SPDX-License-Identifier: GPL-2.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDbc } from '../dbc/parser';
import type { ImportedCluster } from '../canmatrix/types';
import { readDatabaseFile } from './open';

const importMock = vi.hoisted(() => vi.fn());
vi.mock('../canmatrix/client', () => ({ importWithCanmatrix: importMock }));

/** A cluster whose database holds `messages` messages. */
function cluster(name: string, messages: number): ImportedCluster {
  const lines = ['BU_: ECU'];
  for (let i = 0; i < messages; i++) lines.push(`BO_ ${i + 1} ${name}_${i}: 8 ECU`);
  return { name, db: parseDbc(lines.join('\n') + '\n') };
}
const names = (db: { messages: Array<{ name: string }> }) => db.messages.map((m) => m.name);

beforeEach(() => {
  importMock.mockReset();
});

describe('readDatabaseFile: the other version in diff mode', () => {
  it('reads a DBC with CanViewer’s parser, in Windows-1252 when it is not UTF-8', async () => {
    const head = new TextEncoder().encode('BU_: ECU\nBO_ 1 M: 8 ECU\nCM_ BO_ 1 "');
    const file = new File([head, new Uint8Array([0xe4, 0x22, 0x3b, 0x0a])], 'old.dbc');
    const db = await readDatabaseFile(file);
    expect(db.messages[0].comment).toBe('ä');
    expect(importMock).not.toHaveBeenCalled();
  });

  it('imports other formats through canmatrix, with the stages, and compares the open file’s cluster', async () => {
    importMock.mockResolvedValue({ clusters: [cluster('Motor', 2), cluster('Comfort', 3)] });
    const onStage = vi.fn();
    const db = await readDatabaseFile(new File(['<kcd/>'], 'old.kcd'), onStage, 'Comfort');
    expect(names(db)).toEqual(['Comfort_0', 'Comfort_1', 'Comfort_2']);
    const [name, bytes, stage] = importMock.mock.calls[0];
    expect(name).toBe('old.kcd');
    expect(new TextDecoder().decode(bytes)).toBe('<kcd/>');
    expect(stage).toBe(onStage);
  });

  it('takes the cluster the app would show first when the file lacks the open file’s cluster', async () => {
    importMock.mockResolvedValue({ clusters: [cluster('Empty', 0), cluster('Motor', 2)] });
    expect(names(await readDatabaseFile(new File(['<kcd/>'], 'old.kcd'), undefined, 'Comfort'))).toEqual(['Motor_0', 'Motor_1']);
    expect(names(await readDatabaseFile(new File(['<kcd/>'], 'old.kcd')))).toEqual(['Motor_0', 'Motor_1']);
  });

  it('passes the import’s failure on', async () => {
    importMock.mockRejectedValue(new Error('canmatrix: not XML'));
    await expect(readDatabaseFile(new File(['x'], 'broken.arxml'))).rejects.toThrow('canmatrix: not XML');
  });
});
