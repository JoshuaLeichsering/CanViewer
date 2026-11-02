// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment jsdom
// The encoder card on its own: physical values in, the frame out, and
// its ways to the decode card and the clipboard. The property and corpus tests
// in app/src/lib/dbc pin the encoding itself; e2e/trc-traces-encoder.mjs drives
// the card in the message view.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { decodeFrame, parseHexBytes } from '../lib/dbc/bits';
import type { DbcMessage } from '../lib/dbc/types';
import { renderWithProviders } from '../test/render';
import { demoDb, messageNamed } from '../test/fixtures';
import { EncodeCard } from './EncodeCard';

afterEach(() => {
  vi.unstubAllGlobals();
});

function show(message: DbcMessage, decoder: { bytes: Uint8Array | null; hasInput: boolean } = { bytes: null, hasInput: false }) {
  const onDecode = vi.fn();
  const onSelectSignal = vi.fn();
  const view = renderWithProviders(
    <EncodeCard
      message={message}
      decoderBytes={decoder.bytes}
      decoderHasInput={decoder.hasInput}
      onDecode={onDecode}
      onSelectSignal={onSelectSignal}
    />,
  );
  return { onDecode, onSelectSignal, view };
}

const field = (name: RegExp) => screen.getByRole('textbox', { name });
const enter = (name: RegExp, value: string) => fireEvent.change(field(name), { target: { value } });
const hex = () => screen.getByTestId('trc-enc-hex').textContent!;
const note = (signal: string) => document.querySelector(`[data-signal="${signal}"] .trc-enc-note`)!;
/** What the decoder reads from the encoded frame. */
const decoded = (message: DbcMessage) =>
  Object.fromEntries(decodeFrame(message.signals, parseHexBytes(hex(), message.dlc)!).map((d) => [d.signal.name, d.physical]));

describe('EncodeCard', () => {
  it('starts from a frame of zeros, and encodes the values entered so that the decoder reads them back', () => {
    const engine = messageNamed(demoDb(), 'EngineData');
    const { onSelectSignal } = show(engine);
    expect(hex()).toBe('00 00 00 00 00 00 00 00');
    expect(screen.getByText(/Bits without a value are 0\./)).toBeTruthy();

    fireEvent.focus(field(/^EngineSpeed/));
    expect(onSelectSignal).toHaveBeenCalledWith('EngineSpeed');
    enter(/^EngineSpeed/, '2000');
    enter(/^EngineTemp/, '90');
    enter(/^TorqueRequest/, '-12.5');
    expect(decoded(engine)).toMatchObject({ EngineSpeed: 2000, EngineTemp: 90, TorqueRequest: -12.5 });
    expect(note('EngineSpeed').textContent).toBe('raw 8000');
  });

  it('marks what the frame cannot hold as entered', () => {
    show(messageNamed(demoDb(), 'EngineData'));
    enter(/^EngineSpeed/, 'fast');
    expect(note('EngineSpeed').textContent).toBe('Not a number');
    expect(field(/^EngineSpeed/).getAttribute('aria-invalid')).toBe('true');
    enter(/^EngineTemp/, '1000');
    expect(note('EngineTemp').textContent).toMatch(/^Out of range: /);
    // A value between two steps of the scaling encodes as the nearest one.
    enter(/^ThrottlePosition/, '50.1');
    expect(note('ThrottlePosition').textContent).toMatch(/^encodes as 50/);
  });

  it('enters a value from its value description', () => {
    const gearbox = messageNamed(demoDb(), 'GearboxData');
    show(gearbox);
    const choice = screen.getByRole('combobox', { name: 'Value description for GearPosition' });
    fireEvent.change(choice, { target: { value: '3' } });
    expect((field(/^GearPosition/) as HTMLInputElement).value).toBe('3');
    expect(decoded(gearbox).GearPosition).toBe(3);
  });

  it('switches a multiplexed signal off unless the multiplexor selects it', () => {
    const diag = messageNamed(demoDb(), 'DiagData');
    show(diag);
    enter(/^MuxSelector/, '1');
    expect(document.querySelector('[data-signal="SensorVoltage"]')!.className).toContain('inactive');
    expect(document.querySelector('[data-signal="SensorCurrent"]')!.className).not.toContain('inactive');
  });

  it('hands the frame to the decoder, starts from the decoder’s frame, and resets', () => {
    const engine = messageNamed(demoDb(), 'EngineData');
    const { onDecode } = show(engine, { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), hasInput: true });
    enter(/^EngineSpeed/, '2000');
    fireEvent.click(screen.getByRole('button', { name: /^Decode$/ }));
    expect(onDecode).toHaveBeenCalledWith(hex());

    fireEvent.click(screen.getByRole('button', { name: /From decoder/ }));
    expect(hex()).toBe('01 02 03 04 05 06 07 08');
    expect(screen.getByText(/Bits without a value come from the decoder’s frame\./)).toBeTruthy();
    expect((field(/^EngineSpeed/) as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(hex()).toBe('00 00 00 00 00 00 00 00');
  });

  it('cannot start from the decoder while the decoder holds no valid frame', () => {
    show(messageNamed(demoDb(), 'EngineData'), { bytes: null, hasInput: true });
    expect((screen.getByRole('button', { name: /From decoder/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('copies the frame, and says so when the clipboard refuses', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    show(messageNamed(demoDb(), 'EngineData'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    });
    expect(writeText).toHaveBeenCalledWith('00 00 00 00 00 00 00 00');
    expect(screen.getByRole('button', { name: /Copied/ })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copied/ }));
    });
    expect(screen.getByRole('button', { name: /Could not copy/ })).toBeTruthy();
  });

  it('starts afresh for another message', () => {
    const db = demoDb();
    const { view } = show(messageNamed(db, 'EngineData'));
    enter(/^EngineSpeed/, '2000');
    view.rerender(
      <EncodeCard
        message={messageNamed(db, 'GearboxData')}
        decoderBytes={null}
        decoderHasInput={false}
        onDecode={() => {}}
        onSelectSignal={() => {}}
      />,
    );
    expect(hex()).toBe('00 00 00 00 00 00 00 00');
    expect(screen.queryByRole('textbox', { name: /^EngineSpeed/ })).toBeNull();
  });
});
