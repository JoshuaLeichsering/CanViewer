// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { decodeDbc } from './decode';

describe('decodeDbc', () => {
  it('reads valid UTF-8 as UTF-8', () => {
    const text = 'CM_ "Öltemperatur in °C";';
    expect(decodeDbc(new TextEncoder().encode(text))).toBe(text);
  });

  it('falls back to Windows-1252 when the bytes are not UTF-8', () => {
    // "Öl °C €" in Windows-1252: Ö = 0xD6, ° = 0xB0, € = 0x80
    const bytes = new Uint8Array([0xd6, 0x6c, 0x20, 0xb0, 0x43, 0x20, 0x80]);
    expect(decodeDbc(bytes)).toBe('Öl °C €');
    expect(decodeDbc(bytes.buffer)).toBe('Öl °C €');
  });
});
