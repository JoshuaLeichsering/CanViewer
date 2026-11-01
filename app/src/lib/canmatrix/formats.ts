/**
 * File formats read through canmatrix, and the Python packages each one needs
 * beyond canmatrix itself (attrs, click and six come with it). Packages are
 * loaded only when a file of that format is opened.
 *
 * `.dbc` is deliberately absent: CanViewer's own parser
 * (app/src/lib/dbc/parser.ts) stays in charge of DBC.
 *
 * This table is the single list of what CanViewer opens: the file dialog's
 * accept list (FILE_INPUT_ACCEPT), the welcome text and the import UI's tests
 * (e2e/import-ui.test.mjs) are derived from it. It holds only erasable
 * TypeScript, so Node can import it as it is.
 */
export interface CanmatrixFormat {
  /** canmatrix's import_type, i.e. the module name under canmatrix.formats. */
  importType: string;
  /** Lock entries (app/src/lib/canmatrix/wheels.lock.json) to load first. */
  packages: string[];
  /** The format's name as the UI shows it (not translated). */
  label: string;
}

export const CANMATRIX_FORMATS: Record<string, CanmatrixFormat> = {
  arxml: { importType: 'arxml', packages: ['lxml'], label: 'ARXML' },
  kcd: { importType: 'kcd', packages: ['lxml'], label: 'KCD' },
  // canmatrix registers FIBEX under the .xml extension.
  xml: { importType: 'fibex', packages: ['lxml'], label: 'FIBEX' },
  odx: { importType: 'odx', packages: ['lxml'], label: 'ODX' },
  sym: { importType: 'sym', packages: [], label: 'SYM' },
  dbf: { importType: 'dbf', packages: [], label: 'DBF' },
  json: { importType: 'json', packages: [], label: 'JSON' },
  yaml: { importType: 'yaml', packages: ['pyyaml'], label: 'YAML' },
  yml: { importType: 'yaml', packages: ['pyyaml'], label: 'YAML' },
  xlsx: { importType: 'xlsx', packages: ['openpyxl'], label: 'XLSX' },
  xls: { importType: 'xls', packages: ['xlrd', 'xlwt'], label: 'XLS' },
};

/** Extensions CanViewer's own DBC parser opens (DBC files are sometimes shipped as .txt). */
export const DBC_EXTENSIONS = ['dbc', 'txt'];

/** The file input's accept attribute: every extension CanViewer opens. */
export const FILE_INPUT_ACCEPT = [...DBC_EXTENSIONS, ...Object.keys(CANMATRIX_FORMATS)]
  .map((ext) => `.${ext}`)
  .join(',');

/** The canmatrix formats' labels, each once, in the order of the table. */
export function canmatrixFormatLabels(): string[] {
  return [...new Set(Object.values(CANMATRIX_FORMATS).map((f) => f.label))];
}

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** The canmatrix format for a file name, or undefined (e.g. for .dbc). */
export function canmatrixFormatFor(fileName: string): CanmatrixFormat | undefined {
  return CANMATRIX_FORMATS[fileExtension(fileName)];
}
