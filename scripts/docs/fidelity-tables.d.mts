// Types for fidelity-tables.mjs, for the test that imports it
// (app/src/lib/reference-docs.test.ts).

export interface DocFormat {
  importType: string;
  name: string;
  extensions: string[];
}
export interface Baselines {
  importBaseline: unknown;
  mapperBaseline: unknown;
  dbcBaseline: unknown;
}
export interface GeneratedPage {
  file: string;
  current: string;
  expected: string;
}

export const FORMATS: DocFormat[];
export const TARGETS: Array<{ file: string; blocks: string[] }>;
export function classifyDifference(line: string): string;
export function renderBlocks(baselines: Baselines): Record<string, string>;
export function applyBlocks(page: string, names: string[], blocks: Record<string, string>): string;
export function loadBaselines(root: string): Baselines;
export function generate(root: string): GeneratedPage[];
