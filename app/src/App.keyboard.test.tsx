// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// Keyboard and layout in the app as a whole: "/" focuses the message search from any
// view, a deep link pasted into the open app is followed, and on narrow screens
// the list and the detail take turns with a back button between them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { File as NodeFile } from 'node:buffer';
import { renderWithProviders } from './test/render';
import { DEMO_DBC_TEXT } from './test/fixtures';
import { App } from './App';

// The canmatrix import needs a Web Worker, which jsdom has not; no test here imports.
vi.mock('./lib/canmatrix/client', () => ({ importWithCanmatrix: vi.fn() }));

const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement;
const openText = async (name: string, text: string) => {
  fireEvent.change(fileInput(), { target: { files: [new NodeFile([text], name) as unknown as File] } });
  await screen.findByRole('heading', { level: 1, name });
};
const rail = (label: string) =>
  [...document.querySelectorAll('.rail-item')].find((b) => b.querySelector('.label')?.textContent === label) as HTMLButtonElement;
const h1 = () => screen.getByRole('heading', { level: 1 }).textContent;
const searchField = () => document.querySelector<HTMLInputElement>('.list-pane input[type=search]');
const paste = (hash: string) => {
  history.replaceState(null, '', `/${hash}`);
  fireEvent(window, new HashChangeEvent('hashchange'));
};

beforeEach(() => {
  history.replaceState(null, '', '/');
  // jsdom lays nothing out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
  vi.restoreAllMocks();
});

describe('App: "/" focuses the message search', () => {
  it('goes to the messages and focuses the search from another view', async () => {
    renderWithProviders(<App />);
    await openText('demo.dbc', DEMO_DBC_TEXT);
    expect(searchField()).toBeNull();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(h1()).toBe('EngineData');
    expect(document.activeElement).toBe(searchField());
  });

  it('types a "/" instead while a text field has the focus, and ignores "/" with a modifier', async () => {
    renderWithProviders(<App />);
    await openText('demo.dbc', DEMO_DBC_TEXT);
    fireEvent.click(rail('Nodes'));
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    expect(h1()).toBe('ECM');

    fireEvent.click(rail('Messages'));
    const field = searchField()!;
    field.blur();
    fireEvent.keyDown(field, { key: '/' });
    // Not handled as the shortcut: the field did not take the focus.
    expect(document.activeElement).not.toBe(field);
  });

  it('does nothing before a file is open, or for a file without messages', async () => {
    renderWithProviders(<App />);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(rail('Messages').disabled).toBe(true);
    await openText('empty.dbc', 'VERSION ""\n\nBU_: A\n');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(h1()).toBe('empty.dbc');
    expect(searchField()).toBeNull();
  });
});

describe('App: a deep link pasted into the open app', () => {
  it('opens what the new hash names', async () => {
    renderWithProviders(<App />);
    await openText('demo.dbc', DEMO_DBC_TEXT);
    paste('#node=TCM');
    expect(h1()).toBe('TCM');
    paste('#msg=768');
    expect(h1()).toBe('BrakeData');
  });

  it('shows the overview for a malformed link', async () => {
    renderWithProviders(<App />);
    await openText('demo.dbc', DEMO_DBC_TEXT);
    paste('#node=TCM');
    paste('#node=%E0');
    expect(h1()).toBe('demo.dbc');
  });
});

describe('App: the list and the detail take turns', () => {
  it('opens the detail from the list, moves the focus to its back button, and goes back to the list', async () => {
    renderWithProviders(<App />);
    await openText('demo.dbc', DEMO_DBC_TEXT);
    const app = document.querySelector('.app')!;
    fireEvent.click(rail('Messages'));
    expect(app.className).toContain('rgh-pane-list');

    fireEvent.click(within(document.querySelector('.list-pane') as HTMLElement).getByText('BrakeData'));
    expect(app.className).toContain('rgh-pane-detail');
    // The list item clicked is hidden now (jsdom reports no layout for it).
    const back = screen.getByRole('button', { name: 'All messages' });
    expect(document.activeElement).toBe(back);

    fireEvent.click(back);
    expect(app.className).toContain('rgh-pane-list');
    expect(document.activeElement).toBe(document.querySelector('.list-pane .list-item.active'));
    expect((document.activeElement as HTMLElement).textContent).toContain('BrakeData');
  });

  it('names the list to go back to', async () => {
    renderWithProviders(<App />);
    await openText('vt.dbc', DEMO_DBC_TEXT);
    fireEvent.click(rail('Nodes'));
    expect(screen.getByRole('button', { name: 'All nodes' })).toBeTruthy();
    fireEvent.click(rail('Tables'));
    expect(screen.getByRole('button', { name: 'All value tables' })).toBeTruthy();
    fireEvent.click(rail('Overview'));
    expect(screen.queryByRole('button', { name: /^All / })).toBeNull();
  });
});
