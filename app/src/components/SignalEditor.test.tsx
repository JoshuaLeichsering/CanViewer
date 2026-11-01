// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDbc } from '../lib/dbc/parser';
import { I18nProvider } from '../lib/i18n';
import { SignalEditor } from './SignalEditor';
import { byTestId, choose, click, queryTestId, render, text, type } from './dom-test-utils';
import demo from '../../../examples/demo.dbc?raw';

const db = parseDbc(demo);
const engine = db.messages.find((m) => m.name === 'EngineData')!;
const speed = engine.signals.find((s) => s.name === 'EngineSpeed')!;

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
      <SignalEditor db={db} message={engine} signal={speed} onApply={onApply} />
    </I18nProvider>,
  );
  click(byTestId('edt-edit-signal'));
  return onApply;
}

const input = (id: string) => byTestId<HTMLInputElement>(id);
const select = (id: string) => byTestId<HTMLSelectElement>(id);
const receiver = (name: string) => input(`edt-signal-receiver-${name}`);

describe('SignalEditor', () => {
  it('opens filled with the signal, exactly', () => {
    setup();
    expect(text(byTestId('edt-signal-dialog').querySelector('h2'))).toBe('Edit signal EngineSpeed');
    expect(input('edt-signal-name').value).toBe('EngineSpeed');
    expect(input('edt-signal-start').value).toBe('0');
    expect(input('edt-signal-length').value).toBe('16');
    expect(select('edt-signal-order').value).toBe('intel');
    expect(select('edt-signal-type').value).toBe('unsigned');
    expect(input('edt-signal-factor').value).toBe('0.25');
    expect(input('edt-signal-offset').value).toBe('0');
    expect(input('edt-signal-min').value).toBe('0');
    expect(input('edt-signal-max').value).toBe('16383.75');
    expect(input('edt-signal-unit').value).toBe('rpm');
    expect(byTestId<HTMLTextAreaElement>('edt-signal-comment').value).toBe('Crankshaft rotational speed.');
    // Every node is offered; the signal's receivers are checked.
    const checked = db.nodes.map((n) => [n.name, receiver(n.name).checked]);
    expect(checked).toEqual([['ECM', false], ['TCM', true], ['ABS', true], ['IC', true], ['Tester', false]]);
  });

  it('applies every property, a decimal comma included', () => {
    const onApply = setup();
    type(input('edt-signal-name'), 'EngineRpm');
    type(input('edt-signal-start'), '8');
    type(input('edt-signal-length'), '15');
    choose(select('edt-signal-order'), 'motorola');
    choose(select('edt-signal-type'), 'signed');
    type(input('edt-signal-factor'), '0,5');
    type(input('edt-signal-offset'), '-100');
    type(input('edt-signal-min'), '-100');
    type(input('edt-signal-max'), '16283.5');
    type(input('edt-signal-unit'), 'U/min');
    click(receiver('ABS'));
    click(receiver('ECM'));
    type(byTestId<HTMLTextAreaElement>('edt-signal-comment'), '');
    click(byTestId('edt-submit'));

    expect(onApply).toHaveBeenCalledTimes(1);
    const updated = onApply.mock.calls[0][0];
    expect(updated).toMatchObject({
      name: 'EngineRpm',
      startBit: 8,
      length: 15,
      byteOrder: 'motorola',
      valueType: 'signed',
      factor: 0.5,
      offset: -100,
      min: -100,
      max: 16283.5,
      unit: 'U/min',
      receivers: ['TCM', 'IC', 'ECM'],
    });
    expect(updated).not.toHaveProperty('comment');
    expect(queryTestId('edt-signal-dialog')).toBeNull();
  });

  it('applying an untouched dialog gives back an identical signal', () => {
    const onApply = setup();
    click(receiver('ABS'));
    click(receiver('ABS'));
    click(byTestId('edt-submit'));
    expect(onApply.mock.calls[0][0]).toEqual(speed);
  });

  it('checks a float against its size, and numbers as numbers', () => {
    const onApply = setup();
    choose(select('edt-signal-type'), 'float');
    type(input('edt-signal-factor'), 'x');
    type(input('edt-signal-unit'), 'in"');
    click(byTestId('edt-submit'));
    expect(onApply).not.toHaveBeenCalled();
    const dialog = text(byTestId('edt-signal-dialog'));
    expect(dialog).toContain('A float signal is 32 bits long.');
    expect(dialog).toContain('Enter a number.');
    expect(dialog).toContain('Cannot contain a double quote.');

    type(input('edt-signal-length'), '32');
    type(input('edt-signal-factor'), '1');
    type(input('edt-signal-unit'), 'in');
    click(byTestId('edt-submit'));
    expect(onApply.mock.calls[0][0]).toMatchObject({ valueType: 'float', length: 32, factor: 1, unit: 'in' });
  });

  it('refuses a comment and a float type on a second signal with the same name, which DBC cannot address', () => {
    const duplicates = parseDbc('BU_: A\nBO_ 1 M: 8 A\n SG_ S : 0|32@1+ (1,0) [0|0] "" A\n SG_ S : 32|32@1+ (1,0) [0|0] "" A\n');
    const message = duplicates.messages[0];
    const onApply = vi.fn();
    view = render(
      <I18nProvider>
        <SignalEditor db={duplicates} message={message} signal={message.signals[1]} onApply={onApply} />
      </I18nProvider>,
    );
    click(byTestId('edt-edit-signal'));
    choose(select('edt-signal-type'), 'float');
    type(byTestId<HTMLTextAreaElement>('edt-signal-comment'), 'second');
    click(byTestId('edt-submit'));
    expect(onApply).not.toHaveBeenCalled();
    const help = (field: HTMLElement) => {
      expect(field.getAttribute('aria-invalid')).toBe('true');
      return text(document.getElementById(field.getAttribute('aria-describedby')!));
    };
    const why =
      'DBC cannot attach this to the signal: an earlier message has the same ID, or an earlier signal in this message has the same name.';
    expect(help(select('edt-signal-type'))).toBe(why);
    expect(help(byTestId('edt-signal-comment'))).toBe(why);

    // A new name makes it addressable.
    type(input('edt-signal-name'), 'S2');
    click(byTestId('edt-submit'));
    expect(onApply.mock.calls[0][0]).toMatchObject({ name: 'S2', valueType: 'float', comment: 'second' });
  });

  it('speaks German', () => {
    setup('de');
    const dialog = byTestId('edt-signal-dialog');
    expect(text(dialog.querySelector('h2'))).toBe('Signal EngineSpeed bearbeiten');
    expect(text(dialog)).toContain('Empfänger');
    expect(text(dialog)).toContain('Faktor');
    type(input('edt-signal-start'), '600');
    click(byTestId('edt-submit'));
    expect(text(dialog)).toContain('Eine ganze Zahl von 0 bis 511 eingeben.');
  });
});
