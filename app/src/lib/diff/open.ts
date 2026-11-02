// SPDX-License-Identifier: GPL-2.0-or-later
import { importWithCanmatrix, type ImportStage } from '../canmatrix/client';
import { canmatrixFormatFor } from '../canmatrix/formats';
import { decodeDbc } from '../dbc/decode';
import { parseDbc } from '../dbc/parser';
import type { DbcDatabase } from '../dbc/types';
import { initialCluster } from '../import/clusters';

/**
 * Reads the other version of a database for diff mode the way the app opens a
 * file: DBC with CanViewer's own parser, every other format through canmatrix
 * in the import worker (loaded on first use). Nothing leaves the machine.
 *
 * Of a file with several clusters, the one named `cluster` (the cluster the
 * open file shows) is compared when the file has it, and otherwise the one
 * the app would show first (app/src/lib/import/clusters.ts).
 */
export async function readDatabaseFile(
  file: File,
  onStage?: (stage: ImportStage) => void,
  cluster?: string,
): Promise<DbcDatabase> {
  const bytes = await file.arrayBuffer();
  if (!canmatrixFormatFor(file.name)) return parseDbc(decodeDbc(bytes));
  const { clusters } = await importWithCanmatrix(file.name, bytes, onStage);
  return clusters[initialCluster(clusters, cluster)].db;
}
