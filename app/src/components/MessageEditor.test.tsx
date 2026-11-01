// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDbc } from '../lib/dbc/parser';
import { I18nProvider } from '../lib/i18n';
import { MessageEditor } from './MessageEditor';
import { byTestId, click, choose, press, queryTestId, render, text, type } from './dom-test-utils';
import demo from '../../../examples/demo.dbc?raw';

const db = parseDbc(demo);
const engine = db.messages.find((m) => m.name === 'EngineData')!;

let view: ReturnType<typeof render> | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
  localStorage.clear();
});

function setup(lang?: 'de') {
  if (lang) localStorage.setItem('canviewer.lang', lang);
  const onApply = vi.fn();
  view = render(
    <I18nProvider>
      <MessageEditor db={db} message={engine} onApply={onApply} />
    </I18nProvider>,
  );
  return onApply;
}

const input = (id: string) => byTestId<HTMLInputElement>(id);

describe('MessageEditor', () => {
  beforeEach(() => localStorage.clear());

  it('opens a modal dialog filled with the message, focused on the name', () => {
    setup();
    expect(queryTestId('edt-message-dialog')).toBeNull();
    click(byTestId('edt-edit-message'));
    const dialog = byTestId('edt-message-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(text(document.getElementById(dialog.getAttribute('aria-labelledby')!))).toBe('Edit message EngineData');
    expect(input('edt-message-name').value).toBe('EngineData');
    expect(input('edt-message-id').value).toBe('0x100');
    expect(input('edt-message-dlc').value).toBe('8');
    expect(input('edt-message-extended').checked).toBe(false);
    expect(byTestId<HTMLSelectElement>('edt-message-sender').value).toBe('ECM');
    expect(byTestId<HTMLTextAreaElement>('edt-message-comment').value).toBe('Engine status broadcast, 10 ms cycle.');
    expect(document.activeElement).toBe(input('edt-message-name'));
  });

  it('offers no sender plus every node as the sender', () => {
    setup();
    click(byTestId('edt-edit-message'));
    const options = [...byTestId<HTMLSelectElement>('edt-message-sender').options].map((o) => [o.value, o.textContent]);
    expect(options).toEqual([['', '(none)'], ['ECM', 'ECM'], ['TCM', 'TCM'], ['ABS', 'ABS'], ['IC', 'IC'], ['Tester', 'Tester']]);
  });

  it('applies the edited properties and closes, giving the focus back', () => {
    const onApply = setup();
    const opener = byTestId('edt-edit-message');
    opener.focus();
    click(opener);
    type(input('edt-message-name'), 'EngineStatus');
    type(input('edt-message-id'), '0x18FF1234');
    click(input('edt-message-extended'));
    type(input('edt-message-dlc'), '12');
    choose(byTestId<HTMLSelectElement>('edt-message-sender'), '');
    type(byTestId<HTMLTextAreaElement>('edt-message-comment'), 'Rewritten.');
    click(byTestId('edt-submit'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject({
      name: 'EngineStatus',
      id: 0x18ff1234,
      rawId: 0x18ff1234 + 0x80000000,
      isExtended: true,
      dlc: 12,
      sender: '',
      comment: 'Rewritten.',
      signals: engine.signals,
    });
    expect(queryTestId('edt-message-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('shows what is wrong, next to the field, and keeps the dialog open', () => {
    const onApply = setup();
    click(byTestId('edt-edit-message'));
    type(input('edt-message-name'), 'Engine Data');
    type(input('edt-message-id'), '0x200');
    type(input('edt-message-dlc'), 'eight');
    click(byTestId('edt-submit'));

    expect(onApply).not.toHaveBeenCalled();
    expect(queryTestId('edt-message-dialog')).not.toBeNull();
    const help = (id: string) => {
      const field = input(id);
      expect(field.getAttribute('aria-invalid')).toBe('true');
      return text(document.getElementById(field.getAttribute('aria-describedby')!));
    };
    expect(help('edt-message-name')).toBe('Use letters, digits and underscores, and do not start with a digit.');
    expect(help('edt-message-id')).toBe('Message GearboxData already uses this ID.');
    expect(help('edt-message-dlc')).toBe('Enter a whole number of bytes from 0 to 1785.');

    // Correcting a field clears its message.
    type(input('edt-message-name'), 'EngineData2');
    expect(input('edt-message-name').hasAttribute('aria-invalid')).toBe(false);
  });

  it('cancels with Escape and with Cancel, applying nothing', () => {
    const onApply = setup();
    click(byTestId('edt-edit-message'));
    type(input('edt-message-name'), 'Changed');
    press(input('edt-message-name'), 'Escape');
    expect(queryTestId('edt-message-dialog')).toBeNull();

    click(byTestId('edt-edit-message'));
    expect(input('edt-message-name').value).toBe('EngineData');
    click(byTestId('edt-cancel'));
    expect(queryTestId('edt-message-dialog')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the dialog', () => {
    setup();
    click(byTestId('edt-edit-message'));
    const submit = byTestId('edt-submit');
    submit.focus();
    press(submit, 'Tab');
    expect(document.activeElement).toBe(input('edt-message-name'));
    press(input('edt-message-name'), 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(submit);
  });

  it('refuses a comment on a second message with the same id, which DBC cannot address', () => {
    const duplicates = parseDbc('BU_: A\nBO_ 1 First: 8 A\nBO_ 1 Second: 8 A\n');
    const second = duplicates.messages[1];
    const onApply = vi.fn();
    view = render(
      <I18nProvider>
        <MessageEditor db={duplicates} message={second} onApply={onApply} />
      </I18nProvider>,
    );
    click(byTestId('edt-edit-message'));
    type(input('edt-message-name'), 'SecondRenamed');
    type(byTestId<HTMLTextAreaElement>('edt-message-comment'), 'second comment');
    click(byTestId('edt-submit'));
    expect(onApply).not.toHaveBeenCalled();
    const comment = byTestId<HTMLTextAreaElement>('edt-message-comment');
    expect(comment.getAttribute('aria-invalid')).toBe('true');
    expect(text(document.getElementById(comment.getAttribute('aria-describedby')!))).toBe(
      'DBC cannot attach a comment to this message: an earlier message has the same ID.',
    );
    expect(input('edt-message-name').hasAttribute('aria-invalid')).toBe(false);

    // A new id makes it addressable.
    type(input('edt-message-id'), '0x2');
    click(byTestId('edt-submit'));
    expect(onApply.mock.calls[0][0]).toMatchObject({ name: 'SecondRenamed', id: 2, comment: 'second comment' });
  });

  it('speaks German', () => {
    setup('de');
    expect(text(byTestId('edt-edit-message'))).toBe('Botschaft bearbeiten');
    click(byTestId('edt-edit-message'));
    expect(text(byTestId('edt-message-dialog').querySelector('h2'))).toBe('Botschaft EngineData bearbeiten');
    expect(text(byTestId('edt-submit'))).toBe('Übernehmen');
    type(input('edt-message-dlc'), '-1');
    click(byTestId('edt-submit'));
    expect(text(byTestId('edt-message-dialog'))).toContain('Eine ganze Zahl von 0 bis 1785 Bytes eingeben.');
  });
});
