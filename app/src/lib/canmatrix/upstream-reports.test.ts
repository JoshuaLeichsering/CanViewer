import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCanFd } from '../dbc/canfd';
import { parseDbc } from '../dbc/parser';
import { missingWheels, startCanmatrix, type NodeCanmatrix } from './node-runtime';

/**
 * The bug report drafts for canmatrix in docs/develop/upstream/, held to what
 * canmatrix does. Each draft's reproduction (the python block under
 * "## Reproduction") runs here under Pyodide with the canmatrix wheel the app
 * ships, and what it prints must be the draft's "## Actual" block, line for
 * line. A second test per draft pins what CanViewer makes of the same input.
 *
 * If one of these fails after a canmatrix update, upstream changed the
 * behaviour: update the draft (or retire it) and any workaround in
 * canviewer_adapter.py first, then the expectations here.
 */
const here = dirname(fileURLToPath(import.meta.url));
const UPSTREAM = join(here, '../../../../docs/develop/upstream');

const draft = (name: string) => readFileSync(join(UPSTREAM, name), 'utf8');

/** The body of the `## heading` section, up to the next heading of that level. */
function section(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`no "## ${heading}" section`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** The first fenced block of the given language in `text`. */
function fenced(text: string, language: string): string {
  const match = text.match(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```'));
  if (!match) throw new Error(`no \`\`\`${language} block`);
  return match[1];
}

/** The bytes literal a reproduction assigns to `name` (b'''...'''). */
function bytesLiteral(source: string, name: string): string {
  const match = source.match(new RegExp(`${name} = b'''([\\s\\S]*?)'''`));
  if (!match) throw new Error(`no ${name} = b'''...''' in the reproduction`);
  return match[1];
}

describe('canmatrix bug report drafts (docs/develop/upstream)', () => {
  let cm: NodeCanmatrix;

  beforeAll(async () => {
    const missing = missingWheels();
    if (missing.length) {
      throw new Error(`wheels missing from vendor/pyodide, run \`npm run fetch-wheels\`: ${missing.join(', ')}`);
    }
    cm = await startCanmatrix();
  }, 120_000);

  afterAll(() => cm?.close());

  /** Runs a script as `python reproduction.py` would, returning stdout and stderr. */
  function run(source: string): string {
    cm.pyodide.globals.set('_canviewer_source', source);
    try {
      return cm.pyodide.runPython(`
import contextlib, io
_canviewer_out = io.StringIO()
with contextlib.redirect_stdout(_canviewer_out), contextlib.redirect_stderr(_canviewer_out):
    exec(compile(_canviewer_source, "reproduction.py", "exec"), {"__name__": "__main__"})
_canviewer_out.getvalue()
`) as string;
    } finally {
      cm.pyodide.globals.delete('_canviewer_source');
    }
  }

  /**
   * Runs a reproduction (its output discarded), then returns what canmatrix's
   * JSON exporter writes for the `db` it built, in the default layout
   * (jsonExportAll=False).
   */
  function dumpJson(source: string): string {
    cm.pyodide.globals.set('_canviewer_source', source);
    try {
      return cm.pyodide.runPython(`
def _canviewer_dump_json(source):
    import contextlib, io
    import canmatrix.formats
    namespace = {"__name__": "__main__"}
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        exec(compile(source, "reproduction.py", "exec"), namespace)
    out = io.BytesIO()
    canmatrix.formats.dump(namespace["db"], out, "json", jsonExportAll=False)
    return out.getvalue().decode("utf-8")
_canviewer_dump_json(_canviewer_source)
`) as string;
    } finally {
      cm.pyodide.globals.delete('_canviewer_source');
      cm.pyodide.globals.delete('_canviewer_dump_json');
    }
  }

  const bytes = (text: string) => new TextEncoder().encode(text);

  describe.each([
    'canmatrix-dbc-val-line-numbers.md',
    'canmatrix-dbc-unreadable-bo-signals.md',
    'canmatrix-json-is-fd.md',
  ])('%s', (name) => {
    it('its reproduction prints the "Actual" block under canmatrix 1.3.3', () => {
      const markdown = draft(name);
      const actual = fenced(section(markdown, 'Actual'), 'text');
      expect(actual.split('\n')[0]).toBe('canmatrix 1.3.3');
      expect(run(fenced(section(markdown, 'Reproduction'), 'python')).trimEnd()).toBe(actual.trimEnd());
    });
  });

  it('CanViewer corrects the line numbers after a VAL_ line (canmatrix-dbc-val-line-numbers.md)', () => {
    const dbc = bytesLiteral(fenced(section(draft('canmatrix-dbc-val-line-numbers.md'), 'Reproduction'), 'python'), 'DBC');
    const result = cm.read(bytes(dbc), 'dbc');
    // canmatrix says 7 and 5; the adapter finds the quoted lines in the file.
    expect(result.clusters[0].db.problems.map((p) => [p.line, p.text])).toEqual([
      [7, 'SG_ Bad1 : x|8@1+ (1,0) [0|255] "" Vector__XXX'],
      [12, 'SG_ Bad2 : y|8@1+ (1,0) [0|255] "" Vector__XXX'],
    ]);
  });

  it('a mapped canmatrix reading keeps signal B on the wrong message (canmatrix-dbc-unreadable-bo-signals.md)', () => {
    const dbc = bytesLiteral(
      fenced(section(draft('canmatrix-dbc-unreadable-bo-signals.md'), 'Reproduction'), 'python'),
      'DBC',
    );
    const viaCanmatrix = cm.read(bytes(dbc), 'dbc').clusters[0].db;
    expect(viaCanmatrix.messages.map((m) => [m.name, m.signals.map((s) => s.name)])).toEqual([['First', ['A', 'B']]]);
    expect(viaCanmatrix.problems.map((p) => [p.line, p.text])).toEqual([[8, 'BO_ 2048 Second: 8 ECU']]);
    // CanViewer's own DBC parser, which the app uses for .dbc, reads both messages.
    const own = parseDbc(dbc);
    expect(own.messages.map((m) => [m.name, m.id, m.signals.map((s) => s.name)])).toEqual([
      ['First', 100, ['A']],
      ['Second', 2048, ['B']],
    ]);
  });

  it('an FD frame of 8 bytes from a JSON file shows as classic CAN (canmatrix-json-is-fd.md)', () => {
    // What canmatrix 1.3.3 writes for the draft's frame: the reproduction's own
    // database, dumped by canmatrix's JSON exporter, so the input is its real output.
    const json = dumpJson(fenced(section(draft('canmatrix-json-is-fd.md'), 'Reproduction'), 'python'));
    const written = JSON.parse(json) as { messages: Array<{ id: number; name: string; is_fd: boolean }> };
    expect(written.messages.map((m) => [m.id, m.name, m.is_fd])).toEqual([[0x123, 'FdFrame', true]]);
    const db = cm.read(bytes(json), 'json').clusters[0].db;
    const [frame] = db.messages;
    expect(frame.dlc).toBe(8);
    expect(frame.attributes).toEqual({});
    expect(isCanFd(db, frame)).toBe(false);
  });

  it('never touched the network', () => {
    expect(cm.fetchCalls).toEqual([]);
  });
});
