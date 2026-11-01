import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStoredFile, readStoredFile, STORED_FILE_KEY } from './stored-file';

/** A minimal localStorage, since the tests run in Node. */
function fakeStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

/** A localStorage that throws on every access, as in a browser that blocks site data. */
const blockedStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const g = globalThis as { localStorage?: unknown };

describe('stored file', () => {
  beforeEach(() => {
    g.localStorage = fakeStorage();
  });
  afterEach(() => {
    delete g.localStorage;
  });

  it('reads a stored file', () => {
    g.localStorage = fakeStorage({ [STORED_FILE_KEY]: JSON.stringify({ name: 'demo.dbc', text: 'VERSION ""' }) });
    expect(readStoredFile()).toEqual({ name: 'demo.dbc', text: 'VERSION ""' });
  });

  it('reads nothing when no file is stored', () => {
    expect(readStoredFile()).toBeNull();
  });

  it.each([
    ['not JSON', '{"name": "demo.dbc", '],
    ['null', 'null'],
    ['a string', '"demo.dbc"'],
    ['an array', '["demo.dbc", "VERSION"]'],
    ['a name that is not a string', JSON.stringify({ name: { not: 'a string' }, text: 'VERSION ""' })],
    ['a text that is not a string', JSON.stringify({ name: 'demo.dbc', text: 42 })],
    ['no text', JSON.stringify({ name: 'demo.dbc' })],
  ])('reads nothing from a stored value that is %s', (_, value) => {
    g.localStorage = fakeStorage({ [STORED_FILE_KEY]: value });
    expect(readStoredFile()).toBeNull();
  });

  it('clears the stored file and nothing else', () => {
    const storage = fakeStorage({
      [STORED_FILE_KEY]: JSON.stringify({ name: 'demo.dbc', text: '' }),
      'canviewer.lang': 'de',
      'canviewer.theme': 'dark',
    });
    g.localStorage = storage;
    clearStoredFile();
    expect(storage.keys().sort()).toEqual(['canviewer.lang', 'canviewer.theme']);
    expect(readStoredFile()).toBeNull();
  });

  it('works without storage', () => {
    g.localStorage = blockedStorage;
    expect(readStoredFile()).toBeNull();
    expect(() => clearStoredFile()).not.toThrow();
  });
});
