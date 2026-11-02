// SPDX-License-Identifier: GPL-2.0-or-later
import type { DbcDatabase } from './types';
import { isJ1939Pg } from './canfd';

/**
 * Decomposition of a 29-bit J1939 identifier:
 *
 *   28..26  Priority
 *   25      Extended Data Page (EDP)
 *   24      Data Page (DP)
 *   23..16  PDU Format (PF)
 *   15..8   PDU Specific (PS) — destination address (PDU1, PF < 240)
 *                               or group extension (PDU2, PF >= 240)
 *   7..0    Source Address (SA)
 *
 * PGN = EDP·2^17 | DP·2^16 | PF·2^8 | (PDU2 ? PS : 0)
 */
export interface J1939Id {
  priority: number;
  extendedDataPage: number;
  dataPage: number;
  pduFormat: number;
  pduSpecific: number;
  /** PDU1 = destination-specific, PDU2 = broadcast. */
  pduType: 'PDU1' | 'PDU2';
  /** Only for PDU1 frames; 0xFF addresses all nodes. */
  destinationAddress?: number;
  pgn: number;
  sourceAddress: number;
}

export function decomposeJ1939Id(id29: number): J1939Id {
  const priority = (id29 >>> 26) & 0x7;
  const extendedDataPage = (id29 >>> 25) & 0x1;
  const dataPage = (id29 >>> 24) & 0x1;
  const pduFormat = (id29 >>> 16) & 0xff;
  const pduSpecific = (id29 >>> 8) & 0xff;
  const sourceAddress = id29 & 0xff;
  const isPdu2 = pduFormat >= 240;
  return {
    priority,
    extendedDataPage,
    dataPage,
    pduFormat,
    pduSpecific,
    pduType: isPdu2 ? 'PDU2' : 'PDU1',
    destinationAddress: isPdu2 ? undefined : pduSpecific,
    pgn:
      (extendedDataPage << 17) |
      (dataPage << 16) |
      (pduFormat << 8) |
      (isPdu2 ? pduSpecific : 0),
    sourceAddress,
  };
}

/**
 * Should this database get J1939 treatment (PGN column, ID breakdown)?
 * True when the network ProtocolType attribute says J1939 (explicitly or via
 * its BA_DEF_DEF_ default), or when any message is declared a J1939 PG.
 */
export function isJ1939Database(
  db: Pick<DbcDatabase, 'attributes' | 'attributeDefinitions' | 'messages'>,
): boolean {
  const protocol =
    db.attributes.ProtocolType ??
    db.attributeDefinitions.find((d) => d.name === 'ProtocolType' && d.objectType === '')
      ?.defaultValue;
  if (typeof protocol === 'string' && protocol.toUpperCase().includes('J1939')) return true;
  return db.messages.some((m) => m.isExtended && isJ1939Pg(db, m));
}

/** Well-known SAE J1939 parameter group names (abbreviation — full name). */
export const PGN_NAMES: Record<number, string> = {
  0: 'TSC1 — Torque/Speed Control 1',
  256: 'TC1 — Transmission Control 1',
  59392: 'ACKM — Acknowledgment',
  59904: 'RQST — Request',
  60160: 'TP.DT — Transport Protocol, Data Transfer',
  60416: 'TP.CM — Transport Protocol, Connection Management',
  60928: 'AC — Address Claimed',
  61440: 'ERC1 — Electronic Retarder Controller 1',
  61441: 'EBC1 — Electronic Brake Controller 1',
  61442: 'ETC1 — Electronic Transmission Controller 1',
  61443: 'EEC2 — Electronic Engine Controller 2',
  61444: 'EEC1 — Electronic Engine Controller 1',
  61445: 'ETC2 — Electronic Transmission Controller 2',
  65215: 'EBC2 — Wheel Speed Information',
  65226: 'DM1 — Active Diagnostic Trouble Codes',
  65227: 'DM2 — Previously Active Diagnostic Trouble Codes',
  65247: 'EEC3 — Electronic Engine Controller 3',
  65253: 'HOURS — Engine Hours, Revolutions',
  65254: 'TD — Time/Date',
  65257: 'LFC — Fuel Consumption (Liquid)',
  65260: 'VI — Vehicle Identification',
  65262: 'ET1 — Engine Temperature 1',
  65263: 'EFL/P1 — Engine Fluid Level/Pressure 1',
  65265: 'CCVS1 — Cruise Control/Vehicle Speed 1',
  65266: 'LFE1 — Fuel Economy (Liquid)',
  65269: 'AMB — Ambient Conditions',
  65271: 'VEP1 — Vehicle Electrical Power 1',
  65272: 'TRF1 — Transmission Fluids 1',
};

/** A few standard J1939 source/destination addresses. */
export const ADDRESS_NAMES: Record<number, string> = {
  0: 'Engine #1',
  1: 'Engine #2',
  2: 'Turbocharger',
  3: 'Transmission #1',
  11: 'Brakes — System Controller',
  15: 'Retarder — Engine',
  23: 'Instrument Cluster #1',
  33: 'Body Controller',
  254: 'Null address',
  255: 'Global (all nodes)',
};
