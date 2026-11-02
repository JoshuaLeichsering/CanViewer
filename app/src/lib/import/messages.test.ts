// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { IMP_FAILURE_TEXT, impDe, impEn } from './messages';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('import UI strings', () => {
  it('exist in English and German, with the same keys', () => {
    expect(Object.keys(impDe).sort()).toEqual(Object.keys(impEn).sort());
  });

  it('carry the import UI prefix', () => {
    for (const key of Object.keys(impEn)) expect(key).toMatch(/^imp[A-Z]/);
  });

  it('are translated, not copied, except where the words are the same', () => {
    const same = Object.keys(impEn).filter((k) => impEn[k as keyof typeof impEn] === impDe[k as keyof typeof impDe]);
    expect(same).toEqual([]);
  });

  it('use the same placeholders in both languages', () => {
    for (const key of Object.keys(impEn) as Array<keyof typeof impEn>) {
      expect(placeholders(impDe[key]), key).toEqual(placeholders(impEn[key]));
    }
  });

  it('never leave a string empty', () => {
    for (const value of [...Object.values(impEn), ...Object.values(impDe)]) expect(value.trim()).not.toBe('');
  });

  it('name every failure CanViewer knows, without placeholders, since the app shows them as they are', () => {
    expect(Object.keys(IMP_FAILURE_TEXT).sort()).toEqual(['no-database', 'packages', 'runtime']);
    for (const key of Object.values(IMP_FAILURE_TEXT)) {
      expect(placeholders(impEn[key]), key).toEqual([]);
      expect(placeholders(impDe[key]), key).toEqual([]);
    }
  });
});
