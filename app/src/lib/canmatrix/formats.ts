// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * File formats read through canmatrix, and the Python packages each one needs
 * beyond canmatrix itself (attrs, click and six come with it). Packages are
 * loaded only when a file of that format is opened.
 *
 * `.dbc` is deliberately absent: CanViewer's own parser
 * (app/src/lib/dbc/parser.ts) stays in charge of DBC.
 */
export interface CanmatrixFormat {
  /** canmatrix's import_type, i.e. the module name under canmatrix.formats. */
  importType: string;
  /** Lock entries (app/src/lib/canmatrix/wheels.lock.json) to load first. */
  packages: string[];
}

export const CANMATRIX_FORMATS: Record<string, CanmatrixFormat> = {
  arxml: { importType: 'arxml', packages: ['lxml'] },
  kcd: { importType: 'kcd', packages: ['lxml'] },
  // canmatrix registers FIBEX under the .xml extension.
  xml: { importType: 'fibex', packages: ['lxml'] },
  odx: { importType: 'odx', packages: ['lxml'] },
  sym: { importType: 'sym', packages: [] },
  dbf: { importType: 'dbf', packages: [] },
  json: { importType: 'json', packages: [] },
  yaml: { importType: 'yaml', packages: ['pyyaml'] },
  yml: { importType: 'yaml', packages: ['pyyaml'] },
  xlsx: { importType: 'xlsx', packages: ['openpyxl'] },
  // No .xls: canmatrix reads it with xlrd 1.2.0, whose license includes an
  // original-BSD advertising clause that is incompatible with the GPL
  // (docs/handover/2026-11-01-license-audit.md). .xlsx covers Excel files.
};

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** The canmatrix format for a file name, or undefined (e.g. for .dbc). */
export function canmatrixFormatFor(fileName: string): CanmatrixFormat | undefined {
  return CANMATRIX_FORMATS[fileExtension(fileName)];
}
