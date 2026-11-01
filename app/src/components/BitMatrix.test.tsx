// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { DbcMessage } from '../lib/dbc/types';
import { renderWithProviders } from '../test/render';
import { dbcOf, demoDb, messageNamed } from '../test/fixtures';
import { BitMatrix, signalNumber, signalTone } from './BitMatrix';

function show(message: DbcMessage, selectedSignal?: string) {
  const onSelectSignal = vi.fn();
  const view = renderWithProviders(
    <BitMatrix message={message} selectedSignal={selectedSignal} onSelectSignal={onSelectSignal} />,
  );
  return { onSelectSignal, ...view };
}

/** The cell for bit `bit` (7..0) of byte `byte`, in reading order. */
const cell = (byte: number, bit: number) => {
  const cells = document.querySelectorAll('.bitlayout .cell');
  return cells[byte * 8 + (7 - bit)] as HTMLElement;
};
const byteLabels = () => [...document.querySelectorAll('.byte-label')].map((e) => e.textContent);

describe('BitMatrix', () => {
  it('numbers and colors signals in turn', () => {
    expect([0, 1, 2, 3].map(signalTone)).toEqual([0, 1, 2, 0]);
    expect(signalNumber(0)).toBe('01');
    expect(signalNumber(11)).toBe('12');
  });

  it('draws one row per data byte, bit 7 to 0, and counts the bits in use', () => {
    show(messageNamed(demoDb(), 'EngineData'));
    expect(screen.getByRole('heading', { name: 'Bit layout' })).toBeTruthy();
    expect([...document.querySelectorAll('.bit-head')].map((e) => e.textContent)).toEqual([
      '7', '6', '5', '4', '3', '2', '1', '0',
    ]);
    expect(byteLabels()).toEqual(['00', '01', '02', '03', '04', '05', '06', '07']);
    expect(document.querySelectorAll('.bitlayout .cell')).toHaveLength(64);
    // 16 + 8 + 8 + 12 + 12 + 1 bits.
    expect(screen.getByText('57 of 64 bits used')).toBeTruthy();
  });

  it('marks each signal’s start bit with its number and joins its cells', () => {
    show(messageNamed(demoDb(), 'EngineData'));
    // EngineSpeed: Intel, start bit 0 (the LSB), 16 bits.
    const start = cell(0, 0);
    expect(start.textContent).toBe('01');
    expect(start.getAttribute('title')).toBe('EngineSpeed (bit 0)');
    expect(start.className).toContain('tone-0');
    expect(start.className).toContain('join-l');
    expect(start.className).not.toContain('join-r');
    expect(cell(0, 7).textContent).toBe('');
    expect(cell(0, 7).className).toContain('join-r');
    // EngineTemp starts at bit 16, in the second tone.
    expect(cell(2, 0).textContent).toBe('02');
    expect(cell(2, 0).className).toContain('tone-1');
    // Bits 57 to 63 are free.
    expect(cell(7, 7).className).toContain('empty');
    expect(cell(7, 7).getAttribute('title')).toBe('— (bit 63)');
  });

  it('puts a Motorola signal’s marker on its most significant bit', () => {
    show(messageNamed(demoDb(), 'BrakeData'));
    // WheelSpeedFL: Motorola, start bit 7, 16 bits: bytes 0 and 1.
    expect(cell(0, 7).textContent).toBe('01');
    expect(cell(1, 0).getAttribute('title')).toBe('WheelSpeedFL (bit 8)');
    expect(byteLabels()).toHaveLength(6);
  });

  it('selects a signal from a cell, and deselects it from a cell of the selected signal', () => {
    const message = messageNamed(demoDb(), 'EngineData');
    const { onSelectSignal, rerender } = show(message);
    fireEvent.click(cell(2, 3));
    expect(onSelectSignal).toHaveBeenLastCalledWith('EngineTemp');

    rerender(<BitMatrix message={message} selectedSignal="EngineTemp" onSelectSignal={onSelectSignal} />);
    expect(cell(2, 3).className).toContain('selected');
    expect(cell(0, 0).className).toContain('dim');
    fireEvent.click(cell(2, 3));
    expect(onSelectSignal).toHaveBeenLastCalledWith(undefined);
  });

  it('shows mux alternatives that share bits without a conflict, preferring the selected one', () => {
    const message = messageNamed(demoDb(), 'DiagData');
    const { rerender, onSelectSignal } = show(message);
    const shared = cell(1, 0);
    expect(shared.getAttribute('title')).toBe('SensorVoltage | SensorCurrent | ErrorCode (bit 8, mux alternatives)');
    expect(shared.className).not.toContain('conflict');
    // The first alternative is shown, so its start marker appears.
    expect(shared.textContent).toBe('02');

    rerender(<BitMatrix message={message} selectedSignal="ErrorCode" onSelectSignal={onSelectSignal} />);
    expect(cell(1, 0).textContent).toBe('04');
    expect(cell(1, 0).className).toContain('selected');
  });

  it('stripes bits that two coexisting signals claim', () => {
    const db = dbcOf('BU_: A\nBO_ 1 Clash: 8 A\n SG_ A : 0|8@1+ (1,0) [0|255] "" A\n SG_ B : 4|8@1+ (1,0) [0|255] "" A');
    show(db.messages[0]);
    expect(cell(0, 5).className).toContain('conflict');
    expect(cell(0, 5).getAttribute('title')).toBe('CONFLICT: A, B');
    expect(cell(0, 2).className).not.toContain('conflict');
  });

  it('flags bytes beyond the DLC that a signal reaches into', () => {
    const db = dbcOf('BU_: A\nBO_ 1 Short: 2 A\n SG_ Long : 8|16@1+ (1,0) [0|65535] "" A');
    show(db.messages[0]);
    expect(byteLabels()).toEqual(['00', '01', '02 ⚠']);
    expect(document.querySelector('.byte-label.over')?.textContent).toBe('02 ⚠');
    // Only the bits inside the data area count as used.
    expect(screen.getByText('8 of 16 bits used')).toBeTruthy();
  });

  it('collapses the unused tail of a large CAN FD frame', () => {
    const db = dbcOf('BU_: A\nBO_ 1 Fd: 64 A\n SG_ Head : 0|8@1+ (1,0) [0|255] "" A');
    show(db.messages[0]);
    expect(byteLabels()).toHaveLength(8);
    expect(screen.getByText('⋯ bytes 8–63 unused')).toBeTruthy();
    expect(document.querySelector('.bitlayout.compact')).toBeNull();
  });

  it('draws compact cells when many rows stay visible', () => {
    const db = dbcOf('BU_: A\nBO_ 1 Fd: 64 A\n SG_ Tail : 320|8@1+ (1,0) [0|255] "" A');
    show(db.messages[0]);
    expect(byteLabels()).toHaveLength(41);
    expect(document.querySelector('.bitlayout.compact')).toBeTruthy();
    expect(screen.getByText('⋯ bytes 41–63 unused')).toBeTruthy();
  });

  it('draws a 12-byte frame in full', () => {
    const db = dbcOf('BU_: A\nBO_ 1 Fd: 12 A\n SG_ Head : 0|8@1+ (1,0) [0|255] "" A');
    show(db.messages[0]);
    expect(byteLabels()).toHaveLength(12);
    expect(document.querySelector('.bitlayout-note')).toBeNull();
  });
});
