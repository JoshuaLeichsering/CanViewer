// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { DbcDatabase, DbcMessage } from '../lib/dbc/types';
import { renderWithProviders } from '../test/render';
import { dbcOf, demoDb, messageNamed } from '../test/fixtures';
import { MessageDetail } from './MessageDetail';

/** Holds the selected signal the way App does (in the URL hash there). */
function Harness({
  db,
  message,
  initialSignal,
  onCopyLink = () => {},
}: {
  db: DbcDatabase;
  message: DbcMessage;
  initialSignal?: string;
  onCopyLink?: () => void;
}) {
  const [signal, setSignal] = useState<string | undefined>(initialSignal);
  return (
    <MessageDetail
      db={db}
      fileName="demo.dbc"
      message={message}
      selectedSignal={signal}
      onSelectSignal={setSignal}
      onCopyLink={onCopyLink}
    />
  );
}

function show(name: string, initialSignal?: string, db = demoDb()) {
  return renderWithProviders(<Harness db={db} message={messageNamed(db, name)} initialSignal={initialSignal} />);
}

const fact = (label: string) =>
  [...document.querySelectorAll('.facts .fact')].find((f) => f.querySelector('.k')?.textContent === label)
    ?.querySelector('.v')?.textContent;
const signalCard = () => document.querySelector('.signal-card') as HTMLElement;
const kv = (card: HTMLElement, label: string) =>
  [...card.querySelectorAll('.kv')].find((k) => k.querySelector('.k')?.textContent === label)?.querySelector('.v')
    ?.textContent;
const payload = () => screen.getByLabelText('Hex payload') as HTMLInputElement;
const typePayload = (hex: string) => fireEvent.change(payload(), { target: { value: hex } });
const decodedRows = () =>
  [...document.querySelectorAll('.decoded-row')].map((row) =>
    [...row.querySelectorAll('span')].map((s) => s.textContent).join(' | '),
  );
const signalRows = () => [...document.querySelectorAll('.table-card tbody tr')] as HTMLElement[];
/** The signal table's row for a signal (its name follows the number chip). */
const rowOf = (name: string) => {
  const row = signalRows().find((r) => r.querySelector('.sig-name')?.lastChild?.textContent === name);
  if (!row) throw new Error(`no signal row ${name}`);
  return row;
};

describe('MessageDetail: header and facts', () => {
  it('shows the name, the id in hex and decimal, the facts and the comment', () => {
    show('EngineData');
    expect(screen.getByRole('heading', { level: 1, name: 'EngineData' })).toBeTruthy();
    expect(screen.getByText('demo.dbc · Message')).toBeTruthy();
    expect(screen.getByText(/0x100 · 256/)).toBeTruthy();
    expect(fact('DLC')).toBe('8 B');
    expect(fact('Sender')).toBe('ECM');
    expect(fact('Cycle')).toBe('10 ms');
    expect(fact('Send type')).toBe('Cyclic');
    expect(fact('Signals')).toBe('6');
    expect(screen.getByText('Engine status broadcast, 10 ms cycle.')).toBeTruthy();
    // Plain 11-bit frame: no extra chips.
    expect(screen.queryByText('Extended 29-bit')).toBeNull();
    expect(screen.queryByText('CAN FD')).toBeNull();
  });

  it('lists extra transmitters after the sender, and dashes for missing facts', () => {
    show('GearboxData');
    // BO_TX_BU_ 512 : TCM,ECM; the sender itself is not repeated.
    expect(fact('Sender')).toBe('TCM +ECM');
    // No BA_ for it: the BA_DEF_DEF_ default is not shown as if the file set it.
    expect(fact('Send type')).toBe('—');
    const db = dbcOf('BO_ 9 Bare: 8 Vector__XXX\n SG_ S : 0|8@1+ (1,0) [0|255] "" Vector__XXX');
    renderWithProviders(<Harness db={db} message={db.messages[0]} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('calls back when the link is copied', () => {
    const db = demoDb();
    const onCopyLink = vi.fn();
    renderWithProviders(<Harness db={db} message={messageNamed(db, 'EngineData')} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(onCopyLink).toHaveBeenCalledOnce();
  });

  it('shows the message attributes in their own card', () => {
    show('EngineData');
    const card = screen.getByRole('heading', { name: 'Message attributes' }).closest('.card') as HTMLElement;
    expect(within(card).getByText('GenMsgCycleTime')).toBeTruthy();
    expect(within(card).getByText('10')).toBeTruthy();
  });
});

describe('MessageDetail: J1939 and CAN FD', () => {
  it('breaks a PDU2 identifier down into priority, PGN and source', () => {
    show('J1939_EEC1');
    expect(screen.getByText('Extended 29-bit')).toBeTruthy();
    expect(screen.getByText('J1939 PG')).toBeTruthy();
    const strip = document.querySelector('.strip') as HTMLElement;
    expect(strip.textContent).toContain('Priority 3');
    expect(strip.textContent).toContain('PGN 61444');
    expect(strip.textContent).toContain('(0xF004)');
    expect(strip.textContent).toContain('PDU2 (broadcast)');
    expect(strip.textContent).toContain('Source 0x00');
  });

  it('names the destination of a PDU1 identifier', () => {
    show('J1939_TSC1');
    const strip = document.querySelector('.strip') as HTMLElement;
    expect(strip.textContent).toContain('PGN 0');
    expect(strip.textContent).toContain('PDU1 · Destination 0x00');
    expect(strip.textContent).toContain('Source 0x03');
  });

  it('shows the data page when it is set', () => {
    // 0x19FEF121: priority 6, data page 1, PF 0xFE, PS 0xF1 (PDU2), source 0x21.
    const db = dbcOf(
      'BU_: A\nBO_ 2583621921 DataPage: 8 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\n' +
        'BA_DEF_ BO_ "VFrameFormat" ENUM "StandardCAN","ExtendedCAN","reserved","J1939PG";\n' +
        'BA_ "VFrameFormat" BO_ 2583621921 3;',
    );
    renderWithProviders(<Harness db={db} message={db.messages[0]} />);
    const strip = document.querySelector('.strip') as HTMLElement;
    expect(strip.textContent).toContain('PGN 130801');
    expect(strip.textContent).toContain('Source 0x21');
    expect(strip.textContent).toContain('Data page 1');
  });

  it('marks a CAN FD frame and asks for up to its full length in the decoder', () => {
    show('AdasObjects');
    expect(screen.getByText('CAN FD')).toBeTruthy();
    expect(payload().placeholder).toBe('00 00 00 00 00 00 00 00 …');
    expect(screen.getByText('Hex data, up to 24 bytes — missing bytes are zero-padded')).toBeTruthy();
  });
});

describe('MessageDetail: signal table and signal card', () => {
  it('lists every signal with its layout and scaling', () => {
    show('EngineData');
    const rows = signalRows().filter((r) => r.classList.contains('clickable'));
    expect(rows).toHaveLength(6);
    const cells = [...rows[4].querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual([
      '05TorqueRequest',
      '',
      '44',
      '12',
      'Intel',
      'signed',
      '0.5',
      '0',
      '-1024',
      '1023.5',
      'Nm',
      'TCM',
    ]);
    expect(screen.getByText('Select a signal in the table or bit layout to see its details.')).toBeTruthy();
  });

  it('selects a signal from the table, shows its card, and deselects it on a second click', () => {
    show('EngineData');
    const row = rowOf('EngineSpeed');
    fireEvent.click(row);
    expect(row.className).toContain('selected');
    const card = signalCard();
    expect(within(card).getByText('Signal 01')).toBeTruthy();
    expect(kv(card, 'Physical')).toBe('raw × 0.25 + 0');
    expect(kv(card, 'Range')).toBe('0 … 16383.75 rpm');
    expect(kv(card, 'Bits')).toBe('0 · 16 · Intel');
    expect(kv(card, 'Receivers')).toBe('TCM, ABS, IC');
    expect(kv(card, 'Type')).toBe('unsigned');
    expect(within(card).getByText('Crankshaft rotational speed.')).toBeTruthy();
    const attributes = within(card).getByLabelText('Attributes');
    expect(attributes.textContent).toBe('GenSigStartValue0');

    fireEvent.click(row);
    expect(document.querySelector('.signal-card')).toBeNull();
    expect(screen.getByText('Select a signal in the table or bit layout to see its details.')).toBeTruthy();
  });

  it('hides the placeholder receiver Vector__XXX in the card', () => {
    show('J1939_EEC1', 'EngineSpeedJ1939');
    expect(kv(signalCard(), 'Receivers')).toBe('—');
  });

  it('shows Motorola byte order', () => {
    show('BrakeData', 'WheelSpeedFL');
    expect(kv(signalCard(), 'Bits')).toBe('7 · 16 · Motorola');
  });

  it('describes simple and extended multiplexing', () => {
    show('DiagData', 'MuxSelector');
    expect(kv(signalCard(), 'Multiplexing')).toBe('Multiplexor');
    const mux = signalRows()
      .filter((r) => r.classList.contains('clickable'))
      .map((r) => r.querySelectorAll('td')[1].textContent);
    expect(mux).toEqual(['M', 'm0', 'm1', 'm2']);

    fireEvent.click(rowOf('SensorVoltage'));
    expect(kv(signalCard(), 'Active when')).toBe('MuxSelector = 0');
    fireEvent.click(rowOf('ErrorCode'));
    expect(kv(signalCard(), 'Active when')).toBe('MuxSelector ∈ 2');
  });

  it('describes a sub-multiplexor and value ranges', () => {
    const db = dbcOf(
      'BU_: A\nBO_ 100 Nested: 8 A\n' +
        ' SG_ Root M : 0|8@1+ (1,0) [0|255] "" A\n' +
        ' SG_ Sub m1M : 8|8@1+ (1,0) [0|255] "" A\n' +
        ' SG_ Leaf m2 : 16|8@1+ (1,0) [0|255] "" A\n' +
        ' SG_ Plain m3 : 24|8@1+ (1,0) [0|255] "" A\n' +
        'SG_MUL_VAL_ 100 Leaf Sub 2-2, 4-6;\nSG_MUL_VAL_ 100 Sub Root 1-1;',
    );
    renderWithProviders(<Harness db={db} message={db.messages[0]} initialSignal="Sub" />);
    expect(kv(signalCard(), 'Active when')).toBe('Multiplexor, active when Root ∈ 1');
    fireEvent.click(rowOf('Leaf'));
    expect(kv(signalCard(), 'Active when')).toBe('Sub ∈ 2, 4–6');
    fireEvent.click(rowOf('Plain'));
    expect(kv(signalCard(), 'Active when')).toBe('Root = 3');
  });

  it('lists value descriptions and marks the decoded one', () => {
    show('EngineData', 'EngineRunning');
    const chips = within(signalCard()).getByLabelText('Value descriptions');
    expect([...chips.children].map((c) => c.textContent)).toEqual(['0 · Stopped', '1 · Running']);
    // An empty payload decodes as all zeros.
    expect(chips.querySelector('.current')?.textContent).toBe('0 · Stopped');
    typePayload('00 00 00 00 00 00 00 01');
    expect(chips.querySelector('.current')?.textContent).toBe('1 · Running');
  });
});

describe('MessageDetail: decoder', () => {
  it('decodes a full frame into physical values with units and labels', () => {
    show('EngineData');
    typePayload('00 10 28 FA 00 00 00 01');
    expect(decodedRows()).toEqual([
      'EngineSpeed | 1024 rpm | ',
      'EngineTemp | 0 degC | ',
      'ThrottlePosition | 100 % | ',
      'EngineTorque | 0 Nm | ',
      'TorqueRequest | 0 Nm | ',
      'EngineRunning | 1 | Running',
    ]);
    expect(document.querySelector('.decoded-row')!.getAttribute('title')).toBe('Raw 4096');
    // A full frame: no echo of the bytes.
    expect(document.querySelector('.field-help')).toBeNull();
  });

  it('accepts 0x prefixes and separators, zero-pads short input and shows what it decodes', () => {
    show('EngineData');
    typePayload('0x00,0x10');
    expect(screen.getByText('[00 10 00 00 00 00 00 00]')).toBeTruthy();
    expect(decodedRows()[0]).toBe('EngineSpeed | 1024 rpm | ');
  });

  it('cuts input longer than the DLC', () => {
    show('BrakeData');
    typePayload('01 02 03 04 05 06 07 08');
    expect(screen.getByText('[01 02 03 04 05 06]')).toBeTruthy();
  });

  it('rejects incomplete bytes and non-hex input', () => {
    show('EngineData');
    typePayload('0x1');
    expect(screen.getByText('Enter full bytes as hex (e.g. “12 AB 00” or “0x12AB”).')).toBeTruthy();
    expect(payload().closest('label')!.className).toContain('invalid');
    expect(document.querySelector('.decoded')).toBeNull();
    typePayload('zz');
    expect(screen.getByText(/Enter full bytes as hex/)).toBeTruthy();
  });

  it('marks multiplexed signals whose switch does not match as inactive', () => {
    show('DiagData');
    typePayload('01 E8 03');
    expect(decodedRows()).toEqual([
      'MuxSelector | 1 | ',
      'SensorVoltage | — | mux inactive',
      'SensorCurrent | 10 A | ',
      'ErrorCode | — | mux inactive',
    ]);
    expect(document.querySelectorAll('.decoded-row.inactive')).toHaveLength(2);
  });

  it('selects a signal from a decoded row', () => {
    show('EngineData');
    typePayload('00');
    const row = [...document.querySelectorAll('.decoded-row')].find((r) => r.textContent?.startsWith('EngineTemp'))!;
    fireEvent.click(row);
    expect(within(signalCard()).getByText('Signal 02')).toBeTruthy();
    expect(row.className).toContain('selected');
  });

  it('clears the input with its button and when another message is shown', () => {
    const db = demoDb();
    const view = renderWithProviders(<Harness db={db} message={messageNamed(db, 'EngineData')} />);
    typePayload('00 10');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(payload().value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();

    typePayload('00 10');
    view.rerender(<Harness db={db} message={messageNamed(db, 'GearboxData')} />);
    expect(payload().value).toBe('');
  });
});

describe('MessageDetail: layout warnings and frame size notes', () => {
  it('reports signals beyond the data area and overlapping signals', () => {
    const db = dbcOf(
      'BU_: A\nBO_ 1 Broken: 2 A\n SG_ A : 0|8@1+ (1,0) [0|255] "" A\n SG_ B : 4|16@1+ (1,0) [0|255] "" A',
    );
    renderWithProviders(<Harness db={db} message={db.messages[0]} />);
    expect(screen.getByText('Signal “B” exceeds the 2-byte data area.')).toBeTruthy();
    expect(screen.getByText('Signals “A” and “B” overlap.')).toBeTruthy();
    expect(document.querySelectorAll('.banner.error')).toHaveLength(2);
  });

  it('does not report mux alternatives that share bits', () => {
    show('DiagData');
    expect(document.querySelector('.banner-stack')).toBeNull();
  });

  it.each([
    [10, '', '10 bytes is not a valid CAN FD frame size — on the wire the frame will be padded to 12 bytes.'],
    [70, '', 'DLC 70 exceeds the 64-byte CAN FD maximum.'],
    [
      12,
      'BA_ "VFrameFormat" BO_ 1 0;',
      'VFrameFormat declares this message classic CAN, but DLC 12 exceeds the classic 8-byte maximum.',
    ],
  ])('notes an odd frame size (DLC %i)', (dlc, attribute, note) => {
    const db = dbcOf(
      `BU_: A\nBO_ 1 Sized: ${dlc} A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\n` +
        'BA_DEF_ BO_ "VFrameFormat" ENUM "StandardCAN","ExtendedCAN","reserved","J1939PG";\n' +
        attribute,
    );
    renderWithProviders(<Harness db={db} message={db.messages[0]} />);
    expect(screen.getByText(note)).toBeTruthy();
    expect(document.querySelector('.banner.warn')).toBeTruthy();
  });

  it('accepts any size for a J1939 parameter group and a valid size for a classic frame', () => {
    const db = dbcOf(
      'BU_: A\nBO_ 2364539904 Big: 100 A\n SG_ S : 0|8@1+ (1,0) [0|255] "" A\n' +
        'BO_ 2 Classic: 8 A\n SG_ T : 0|8@1+ (1,0) [0|255] "" A\n' +
        'BA_DEF_ BO_ "VFrameFormat" ENUM "StandardCAN","ExtendedCAN","reserved","J1939PG";\n' +
        'BA_ "VFrameFormat" BO_ 2364539904 3;\nBA_ "VFrameFormat" BO_ 2 0;',
    );
    const view = renderWithProviders(<Harness db={db} message={messageNamed(db, 'Big')} />);
    expect(document.querySelector('.banner-stack')).toBeNull();
    view.rerender(<Harness db={db} message={messageNamed(db, 'Classic')} />);
    expect(document.querySelector('.banner-stack')).toBeNull();
  });
});
