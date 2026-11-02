// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { decodeFrame, signalBitPositions } from '../dbc/bits';
import { parseDbc } from '../dbc/parser';
import type { DbcDatabase, DbcMessage, DbcSignal } from '../dbc/types';
import { muxCondition } from './layout';
import { decodePseudoCode, pseudoCodeVariables, rawExpression } from './pseudo-code';
import { CORPUS_TIMEOUT, corpusDb, corpusFiles, corpusPresent, demo, expectPinned, messageNamed, PINNED_CORPUS } from './test-fixtures';

/**
 * A runner for the pseudo-code's small grammar (see pseudo-code.ts): each
 * line is translated into JavaScript, raw values as BigInt so that 64-bit
 * signals stay exact, physical values as numbers like the decoder's. A line
 * outside the grammar fails the test, so the runner cannot quietly skip
 * what it does not understand.
 */
function compile(code: string): (data: Uint8Array) => Map<string, bigint | number> {
  const js: string[] = [];
  let open = false;
  const integers = (expr: string) =>
    expr
      .replace(/(?<![\w[.])(0x[0-9A-F]+|\d+)(?![\w\].])/g, '$1n')
      .replace(/data\[(\d+)\]/g, 'BigInt(data[$1])')
      .replace(/\b([A-Za-z_]\w*_raw_*)\b/g, "get('$1')");
  const condition = (text: string) =>
    integers(
      text
        .replace(/(-?\d+) <= (\w+) <= (-?\d+)/g, '($1 <= $2 && $2 <= $3)')
        .replace(/ == /g, ' === ')
        .replace(/ and /g, ' && ')
        .replace(/ or /g, ' || '),
    );
  for (const raw of code.split('\n')) {
    const indented = raw.startsWith('    ');
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) continue;
    if (open && !indented) {
      js.push('}');
      open = false;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^if (.+):$/))) {
      js.push(`if (${condition(m[1])}) {`);
      open = true;
    } else if ((m = line.match(/^if (\w+) >= (\d+): \1 = \1 - (\d+)$/))) {
      js.push(`if (get('${m[1]}') >= ${m[2]}n) set('${m[1]}', get('${m[1]}') - ${m[3]}n);`);
    } else if ((m = line.match(/^(\w+_raw_*) = ([\sdata[\]0-9xA-F|&<>()]+)$/))) {
      js.push(`set('${m[1]}', ${integers(m[2])});`);
    } else if ((m = line.match(/^(\w+) = (?:(float32|float64)\((\w+)\)|(\w+))(?: \* (\S+))?(?: ([+-]) (\S+))?$/))) {
      const rawName = m[3] ?? m[4];
      let value = m[2] ? `${m[2]}(get('${rawName}'))` : `Number(get('${rawName}'))`;
      if (m[5] !== undefined) value = `${value} * ${m[5]}`;
      if (m[6] !== undefined) value = `${value} ${m[6]} ${m[7]}`;
      js.push(`set('${m[1]}', ${value});`);
    } else {
      throw new Error(`not in the pseudo-code grammar: ${raw}`);
    }
  }
  if (open) js.push('}');
  const run = new Function('data', 'get', 'set', 'float32', 'float64', js.join('\n'));
  return (data) => {
    const vars = new Map<string, bigint | number>();
    const get = (name: string) => {
      if (!vars.has(name)) throw new Error(`${name} is read before it is set`);
      return vars.get(name);
    };
    const bits = (raw: bigint, size: 4 | 8) => {
      const view = new DataView(new ArrayBuffer(8));
      view.setBigUint64(0, raw);
      return size === 4 ? view.getFloat32(4) : view.getFloat64(0);
    };
    run(data, get, (name: string, value: bigint | number) => vars.set(name, value), (r: bigint) => bits(r, 4), (r: bigint) => bits(r, 8));
    return vars;
  };
}

/** A deterministic pseudo-random generator (mulberry32), so failures can be replayed. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Write a raw value into a signal's bits (most significant bit first, as signalBitPositions lists them). */
function setRaw(data: Uint8Array, signal: DbcSignal, value: number) {
  const positions = signalBitPositions(signal);
  const raw = BigInt.asUintN(positions.length, BigInt(value));
  positions.forEach((pos, i) => {
    const bit = (raw >> BigInt(positions.length - 1 - i)) & 1n;
    if (pos >> 3 >= data.length) return;
    data[pos >> 3] = (data[pos >> 3] & ~(1 << (pos & 7))) | (Number(bit) << (pos & 7));
  });
}

/**
 * Payloads to decode: all zeros, all ones, random ones, and for every
 * multiplexed signal random ones with its whole switch chain set to the
 * lowest and the highest value that activates it.
 */
function payloads(message: DbcMessage, seed: number): Uint8Array[] {
  const next = random(seed);
  const randomPayload = () => Uint8Array.from({ length: message.dlc }, () => Math.floor(next() * 256));
  const list = [new Uint8Array(message.dlc), new Uint8Array(message.dlc).fill(0xff)];
  for (let i = 0; i < 4; i++) list.push(randomPayload());
  for (const signal of message.signals) {
    const condition = muxCondition(message, signal);
    if (condition.kind !== 'when') continue;
    for (const pick of [0, 1] as const) {
      const data = randomPayload();
      for (const term of condition.terms) {
        const [lo, hi] = term.ranges[pick === 0 ? 0 : term.ranges.length - 1];
        setRaw(data, term.switch, pick === 0 ? lo : hi);
      }
      list.push(data);
    }
  }
  return list;
}

/** Decode every payload both ways and compare signal by signal. */
function expectDecodesLikeCanViewer(db: DbcDatabase, message: DbcMessage, label: string) {
  const code = decodePseudoCode(db, message, label);
  const run = compile(code);
  const { names, raws } = pseudoCodeVariables(message.signals);
  payloads(message, message.id ^ message.signals.length).forEach((data, p) => {
    const vars = run(data);
    const decoded = new Map(decodeFrame(message.signals, data).map((d) => [d.signal, d]));
    message.signals.forEach((signal, i) => {
      const where = `${label} ${message.name}.${signal.name}, payload ${p} [${[...data].join(' ')}]`;
      const d = decoded.get(signal);
      if (!d || !d.active) {
        expect(vars.has(names[i]), `${where}: decoded, but CanViewer does not show it`).toBe(false);
        return;
      }
      expect(vars.has(names[i]), `${where}: not decoded, but CanViewer shows it`).toBe(true);
      const raw = vars.get(raws[i]) as bigint;
      const kind = signal.valueType;
      const isFloat = (kind === 'float' && signal.length === 32) || (kind === 'double' && signal.length === 64);
      if (!isFloat) expect(Number(raw), `${where}: raw value`).toBe(d.raw);
      expect(Object.is(vars.get(names[i]), d.physical) || vars.get(names[i]) === d.physical, `${where}: physical value ${vars.get(names[i])} vs ${d.physical}`).toBe(true);
    });
  });
}

describe('rawExpression', () => {
  it('reads whole bytes without masks or shifts it does not need', () => {
    expect(rawExpression([{ byte: 2, shift: 0, width: 8, at: 0 }])).toBe('data[2]');
    expect(
      rawExpression([
        { byte: 0, shift: 0, width: 8, at: 0 },
        { byte: 1, shift: 0, width: 8, at: 8 },
      ]),
    ).toBe('data[0] | (data[1] << 8)');
  });

  it('masks and shifts partial bytes, with parentheses wherever C precedence needs them', () => {
    expect(rawExpression([{ byte: 5, shift: 5, width: 1, at: 0 }])).toBe('(data[5] >> 5) & 0x01');
    expect(
      rawExpression([
        { byte: 4, shift: 0, width: 8, at: 0 },
        { byte: 5, shift: 0, width: 4, at: 8 },
      ]),
    ).toBe('data[4] | ((data[5] & 0x0F) << 8)');
  });

  it('reads a zero-length signal as 0', () => {
    expect(rawExpression([])).toBe('0');
  });
});

describe('decode pseudo-code, pinned', () => {
  it.each(demo.messages.map((m) => [m.name, m] as const))('demo.dbc %s', (name, message) => {
    expectPinned(`demo/${name}.decode.txt`, decodePseudoCode(demo, message, 'demo.dbc'));
  });

  describe.skipIf(!corpusPresent)('corpus', () => {
    it.each(PINNED_CORPUS.map((p) => [`${p.file} ${p.message}`, p] as const))('%s', (_, p) => {
      const db = corpusDb(p.file);
      expectPinned(`${p.dir}/${p.message}.decode.txt`, decodePseudoCode(db, messageNamed(db, p.message), p.file.split('/').pop()!));
    });
  });
});

describe('decode pseudo-code decodes as CanViewer decodes', () => {
  it('for every message of demo.dbc', () => {
    for (const message of demo.messages) expectDecodesLikeCanViewer(demo, message, 'demo.dbc');
  });

  it('for multiplexing the demo does not show: extended chains, ranges, missing switches', () => {
    const db = parseDbc(
      [
        'VERSION ""',
        'BU_: A',
        'BO_ 100 Chain: 8 A',
        ' SG_ Mode M : 0|4@1+ (1,0) [0|15] "" A',
        ' SG_ Sub m1M : 4|4@1+ (1,0) [0|15] "" A',
        ' SG_ Deep m2 : 8|8@1- (0.5,-1) [0|0] "" A',
        ' SG_ Wide m3 : 16|8@1+ (1,0) [0|0] "" A',
        ' SG_ Lost m4 : 24|8@1+ (1,0) [0|0] "" A',
        ' SG_ Far : 70|8@1+ (1,0) [0|0] "" A',
        'BO_ 101 NoRoot: 2 A',
        ' SG_ Orphan m1 : 0|8@1+ (1,0) [0|0] "" A',
        'BO_ 102 Wide64: 8 A',
        ' SG_ Big : 0|64@1+ (1,0) [0|0] "" A',
        ' SG_ BigSigned : 0|64@1- (1,0) [0|0] "" A',
        ' SG_ Dbl : 0|64@1- (2,0.5) [0|0] "" A',
        ' SG_ Moto : 7|64@0- (1,0) [0|0] "" A',
        'SIG_VALTYPE_ 102 Dbl : 2;',
        'SG_MUL_VAL_ 100 Sub Mode 1-1;',
        'SG_MUL_VAL_ 100 Deep Sub 2-2;',
        'SG_MUL_VAL_ 100 Wide Mode 3-5, 9-9;',
        'SG_MUL_VAL_ 100 Lost Ghost 1-1;',
        '',
      ].join('\n'),
    );
    expect(db.problems).toEqual([]);
    for (const message of db.messages) expectDecodesLikeCanViewer(db, message, 'synthetic');
    const chain = decodePseudoCode(db, db.messages[0], 'synthetic.dbc');
    expect(chain).toContain('if Mode_raw == 1 and Sub_raw == 2:');
    expect(chain).toContain('if 3 <= Mode_raw <= 5 or Mode_raw == 9:');
    expect(chain).toContain('// Lost is never decoded: its multiplexor Ghost is not in this message.');
    expect(chain).toContain('// Far lies outside the 8-byte payload, so it is not decoded.');
  });

  describe.skipIf(corpusFiles().length === 0)('corpus', () => {
    it.each(corpusFiles())('%s: every signal decodes as CanViewer decodes it', (file) => {
      const db = corpusDb(file);
      for (const message of db.messages) expectDecodesLikeCanViewer(db, message, file);
    }, CORPUS_TIMEOUT);
  });
});
