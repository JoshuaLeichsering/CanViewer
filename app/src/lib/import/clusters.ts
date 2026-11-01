// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which cluster of an imported file to show first. ARXML, KCD and FIBEX files
 * can hold several (cantools' the_homer.kcd holds three); the user picks
 * another one on the overview (components/ImportSource.tsx).
 *
 * The cluster picked before (restored from storage by name) wins while the
 * file still holds it. Otherwise the first cluster that holds messages, so a
 * file that starts with an empty bus does not open on an empty page, and
 * failing that the first one.
 */
export function initialCluster(
  clusters: ReadonlyArray<{ name: string; db: { messages: readonly unknown[] } }>,
  picked?: string,
): number {
  if (picked !== undefined) {
    const index = clusters.findIndex((c) => c.name === picked);
    if (index >= 0) return index;
  }
  const withMessages = clusters.findIndex((c) => c.db.messages.length > 0);
  return withMessages >= 0 ? withMessages : 0;
}
