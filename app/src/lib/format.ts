// SPDX-License-Identifier: GPL-2.0-or-later
/** Compact number formatting without float noise (0.30000000000000004 -> 0.3). */
export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(10)));
}

export function hexId(id: number, isExtended: boolean): string {
  return '0x' + id.toString(16).toUpperCase().padStart(isExtended ? 8 : 3, '0');
}

export function muxLabel(mux: {
  role: string;
  switchValue?: number;
  extended?: { switchName: string; ranges: Array<[number, number]> };
}): string {
  if (mux.role === 'multiplexor') return 'M';
  if (mux.role === 'none') return '';
  const base = mux.role === 'both' ? `m${mux.switchValue}M` : `m${mux.switchValue}`;
  return base;
}
