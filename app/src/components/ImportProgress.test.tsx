// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider, type Lang } from '../lib/i18n';
import { ImportProgress, importSteps } from './ImportProgress';

afterEach(() => vi.unstubAllGlobals());

/** Render in a language, chosen the way the app remembers it (localStorage). */
function render(lang: Lang, element: JSX.Element) {
  vi.stubGlobal('localStorage', { getItem: () => lang, setItem: () => {}, removeItem: () => {} });
  return renderToStaticMarkup(<I18nProvider>{element}</I18nProvider>);
}

const kcd = (stage: 'runtime' | 'packages' | 'reading') => ({ name: 'the_homer.kcd', stage, packages: ['lxml'] });

describe('importSteps', () => {
  it('lists runtime, packages and reading, and marks where the import is', () => {
    expect(importSteps(kcd('runtime'))).toEqual([
      { stage: 'runtime', state: 'active' },
      { stage: 'packages', state: 'pending' },
      { stage: 'reading', state: 'pending' },
    ]);
    expect(importSteps(kcd('packages')).map((s) => s.state)).toEqual(['done', 'active', 'pending']);
    expect(importSteps(kcd('reading')).map((s) => s.state)).toEqual(['done', 'done', 'active']);
  });

  it('leaves out the package step for a format that needs no packages', () => {
    expect(importSteps({ name: 'test.sym', stage: 'reading', packages: [] })).toEqual([
      { stage: 'runtime', state: 'done' },
      { stage: 'reading', state: 'active' },
    ]);
  });
});

describe('ImportProgress', () => {
  it('shows every step with its state, in English', () => {
    const html = render('en', <ImportProgress progress={kcd('packages')} />);
    expect(html).toContain('data-testid="imp-progress"');
    expect(html).toContain('data-stage="packages"');
    expect(html).toContain('Opening the_homer.kcd');
    expect(html).toMatch(/data-testid="imp-step-runtime" data-state="done".*Python runtime.*\(done\).*loaded once per session/);
    expect(html).toMatch(/data-testid="imp-step-packages" data-state="active" aria-current="step".*Format support.*\(in progress\).*lxml/);
    expect(html).toMatch(/data-testid="imp-step-reading" data-state="pending".*Reading with canmatrix.*\(waiting\)/);
    // Announced to screen readers as the stage changes.
    expect(html).toContain('<span class="visually-hidden" role="status">Loading format support for the_homer.kcd…</span>');
  });

  it('shows every step in German', () => {
    const html = render('de', <ImportProgress progress={kcd('reading')} />);
    expect(html).toContain('the_homer.kcd wird geöffnet');
    expect(html).toContain('Python-Laufzeit');
    expect(html).toContain('einmal pro Sitzung geladen');
    expect(html).toContain('Formatunterstützung');
    expect(html).toContain('Lesen mit canmatrix');
    expect(html).toContain('(erledigt)');
    expect(html).toContain('(läuft)');
    expect(html).toContain('Lese the_homer.kcd mit canmatrix…');
  });

  it('lists the packages a format needs', () => {
    const html = render('en', <ImportProgress progress={{ name: 'a.xls', stage: 'packages', packages: ['xlrd', 'xlwt'] }} />);
    expect(html).toContain('xlrd, xlwt');
    expect(render('en', <ImportProgress progress={{ name: 'a.sym', stage: 'runtime', packages: [] }} />)).not.toContain(
      'imp-step-packages',
    );
  });
});
