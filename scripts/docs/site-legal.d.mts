// SPDX-License-Identifier: GPL-2.0-or-later
// Types for site-legal.mjs, for the site's configuration (docs/.vitepress/config.mts).

/** The files published next to the site's pages, by name, with the repository file each is copied from. */
export const SITE_FILES: Record<string, string>;

/** The problems of one client bundle of the site; empty when the notices cover it. */
export function siteBundleProblems(input: {
  moduleIds: string[];
  assetPaths: string[];
  notices: string;
  versionAt: (dir: string) => string;
}): string[];

/** The Vite plugin that checks the site's bundle against the notices and publishes LICENSE.txt and THIRD_PARTY_NOTICES.txt. */
export function siteLegalFiles(options: { base: string }): { name: string };
