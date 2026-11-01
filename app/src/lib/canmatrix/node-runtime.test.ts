// The guard that keeps the corpus suites offline: while canmatrix runs under
// Pyodide in Node, any fetch fails and is recorded, and close() restores it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { missingWheels, startCanmatrix, type NodeCanmatrix } from './node-runtime';

let canmatrix: NodeCanmatrix;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  expect(missingWheels(), 'run `npm run fetch-wheels` first').toEqual([]);
  canmatrix = await startCanmatrix();
}, 120_000);
afterAll(() => canmatrix?.close());

describe('canmatrix in Node', () => {
  it('starts without touching the network', () => {
    expect(canmatrix.fetchCalls).toEqual([]);
  });

  it('blocks and records every fetch while it runs, whatever form the address takes', async () => {
    await expect(fetch('https://cdn.example/pyodide.asm.wasm')).rejects.toThrow(
      'network access is disabled in tests: https://cdn.example/pyodide.asm.wasm',
    );
    await expect(fetch(new URL('https://pypi.example/simple/'))).rejects.toThrow('network access is disabled');
    await expect(fetch(new Request('https://example.org/x'))).rejects.toThrow('network access is disabled');
    expect(canmatrix.fetchCalls.splice(0)).toEqual([
      'https://cdn.example/pyodide.asm.wasm',
      'https://pypi.example/simple/',
      'https://example.org/x',
    ]);
  });

  it('reads a file, and puts the real fetch back on close', () => {
    const result = canmatrix.read(new TextEncoder().encode('{"messages": []}'), 'json');
    expect(result.error ?? null).toBeNull();
    canmatrix.close();
    expect(globalThis.fetch).toBe(realFetch);
  });
});
