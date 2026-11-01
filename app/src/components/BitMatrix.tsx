import { useMemo } from 'react';
import type { DbcMessage } from '../lib/dbc/types';
import { canCoexist, signalBitPositions } from '../lib/dbc/bits';
import { useI18n } from '../lib/i18n';

/** Signals cycle through three tonal colors; their number tells them apart. */
export const signalTone = (signalIndex: number) => signalIndex % 3;
export const signalNumber = (signalIndex: number) => String(signalIndex + 1).padStart(2, '0');

interface CellInfo {
  signalIndexes: number[];
  /** Signals whose DBC start bit is this cell. */
  startOf: number[];
}

const BITS = [7, 6, 5, 4, 3, 2, 1, 0];

/**
 * Bit layout, one row per data byte, bit 7 to 0. Each signal's bits share one
 * tonal block (joined across neighbouring cells), its start bit carries the
 * signal's number, bits that two coexisting signals claim are striped in the
 * error color. Mux alternatives may share bits without a conflict.
 */
export function BitMatrix({
  message,
  selectedSignal,
  onSelectSignal,
}: {
  message: DbcMessage;
  selectedSignal?: string;
  onSelectSignal: (name: string | undefined) => void;
}) {
  const { t } = useI18n();
  const { cells, visibleRows, collapsedRows, usedBits } = useMemo(() => {
    const cellMap = new Map<number, CellInfo>();
    let maxByte = message.dlc - 1;
    let lastOccupied = -1;
    message.signals.forEach((signal, index) => {
      const positions = signalBitPositions(signal);
      positions.forEach((pos, i) => {
        if (pos < 0) return;
        maxByte = Math.max(maxByte, pos >> 3);
        lastOccupied = Math.max(lastOccupied, pos >> 3);
        const cell = cellMap.get(pos) ?? { signalIndexes: [], startOf: [] };
        cell.signalIndexes.push(index);
        // The start marker sits on the DBC start bit.
        if (
          (signal.byteOrder === 'intel' && i === positions.length - 1) ||
          (signal.byteOrder === 'motorola' && i === 0)
        ) {
          cell.startOf.push(index);
        }
        cellMap.set(pos, cell);
      });
    });
    // Large CAN FD frames: collapse the unused tail bytes instead of drawing
    // dozens of empty rows (classic 8-byte messages always render in full).
    const totalRows = Math.min(maxByte + 1, 64);
    const visible = totalRows > 20 ? Math.min(totalRows, Math.max(lastOccupied + 1, 8)) : totalRows;
    const used = [...cellMap.keys()].filter((p) => p < message.dlc * 8).length;
    return { cells: cellMap, visibleRows: visible, collapsedRows: totalRows - visible, usedBits: used };
  }, [message]);

  /** The signal a cell shows: the selected one if it is there, else the first. */
  const shownAt = (pos: number): number => {
    const cell = cells.get(pos);
    if (!cell) return -1;
    return cell.signalIndexes.find((i) => message.signals[i].name === selectedSignal) ?? cell.signalIndexes[0];
  };

  return (
    <div className="card bitlayout-card">
      <div className="bitlayout-head">
        <h2>{t('bitLayout')}</h2>
        <span className="muted">{t('bitsUsed', { used: usedBits, total: message.dlc * 8 })}</span>
      </div>
      <div className={`bitlayout ${visibleRows > 24 ? 'compact' : ''}`}>
        <span />
        {BITS.map((bit) => (
          <span key={bit} className="bit-head">
            {bit}
          </span>
        ))}
        {Array.from({ length: visibleRows }, (_, byte) => [
          <span key={`l${byte}`} className={`byte-label ${byte >= message.dlc ? 'over' : ''}`}>
            {String(byte).padStart(2, '0')}
            {byte >= message.dlc ? ' ⚠' : ''}
          </span>,
          ...BITS.map((bit) => {
            const pos = byte * 8 + bit;
            const cell = cells.get(pos);
            if (!cell) {
              return (
                <div key={pos} className="cell empty" title={t('bitTooltip', { name: '—', pos })}>
                  <div className="cell-inner" />
                </div>
              );
            }
            // Shared bits are a real conflict only if two of the signals can
            // occur in the same frame (mux alternatives are fine).
            const conflict = cell.signalIndexes.some((ai, k) =>
              cell.signalIndexes.slice(k + 1).some((bi) => canCoexist(message.signals[ai], message.signals[bi])),
            );
            const shown = shownAt(pos);
            const signal = message.signals[shown];
            const isSelected = selectedSignal === signal.name;
            const dimmed = selectedSignal !== undefined && !isSelected;
            const joinL = bit < 7 && shownAt(pos + 1) === shown;
            const joinR = bit > 0 && shownAt(pos - 1) === shown;
            const names = cell.signalIndexes.map((i) => message.signals[i].name);
            const classes = [
              'cell',
              'used',
              conflict ? 'conflict' : isSelected ? 'selected' : `tone-${signalTone(shown)}`,
              dimmed ? 'dim' : '',
              joinL ? 'join-l' : '',
              joinR ? 'join-r' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={pos}
                className={classes}
                title={
                  conflict
                    ? t('conflictTooltip', { names: names.join(', ') })
                    : names.length > 1
                      ? t('muxAltTooltip', { names: names.join(' | '), pos })
                      : t('bitTooltip', { name: signal.name, pos })
                }
                onClick={() => onSelectSignal(isSelected ? undefined : signal.name)}
              >
                <div className="cell-inner">{cell.startOf.includes(shown) ? signalNumber(shown) : ''}</div>
              </div>
            );
          }),
        ])}
      </div>
      {collapsedRows > 0 && (
        <div className="bitlayout-note">
          {t('bytesUnused', { from: visibleRows, to: visibleRows + collapsedRows - 1 })}
        </div>
      )}
    </div>
  );
}
