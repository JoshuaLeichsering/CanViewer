// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Sorting and filtering for the signal table of a message. Kept free of React
 * so the rules can be tested on their own:
 *
 * - Sorting works on what a cell shows: text columns alphabetically (natural
 *   order, so Sig2 comes before Sig10, case ignored), number columns by value.
 *   Empty cells come last in either direction, and ties keep file order.
 * - Text filters keep the signals whose cell contains the text, ignoring case;
 *   "=text" asks for the whole cell (for receivers: one receiver) instead.
 * - Number filters take a value (8 or =8), a comparison (>8, >=8, <8, <=8, ≥, ≤)
 *   or an inclusive range (8..15). A filter that cannot be read is ignored and
 *   reported as invalid, so a half-typed filter never empties the table.
 *
 * Every row keeps its signal's position in the message: the number on the
 * signal's chip and its color in the bit layout must not change with the order.
 */
import type { DbcSignal } from './dbc/types';
import { fmtNum, muxLabel } from './format';

export type SignalColumn =
  | 'name'
  | 'mux'
  | 'startBit'
  | 'length'
  | 'byteOrder'
  | 'valueType'
  | 'factor'
  | 'offset'
  | 'min'
  | 'max'
  | 'unit'
  | 'receivers';

type NumericColumn = 'startBit' | 'length' | 'factor' | 'offset' | 'min' | 'max';

/** The columns of the signal table, in display order. */
export const SIGNAL_COLUMNS: ReadonlyArray<{ key: SignalColumn; numeric: boolean }> = [
  { key: 'name', numeric: false },
  { key: 'mux', numeric: false },
  { key: 'startBit', numeric: true },
  { key: 'length', numeric: true },
  { key: 'byteOrder', numeric: false },
  { key: 'valueType', numeric: false },
  { key: 'factor', numeric: true },
  { key: 'offset', numeric: true },
  { key: 'min', numeric: true },
  { key: 'max', numeric: true },
  { key: 'unit', numeric: false },
  { key: 'receivers', numeric: false },
];

const NUMERIC = new Set<SignalColumn>(SIGNAL_COLUMNS.filter((c) => c.numeric).map((c) => c.key));
const isNumeric = (column: SignalColumn): column is NumericColumn => NUMERIC.has(column);

export type SortDirection = 'ascending' | 'descending';

export interface SignalSort {
  column: SignalColumn;
  direction: SortDirection;
}

/** Filter text per column; empty or missing means no filter. */
export type SignalFilters = Partial<Record<SignalColumn, string>>;

export interface SignalRow {
  signal: DbcSignal;
  /** The signal's position in the message (file order). */
  index: number;
}

/** The text a cell of the signal table shows. */
export function columnText(signal: DbcSignal, column: SignalColumn): string {
  switch (column) {
    case 'name':
      return signal.name;
    case 'mux':
      return muxLabel(signal.multiplex);
    case 'byteOrder':
      return signal.byteOrder === 'intel' ? 'Intel' : 'Motorola';
    case 'valueType':
      return signal.valueType;
    case 'unit':
      return signal.unit;
    case 'receivers':
      return signal.receivers.join(', ');
    default:
      return fmtNum(signal[column]);
  }
}

/** Header clicks cycle: ascending, descending, then back to file order. */
export function nextSort(current: SignalSort | null, column: SignalColumn): SignalSort | null {
  if (current?.column !== column) return { column, direction: 'ascending' };
  return current.direction === 'ascending' ? { column, direction: 'descending' } : null;
}

const NUMBER = String.raw`[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?`;
const COMPARISON = new RegExp(String.raw`^(<=|>=|≤|≥|<|>|=)?\s*(${NUMBER})$`, 'i');
const RANGE = new RegExp(String.raw`^(${NUMBER})\s*\.\.\s*(${NUMBER})$`, 'i');

const toNumber = (text: string) => Number(text.replace(',', '.'));

/** Equal up to float noise, so that 0.1 + 0.2 matches a filter of 0.3. */
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Reads a number filter; null if the text is not one. */
export function parseNumberFilter(text: string): ((n: number) => boolean) | null {
  const t = text.trim();
  const range = RANGE.exec(t);
  if (range) {
    const a = toNumber(range[1]);
    const b = toNumber(range[2]);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return (n) => (n >= lo && n <= hi) || same(n, lo) || same(n, hi);
  }
  const cmp = COMPARISON.exec(t);
  if (!cmp) return null;
  const v = toNumber(cmp[2]);
  switch (cmp[1]) {
    case '<':
      return (n) => n < v && !same(n, v);
    case '>':
      return (n) => n > v && !same(n, v);
    case '<=':
    case '≤':
      return (n) => n <= v || same(n, v);
    case '>=':
    case '≥':
      return (n) => n >= v || same(n, v);
    default:
      return (n) => same(n, v);
  }
}

export interface CompiledFilter {
  /** False for a number filter that cannot be read; it then matches everything. */
  valid: boolean;
  matches: (signal: DbcSignal) => boolean;
}

const MATCH_ALL = () => true;

export function compileFilter(column: SignalColumn, text: string): CompiledFilter {
  const t = text.trim();
  if (t === '') return { valid: true, matches: MATCH_ALL };
  if (isNumeric(column)) {
    const test = parseNumberFilter(t);
    return test ? { valid: true, matches: (s) => test(s[column]) } : { valid: false, matches: MATCH_ALL };
  }
  if (t.startsWith('=')) {
    const wanted = t.slice(1).trim().toLowerCase();
    if (column === 'receivers') {
      return {
        valid: true,
        matches: (s) => (s.receivers.length > 0 ? s.receivers : ['']).some((r) => r.toLowerCase() === wanted),
      };
    }
    return { valid: true, matches: (s) => columnText(s, column).toLowerCase() === wanted };
  }
  const needle = t.toLowerCase();
  return { valid: true, matches: (s) => columnText(s, column).toLowerCase().includes(needle) };
}

export function hasActiveFilter(filters: SignalFilters): boolean {
  return Object.values(filters).some((text) => text !== undefined && text.trim() !== '');
}

const collators = new Map<string, Intl.Collator>();
function collator(locale: string): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    collators.set(locale, c);
  }
  return c;
}

/**
 * The rows of the signal table: the signals that pass every filter, in the
 * requested order (file order without a sort). `locale` picks the alphabet
 * for text columns; it does not change the order of plain ASCII names.
 */
export function signalRows(
  signals: readonly DbcSignal[],
  sort: SignalSort | null,
  filters: SignalFilters,
  locale = 'en',
): SignalRow[] {
  const tests = Object.entries(filters).map(([column, text]) => compileFilter(column as SignalColumn, text ?? ''));
  const rows = signals
    .map((signal, index) => ({ signal, index }))
    .filter(({ signal }) => tests.every((f) => f.matches(signal)));
  if (!sort) return rows;

  const { column } = sort;
  const sign = sort.direction === 'ascending' ? 1 : -1;
  if (isNumeric(column)) {
    return rows.sort((a, b) => {
      const x = a.signal[column];
      const y = b.signal[column];
      const xEmpty = Number.isNaN(x);
      const yEmpty = Number.isNaN(y);
      if (xEmpty || yEmpty) return xEmpty === yEmpty ? a.index - b.index : xEmpty ? 1 : -1;
      return sign * (x - y) || a.index - b.index;
    });
  }
  const compare = collator(locale).compare;
  const keys = new Map(rows.map((r) => [r, columnText(r.signal, column)]));
  return rows.sort((a, b) => {
    const x = keys.get(a)!;
    const y = keys.get(b)!;
    if (x === '' || y === '') return x === y ? a.index - b.index : x === '' ? 1 : -1;
    return sign * compare(x, y) || a.index - b.index;
  });
}
