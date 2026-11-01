// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { messageRoundTrip, physicalRoundTrip, rawRoundTrip } from './encode-properties';
import { parseDbc } from './parser';

/**
 * Property tests of the frame encoder over every signal and every message of
 * examples/demo.dbc: Intel and Motorola, signed, IEEE float, multiplexed
 * (simple and SG_MUL_VAL_), J1939 and a 24-byte CAN FD frame.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const demo = parseDbc(readFileSync(join(root, 'examples/demo.dbc'), 'utf8'));
const signals = demo.messages.flatMap((m) => m.signals.map((s) => [`${m.name}.${s.name}`, m, s] as const));

describe('frame encoder on examples/demo.dbc (property tests)', () => {
  it('covers every signal of every message', () => {
    expect(demo.problems).toEqual([]);
    expect(demo.messages.length).toBe(9);
    expect(signals.length).toBe(33);
  });

  it.each(signals)('%s: any raw value round-trips through its bits', (_, message, signal) => {
    rawRoundTrip(signal, message.dlc, 300);
  });

  it.each(signals)('%s: any physical value the decoder produces encodes back to itself', (_, message, signal) => {
    physicalRoundTrip(signal, message.dlc, 300);
  });

  it.each(demo.messages.map((m) => [m.name, m] as const))('%s: whole frames round-trip, multiplexing included', (_, message) => {
    messageRoundTrip(message, 500);
  });
});
