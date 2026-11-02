// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../test/render';
import { I18nProvider, useI18n, type Lang } from './i18n';

function Probe({ to }: { to?: Lang }) {
  const { t, tn, lang, setLang } = useI18n();
  return (
    <div>
      <span data-testid="tst-lang">{lang}</span>
      <span data-testid="tst-plain">{t('railMessages')}</span>
      <span data-testid="tst-param">{t('importFailed', { name: 'a.arxml', error: 'boom' })}</span>
      <span data-testid="tst-missing">{t('importFailed', { name: 'a.arxml' })}</span>
      <span data-testid="tst-none">{t('listMessages')}</span>
      <span data-testid="tst-one">{tn('signalsOne', 'signalsMany', 1)}</span>
      <span data-testid="tst-many">{tn('signalsOne', 'signalsMany', 3)}</span>
      <span data-testid="tst-zero">{tn('signalsOne', 'signalsMany', 0)}</span>
      <span data-testid="tst-extra">{tn('edgeTitleOne', 'edgeTitleMany', 2, { from: 'A', to: 'B' })}</span>
      {to && <button onClick={() => setLang(to)}>switch</button>}
    </div>
  );
}

const text = (id: string) => screen.getByTestId(`tst-${id}`).textContent;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('i18n', () => {
  it('translates, fills in parameters and keeps unknown placeholders', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(text('lang')).toBe('en');
    expect(text('plain')).toBe('Messages');
    expect(text('param')).toBe('Could not read a.arxml: boom');
    expect(text('missing')).toBe('Could not read a.arxml: {error}');
    expect(text('none')).toBe('Messages · {n}');
  });

  it('picks the singular for exactly one and the plural otherwise', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(text('one')).toBe('1 signal');
    expect(text('many')).toBe('3 signals');
    expect(text('zero')).toBe('0 signals');
    expect(text('extra')).toBe('A → B: 2 messages');
  });

  it('switches to German, sets the document language and remembers it', () => {
    render(
      <I18nProvider>
        <Probe to="de" />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe('en');
    fireEvent.click(screen.getByRole('button'));
    expect(text('lang')).toBe('de');
    expect(text('plain')).toBe('Botschaften');
    expect(text('param')).toBe('a.arxml konnte nicht gelesen werden: boom');
    expect(text('one')).toBe('1 Signal');
    expect(text('many')).toBe('3 Signale');
    expect(document.documentElement.lang).toBe('de');
    expect(localStorage.getItem('canviewer.lang')).toBe('de');
  });

  it('starts from the stored language', () => {
    localStorage.setItem('canviewer.lang', 'de');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(text('lang')).toBe('de');
  });

  it('follows a German browser without a stored choice, and ignores an unknown one', () => {
    localStorage.setItem('canviewer.lang', 'fr');
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-AT');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(text('lang')).toBe('de');
  });

  it('falls back to the browser language when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    render(
      <I18nProvider>
        <Probe to="de" />
      </I18nProvider>,
    );
    expect(text('lang')).toBe('en');
    fireEvent.click(screen.getByRole('button'));
    expect(text('lang')).toBe('de');
  });

  it('gives English outside a provider', () => {
    render(<Probe to="de" />);
    fireEvent.click(screen.getByRole('button'));
    expect(text('plain')).toBe('Messages');
  });
});
