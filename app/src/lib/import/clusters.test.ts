// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { initialCluster } from './clusters';

const cluster = (name: string, messages: number) => ({ name, db: { messages: new Array(messages).fill(null) } });

// the_homer.kcd from the cantools corpus, as pinned in import-corpus-baseline.json.
const homer = [cluster('Motor', 7), cluster('Instrumentation', 6), cluster('Comfort', 20)];

describe('initialCluster', () => {
  it('shows the first cluster that holds messages', () => {
    expect(initialCluster(homer)).toBe(0);
    expect(initialCluster([cluster('Empty', 0), cluster('Body', 3)])).toBe(1);
  });

  it('falls back to the first cluster when none holds messages', () => {
    expect(initialCluster([cluster('A', 0), cluster('B', 0)])).toBe(0);
  });

  it('prefers the cluster the user picked before, by name', () => {
    expect(initialCluster(homer, 'Comfort')).toBe(2);
    expect(initialCluster(homer, 'Instrumentation')).toBe(1);
  });

  it('keeps a picked cluster even when it is empty', () => {
    expect(initialCluster([cluster('Body', 3), cluster('Spare', 0)], 'Spare')).toBe(1);
  });

  it('ignores a picked name the file no longer holds', () => {
    expect(initialCluster(homer, 'Chassis')).toBe(0);
  });

  it('finds an unnamed cluster by its empty name', () => {
    expect(initialCluster([cluster('Bus', 1), cluster('', 2)], '')).toBe(1);
  });
});
