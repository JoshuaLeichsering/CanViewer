import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from '../dbc/parser';
import { isCanFd, isJ1939Pg } from '../dbc/canfd';
import { isJ1939Database } from '../dbc/j1939';
import { compareDatabases } from './compare';
import { missingWheels, startCanmatrix, type NodeCanmatrix } from './node-runtime';

/**
 * The canmatrix mapper (canviewer_adapter.py) under Pyodide in Node.
 *
 * The strongest check available: read a DBC file through canmatrix and the
 * mapper, and compare the result with CanViewer's own parser on the same file.
 * For examples/demo.dbc there must be no difference at all. For the 58 corpus
 * DBC files the differences, all canmatrix behaviour the handover documents
 * (dangling comments dropped, long names applied, nodes created from
 * senders, ...), and the problems the mapper reports for lines canmatrix
 * dropped are pinned in mapper-dbc-baseline.json; regenerate with
 *   UPDATE_MAPPER_BASELINE=1 npx vitest run src/lib/canmatrix/mapper.test.ts
 *
 * Needs the wheels in vendor/pyodide (`npm run fetch-wheels`); fails without.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../..');
const decode = (buf: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
};

let cm: NodeCanmatrix;
beforeAll(async () => {
  const missing = missingWheels();
  if (missing.length) {
    throw new Error(`wheels missing from vendor/pyodide, run \`npm run fetch-wheels\`: ${missing.join(', ')}`);
  }
  cm = await startCanmatrix();
  await cm.loadPackages(['lxml']);
}, 120_000);
afterAll(() => cm?.close());

const viaCanmatrix = (text: string, importType: string) => {
  const result = cm.read(new TextEncoder().encode(text), importType);
  expect(result.error ?? null).toBeNull();
  return result.clusters[0].db;
};

describe('canmatrix mapper', () => {
  it('reads examples/demo.dbc exactly as CanViewer’s parser does', () => {
    const text = readFileSync(join(root, 'examples/demo.dbc'), 'utf8');
    expect(compareDatabases(parseDbc(text), viaCanmatrix(text, 'dbc'))).toEqual([]);
  });

  it('types attribute values by their definition, like the DBC parser', () => {
    const text = `VERSION ""
BU_: ECU
BO_ 100 Msg: 8 ECU
 SG_ Sig : 0|8@1+ (1,0) [0|255] "" ECU
BA_DEF_ BO_ "GenMsgSendType" ENUM "Cyclic","Event","IfActive";
BA_DEF_ BO_ "GenMsgCycleTime" INT 0 10000;
BA_DEF_ BU_ "NodeAddress" HEX 0 255;
BA_DEF_ "BusType" STRING ;
BA_DEF_DEF_ "GenMsgSendType" "Cyclic";
BA_DEF_DEF_ "GenMsgCycleTime" 0;
BA_DEF_DEF_ "NodeAddress" 0;
BA_DEF_DEF_ "BusType" "CAN";
BA_ "BusType" "CAN FD";
BA_ "NodeAddress" BU_ ECU 16;
BA_ "GenMsgSendType" BO_ 100 1;
BA_ "GenMsgCycleTime" BO_ 100 20;
`;
    const db = viaCanmatrix(text, 'dbc');
    expect(db.messages[0].attributes).toEqual({ GenMsgSendType: 'Event', GenMsgCycleTime: 20 });
    expect(db.nodes[0].attributes).toEqual({ NodeAddress: 16 });
    expect(db.attributes).toEqual({ BusType: 'CAN FD' });
    expect(compareDatabases(parseDbc(text), db)).toEqual([]);
  });

  it('turns what canmatrix prints about a line it drops into a problem', () => {
    // A bare "m" multiplexor (vw_pq.dbc line 394) is dropped by canmatrix's
    // DBC reader with a print(); CanViewer's parser reads it.
    const text = `VERSION ""
BU_: ECU
BO_ 100 Msg: 8 ECU
 SG_ Mux m : 0|2@1+ (1,0) [0|3] "" ECU
 SG_ Other : 8|8@1+ (1,0) [0|255] "" ECU
`;
    const db = viaCanmatrix(text, 'dbc');
    expect(db.problems).toEqual([
      { line: 4, text: 'SG_ Mux m : 0|2@1+ (1,0) [0|3] "" ECU', reason: 'canmatrix could not read this line' },
    ]);
    expect(db.messages[0].signals.map((s) => s.name)).toEqual(['Other']);
  });

  it('turns model fields of other formats into the attributes CanViewer reads', () => {
    // canmatrix's JSON reader keeps is_j1939 and cycle_time (it drops is_fd).
    const json = JSON.stringify({
      messages: [
        {
          name: 'EEC1',
          id: '0x0CF00400',
          is_extended_frame: true,
          length: 8,
          is_j1939: true,
          cycle_time: 100,
          signals: [{ name: 'Speed', start_bit: 24, bit_length: 16, factor: 0.125 }],
        },
        { name: 'Big', id: 1536, length: 32, signals: [] },
      ],
    });
    const db = viaCanmatrix(json, 'json');
    const [eec1, big] = db.messages;
    expect(eec1.attributes).toEqual({ GenMsgCycleTime: 100, VFrameFormat: 'J1939PG' });
    expect(isJ1939Pg(db, eec1)).toBe(true);
    expect(isJ1939Database(db)).toBe(true);
    // No VFrameFormat: CanViewer's own rule makes a 32-byte frame CAN FD.
    expect(big.attributes).toEqual({});
    expect(isCanFd(db, big)).toBe(true);
    expect(db.attributeDefinitions.map((d) => `${d.objectType}:${d.name}:${d.valueType}`).sort()).toEqual([
      'BO_:GenMsgCycleTime:INT',
      'BO_:VFrameFormat:ENUM',
    ]);
  });

  it('decodes SYM and DBF as UTF-8 when the bytes are valid UTF-8', () => {
    const sym = `FormatVersion=6.0 // Do not edit this line!
Title="Ümlaut"

{SENDRECEIVE}

[Grüße]
ID=123h
Len=8
Var=Wärme unsigned 0,8
`;
    const db = viaCanmatrix(sym, 'sym');
    expect(db.messages[0].name).toBe('Grüße');
    expect(db.messages[0].signals[0].name).toBe('Wärme');
  });
});

const OPENDBC_DIR = join(root, 'third_party/opendbc/opendbc/dbc');
const MODEL3_FILE = join(root, 'third_party/model3dbc/Model3CAN.dbc');
const BASELINE_FILE = join(here, 'mapper-dbc-baseline.json');
const corpus: Array<[string, string]> = existsSync(OPENDBC_DIR)
  ? readdirSync(OPENDBC_DIR)
      .filter((f) => f.endsWith('.dbc'))
      .sort()
      .map((f) => [f, join(OPENDBC_DIR, f)] as [string, string])
  : [];
if (existsSync(MODEL3_FILE)) corpus.push(['Model3CAN.dbc', MODEL3_FILE]);

const UPDATE = process.env.UPDATE_MAPPER_BASELINE === '1';
interface Pinned {
  differences: string[];
  problems: string[];
}
const baseline: Record<string, Pinned> =
  !UPDATE && existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : {};
const recorded: Record<string, Pinned> = {};

describe.skipIf(corpus.length === 0)('DBC corpus through canmatrix and the mapper', () => {
  afterAll(() => {
    if (UPDATE) writeFileSync(BASELINE_FILE, JSON.stringify(recorded, null, 2) + '\n');
  });

  it('baseline lists exactly the corpus files', () => {
    if (UPDATE) return;
    expect(Object.keys(baseline).sort()).toEqual(corpus.map(([n]) => n).sort());
  });

  it.each(corpus)('%s differs from CanViewer’s parser only as pinned', (name, path) => {
    const buf = readFileSync(path);
    const result = cm.read(buf, 'dbc');
    const db = result.clusters[0]?.db;
    const pinned: Pinned = {
      differences: db ? compareDatabases(parseDbc(decode(buf)), db) : [`nothing read (${result.error})`],
      problems: (db?.problems ?? []).map((p) => `${p.line}: ${p.reason}: ${p.text.slice(0, 80)}`),
    };
    if (UPDATE) recorded[name] = pinned;
    else expect(pinned).toEqual(baseline[name]);
  });

  it('never touched the network', () => {
    expect(cm.fetchCalls).toEqual([]);
  });
});
