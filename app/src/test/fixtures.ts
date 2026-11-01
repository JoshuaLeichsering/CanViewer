/** Databases for the component tests: examples/demo.dbc and small inline files. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDbc } from '../lib/dbc/parser';
import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';

// A path built from strings: under jsdom, URL is jsdom's, which Node's
// fileURLToPath does not accept.
export const DEMO_DBC_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo.dbc');
export const DEMO_DBC_TEXT = readFileSync(DEMO_DBC_PATH, 'utf8');

/** A fresh parse of examples/demo.dbc (9 messages, 5 nodes, 2 value tables). */
export const demoDb = (): DbcDatabase => parseDbc(DEMO_DBC_TEXT);

/** A database from inline DBC text, with the usual header added. */
export const dbcOf = (body: string): DbcDatabase => parseDbc(`VERSION ""\n\n${body}\n`);

export function messageNamed(db: DbcDatabase, name: string): DbcMessage {
  const message = db.messages.find((m) => m.name === name);
  if (!message) throw new Error(`no message ${name}`);
  return message;
}
