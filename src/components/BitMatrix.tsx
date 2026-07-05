import { useMemo } from 'react';
import type { DbcMessage } from '../lib/dbc/types';
import { canCoexist, signalBitPositions } from '../lib/dbc/bits';

export const paletteIndex = (signalIndex: number) => signalIndex % 12;

interface CellInfo {
  signalIndexes: number[];
  isStart: boolean;
}

/**
 * Bit layout matrix: one row per data byte, columns bit 7..0.
 * Occupied cells are colored per signal, the signal's start bit gets a dot,
 * overlapping bits are striped red.
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
  const { cells, rows } = useMemo(() => {
    const cellMap = new Map<number, CellInfo>();
    let maxByte = message.dlc - 1;
    message.signals.forEach((signal, index) => {
      const positions = signalBitPositions(signal);
      positions.forEach((pos, i) => {
        if (pos < 0) return;
        maxByte = Math.max(maxByte, pos >> 3);
        const cell = cellMap.get(pos) ?? { signalIndexes: [], isStart: false };
        cell.signalIndexes.push(index);
        // The visual "start" marker sits on the DBC start bit.
        if (
          (signal.byteOrder === 'intel' && i === positions.length - 1) ||
          (signal.byteOrder === 'motorola' && i === 0)
        ) {
          cell.isStart = true;
        }
        cellMap.set(pos, cell);
      });
    });
    return { cells: cellMap, rows: Math.min(maxByte + 1, 64) };
  }, [message]);

  return (
    <div>
      <table className="bitmatrix">
        <thead>
          <tr>
            <th />
            {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => (
              <th key={bit}>{bit}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, byte) => (
            <tr key={byte}>
              <td className="byte-label">
                {byte} {byte >= message.dlc ? '⚠' : ''}
              </td>
              {[7, 6, 5, 4, 3, 2, 1, 0].map((bit) => {
                const pos = byte * 8 + bit;
                const cell = cells.get(pos);
                if (!cell) {
                  return <td key={bit} className="bit" />;
                }
                // Shared bits are a real conflict only if two of the signals
                // can occur in the same frame (mux alternatives are fine).
                const conflict = cell.signalIndexes.some((ai, k) =>
                  cell.signalIndexes
                    .slice(k + 1)
                    .some((bi) => canCoexist(message.signals[ai], message.signals[bi])),
                );
                // Prefer the selected signal's color when it occupies this cell.
                const selectedIndex = cell.signalIndexes.find(
                  (i) => message.signals[i].name === selectedSignal,
                );
                const shown = selectedIndex ?? cell.signalIndexes[0];
                const signal = message.signals[shown];
                const isSelected = selectedSignal === signal.name;
                const dimmed = selectedSignal !== undefined && selectedIndex === undefined;
                const classes = [
                  'bit',
                  'occupied',
                  conflict ? 'overlap' : `sigc-${paletteIndex(shown)}`,
                  cell.isStart ? 'start' : '',
                  dimmed ? 'dimmed' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                const names = cell.signalIndexes.map((i) => message.signals[i].name);
                return (
                  <td
                    key={bit}
                    className={classes}
                    title={
                      conflict
                        ? `CONFLICT: ${names.join(', ')}`
                        : names.length > 1
                          ? `${names.join(' | ')} (bit ${pos}, mux alternatives)`
                          : `${signal.name} (bit ${pos})`
                    }
                    onClick={() =>
                      onSelectSignal(isSelected ? undefined : signal.name)
                    }
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="matrix-legend">
        {message.signals.map((signal, index) => (
          <button
            key={signal.name + index}
            className={`legend-item ${selectedSignal === signal.name ? 'selected' : ''}`}
            onClick={() =>
              onSelectSignal(selectedSignal === signal.name ? undefined : signal.name)
            }
          >
            <span className={`color-dot dot-${paletteIndex(index)}`} />
            {signal.name}
          </button>
        ))}
      </div>
    </div>
  );
}
