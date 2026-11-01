// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { CANMATRIX_FORMATS } from '../lib/canmatrix/formats';
import type { ImportedCluster } from '../lib/canmatrix/types';
import { parseDbc } from '../lib/dbc/parser';
import { I18nProvider, type Lang } from '../lib/i18n';
import type { ImportedSource } from '../lib/import/loader';
import { ImportFormatsNote, ImportSource, ImportSourceContext, IMP_PROBLEMS_ID } from './ImportSource';
import { Overview } from './Overview';

afterEach(() => vi.unstubAllGlobals());

function render(lang: Lang, element: JSX.Element, source: ImportedSource | null = null) {
  vi.stubGlobal('localStorage', { getItem: () => lang, setItem: () => {}, removeItem: () => {} });
  return renderToStaticMarkup(
    <I18nProvider>
      <ImportSourceContext.Provider value={{ source, onSelectCluster: () => {} }}>{element}</ImportSourceContext.Provider>
    </I18nProvider>,
  );
}

function cluster(name: string, messages: number, problems = 0): ImportedCluster {
  const lines = ['VERSION ""', 'BU_: ECU'];
  for (let i = 0; i < messages; i++) lines.push(`BO_ ${i + 1} M${i}: 8 ECU`);
  for (let i = 0; i < problems; i++) lines.push(`BO_ broken${i}`);
  return { name, db: parseDbc(lines.join('\n') + '\n') };
}

// the_homer.kcd from the cantools corpus, as pinned in import-corpus-baseline.json.
const homer: ImportedSource = {
  format: CANMATRIX_FORMATS.kcd,
  clusters: [cluster('Motor', 7), cluster('Instrumentation', 6), cluster('Comfort', 20)],
  cluster: 0,
};
const sym = (problems: number): ImportedSource => ({
  format: CANMATRIX_FORMATS.sym,
  clusters: [cluster('', 28, problems)],
  cluster: 0,
});

describe('ImportSource', () => {
  it('shows nothing for a DBC', () => {
    expect(render('en', <ImportSource />)).toBe('');
  });

  it('names the source format and says the conversion may be lossy', () => {
    const html = render('en', <ImportSource />, homer);
    expect(html).toContain('data-testid="imp-source"');
    expect(html).toContain('data-format="kcd"');
    expect(html).toContain('Imported from KCD');
    expect(html).toContain('The conversion may be lossy');
    expect(html).toContain('canmatrix reported no problems.');
    expect(html).not.toContain('imp-problems-link');
  });

  it('links to the problems canmatrix reported', () => {
    expect(sym(4).clusters[0].db.problems).toHaveLength(4);
    const html = render('en', <ImportSource />, sym(4));
    expect(html).toContain('Imported from SYM');
    expect(html).toContain('data-testid="imp-problems-link"');
    expect(html).toContain('Show the 4 problems canmatrix reported');
    expect(render('en', <ImportSource />, sym(1))).toContain('Show the problem canmatrix reported');
  });

  it('lets the user pick one of several clusters', () => {
    const html = render('en', <ImportSource />, { ...homer, cluster: 2 });
    expect(html).toContain('This file holds 3 clusters. Pick the one to show:');
    expect(html).toContain('role="radiogroup" aria-labelledby="imp-clusters-hint"');
    const chips = [...html.matchAll(/<button[^>]*role="radio"[^>]*>(.*?)<\/button>/g)];
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => /aria-checked="(\w+)"/.exec(c[0])![1])).toEqual(['false', 'false', 'true']);
    expect(chips.map((c) => /tabindex="(-?\d)"/.exec(c[0])![1])).toEqual(['-1', '-1', '0']);
    expect(chips[0][1]).toContain('Motor');
    expect(chips[0][1]).toContain('7 messages');
    expect(chips[2][1]).toContain('Comfort');
    expect(chips[2][1]).toContain('20 messages');
  });

  it('offers no choice for a file with one cluster, and names an unnamed one', () => {
    expect(render('en', <ImportSource />, sym(0))).not.toContain('radiogroup');
    const html = render('en', <ImportSource />, { ...homer, clusters: [cluster('', 1), cluster('Body', 2)] });
    expect(html).toContain('unnamed');
    expect(html).toContain('1 message');
  });

  it('speaks German', () => {
    const html = render('de', <ImportSource />, { ...sym(4), clusters: [...sym(4).clusters, cluster('B', 1)] });
    expect(html).toContain('Importiert aus SYM');
    expect(html).toContain('Die Umwandlung kann verlustbehaftet sein');
    expect(html).toContain('Die 4 von canmatrix gemeldeten Probleme anzeigen');
    expect(html).toContain('Diese Datei enthält 2 Cluster. Welcher soll angezeigt werden?');
    expect(html).toContain('ohne Namen');
    expect(html).toContain('28 Botschaften');
    expect(render('de', <ImportSource />, homer)).toContain('canmatrix hat keine Probleme gemeldet.');
  });
});

describe('the overview of an imported database', () => {
  const db = sym(4).clusters[0].db;

  it('shows the source above the facts, and gives the problem list the id the note links to', () => {
    const html = render('en', <Overview db={db} fileName="test.sym" onSelect={() => {}} />, sym(4));
    expect(html.indexOf('data-testid="imp-source"')).toBeGreaterThan(html.indexOf('<h1>test.sym</h1>'));
    expect(html.indexOf('data-testid="imp-source"')).toBeLessThan(html.indexOf('class="facts'));
    expect(html).toContain(`<div class="card table-card" id="${IMP_PROBLEMS_ID}" tabindex="-1"><h2>Parse problems (4)</h2>`);
  });

  it('is unchanged for a DBC', () => {
    const demo = parseDbc(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../examples/demo.dbc'), 'utf8'),
    );
    expect(render('en', <Overview db={demo} fileName="demo.dbc" onSelect={() => {}} />)).not.toContain('imp-source');
  });
});

describe('ImportFormatsNote', () => {
  it('lists every canmatrix format on the welcome screen, in both languages', () => {
    expect(render('en', <ImportFormatsNote />)).toBe(
      '<p class="formats">DBC files open instantly. ARXML, KCD, FIBEX, ODX, SYM, DBF, JSON, YAML, and XLSX are read with canmatrix, which loads once on first use.</p>',
    );
    expect(render('de', <ImportFormatsNote />)).toContain('ARXML, KCD, FIBEX, ODX, SYM, DBF, JSON, YAML und XLSX werden mit canmatrix gelesen');
  });
});
