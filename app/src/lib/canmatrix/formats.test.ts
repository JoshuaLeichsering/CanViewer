// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CANMATRIX_FORMATS,
  DATABASE_INPUT_ACCEPT,
  DBC_EXTENSIONS,
  FILE_INPUT_ACCEPT,
  TRACE_EXTENSIONS,
  canmatrixFormatFor,
  canmatrixFormatLabels,
  fileExtension,
} from './formats';
import { isTraceFileName } from '../trace';

describe('the file dialog accept list', () => {
  const accepted = FILE_INPUT_ACCEPT.split(',');

  it('offers every format canmatrix reads, and nothing twice', () => {
    for (const ext of Object.keys(CANMATRIX_FORMATS)) expect(accepted).toContain(`.${ext}`);
    expect(new Set(accepted).size).toBe(accepted.length);
  });

  it('offers the extensions CanViewer’s own DBC parser opens', () => {
    expect(DBC_EXTENSIONS).toContain('dbc');
    for (const ext of DBC_EXTENSIONS) {
      expect(accepted).toContain(`.${ext}`);
      expect(canmatrixFormatFor(`file.${ext}`)).toBeUndefined();
    }
  });

  it('offers the logs, which open in the Traces view', () => {
    expect(TRACE_EXTENSIONS).toEqual(['asc', 'log']);
    for (const ext of TRACE_EXTENSIONS) {
      expect(accepted).toContain(`.${ext}`);
      expect(isTraceFileName(`trace.${ext.toUpperCase()}`)).toBe(true);
    }
    expect(isTraceFileName('demo.dbc')).toBe(false);
    expect(isTraceFileName('catalog.asc.dbc')).toBe(false);
  });

  it('holds exactly the DBC extensions, the canmatrix formats and the logs', () => {
    expect(accepted).toEqual([...DBC_EXTENSIONS, ...Object.keys(CANMATRIX_FORMATS), ...TRACE_EXTENSIONS].map((e) => `.${e}`));
  });

  it('offers databases only where a database is asked for (the Compare page)', () => {
    expect(DATABASE_INPUT_ACCEPT.split(',')).toEqual([...DBC_EXTENSIONS, ...Object.keys(CANMATRIX_FORMATS)].map((e) => `.${e}`));
  });
});

describe('format labels', () => {
  it('names every canmatrix format', () => {
    for (const format of Object.values(CANMATRIX_FORMATS)) expect(format.label).toMatch(/\S/);
  });

  it('lists each label once, in the order of the table', () => {
    // .yaml and .yml are one format.
    expect(canmatrixFormatLabels()).toEqual(['ARXML', 'KCD', 'FIBEX', 'ODX', 'SYM', 'DBF', 'JSON', 'YAML', 'XLSX']);
  });
});

describe('canmatrixFormatFor', () => {
  it('ignores the case of the extension', () => {
    expect(canmatrixFormatFor('THE_HOMER.KCD')?.importType).toBe('kcd');
    expect(fileExtension('a.b.ARXML')).toBe('arxml');
  });

  it('maps .xml to FIBEX and both YAML spellings to the YAML reader', () => {
    expect(canmatrixFormatFor('bus.xml')?.importType).toBe('fibex');
    expect(canmatrixFormatFor('bus.yml')?.importType).toBe('yaml');
    expect(canmatrixFormatFor('bus.yaml')?.label).toBe(canmatrixFormatFor('bus.yml')?.label);
  });

  it('leaves DBC and unknown files to CanViewer’s parser', () => {
    expect(canmatrixFormatFor('demo.dbc')).toBeUndefined();
    // .xls is not imported: xlrd's license is incompatible with the GPL.
    expect(canmatrixFormatFor('matrix.xls')).toBeUndefined();
    expect(canmatrixFormatFor('notes.txt')).toBeUndefined();
    expect(canmatrixFormatFor('no-extension')).toBeUndefined();
  });
});
