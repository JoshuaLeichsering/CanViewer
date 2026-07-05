import { useEffect, useMemo, useState } from 'react';
import type { DbcMessage, DbcSignal } from '../lib/dbc/types';
import { decodeFrame, parseHexBytes, signalOutOfBounds, signalsConflict } from '../lib/dbc/bits';
import { fmtNum, hexId, muxLabel } from '../lib/format';
import { BitMatrix, paletteIndex } from './BitMatrix';
import { AttributesCard } from './AttributesCard';

export function MessageDetail({
  message,
  selectedSignal,
  onSelectSignal,
}: {
  message: DbcMessage;
  selectedSignal?: string;
  onSelectSignal: (name: string | undefined) => void;
}) {
  const selected = message.signals.find((s) => s.name === selectedSignal);

  const warnings = useMemo(() => {
    const list: string[] = [];
    for (const signal of message.signals) {
      if (signalOutOfBounds(signal, message.dlc)) {
        list.push(`Signal “${signal.name}” exceeds the ${message.dlc}-byte data area.`);
      }
    }
    for (let i = 0; i < message.signals.length; i++) {
      for (let j = i + 1; j < message.signals.length; j++) {
        const a = message.signals[i];
        const b = message.signals[j];
        if (signalsConflict(a, b)) {
          list.push(`Signals “${a.name}” and “${b.name}” overlap.`);
        }
      }
    }
    return list;
  }, [message]);

  const cycleTime = message.attributes.GenMsgCycleTime;
  const sendType = message.attributes.GenMsgSendType;

  return (
    <div>
      <div className="card">
        <div className="detail-header">
          <h1>{message.name}</h1>
          <span className="mono">{hexId(message.id, message.isExtended)}</span>
          <span className="mono muted">({message.id})</span>
          {message.isExtended && <span className="pill ext">Extended 29-bit</span>}
        </div>
        <div className="meta-row">
          <span>
            DLC <b>{message.dlc}</b>
          </span>
          <span>
            Sender <b>{message.sender || '—'}</b>
            {message.transmitters.length > 0 && <> +{message.transmitters.join(', ')}</>}
          </span>
          {cycleTime !== undefined && (
            <span>
              Cycle time <b>{String(cycleTime)} ms</b>
            </span>
          )}
          {sendType !== undefined && (
            <span>
              Send type <b>{String(sendType)}</b>
            </span>
          )}
          <span>
            Signals <b>{message.signals.length}</b>
          </span>
        </div>
        {warnings.map((warning) => (
          <div key={warning} className="comment-box" style={{ borderLeftColor: 'var(--danger)' }}>
            ⚠ {warning}
          </div>
        ))}
        {message.comment && <div className="comment-box">{message.comment}</div>}
      </div>

      <div className="card">
        <h2>Signals</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mux</th>
                <th className="num">Start</th>
                <th className="num">Length</th>
                <th>Byte order</th>
                <th>Type</th>
                <th className="num">Factor</th>
                <th className="num">Offset</th>
                <th className="num">Min</th>
                <th className="num">Max</th>
                <th>Unit</th>
                <th>Receivers</th>
              </tr>
            </thead>
            <tbody>
              {message.signals.map((signal, index) => (
                <tr
                  key={signal.name + index}
                  className={`clickable ${selectedSignal === signal.name ? 'selected' : ''}`}
                  onClick={() =>
                    onSelectSignal(selectedSignal === signal.name ? undefined : signal.name)
                  }
                >
                  <td>
                    <span className="sig-name">
                      <span className={`color-dot dot-${paletteIndex(index)}`} />
                      {signal.name}
                    </span>
                  </td>
                  <td>
                    {signal.multiplex.role !== 'none' && (
                      <span className="pill mux">{muxLabel(signal.multiplex)}</span>
                    )}
                  </td>
                  <td className="num">{signal.startBit}</td>
                  <td className="num">{signal.length}</td>
                  <td>{signal.byteOrder === 'intel' ? 'Intel' : 'Motorola'}</td>
                  <td>{signal.valueType}</td>
                  <td className="num">{fmtNum(signal.factor)}</td>
                  <td className="num">{fmtNum(signal.offset)}</td>
                  <td className="num">{fmtNum(signal.min)}</td>
                  <td className="num">{fmtNum(signal.max)}</td>
                  <td>{signal.unit}</td>
                  <td className="muted">{signal.receivers.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2>Bit layout</h2>
          <BitMatrix
            message={message}
            selectedSignal={selectedSignal}
            onSelectSignal={onSelectSignal}
          />
        </div>
        <div>
          {selected ? (
            <SignalDetails signal={selected} />
          ) : (
            <div className="card muted">
              Select a signal in the table or bit matrix to see its details.
            </div>
          )}
          <DecodePanel message={message} />
        </div>
      </div>

      <AttributesCard title="Message attributes" attributes={message.attributes} />
    </div>
  );
}

function SignalDetails({ signal }: { signal: DbcSignal }) {
  const valueEntries = Object.entries(signal.values ?? {});
  return (
    <div className="card">
      <h2>
        Signal: <span className="mono">{signal.name}</span>
      </h2>
      <div className="meta-row">
        <span>
          Physical ={' '}
          <b className="mono">
            raw × {fmtNum(signal.factor)} + {fmtNum(signal.offset)}
          </b>
        </span>
        {signal.unit && (
          <span>
            Unit <b>{signal.unit}</b>
          </span>
        )}
      </div>
      {signal.multiplex.extended && (
        <div className="meta-row">
          <span>
            Active when <b>{signal.multiplex.extended.switchName}</b> ∈{' '}
            <b className="mono">
              {signal.multiplex.extended.ranges
                .map(([lo, hi]) => (lo === hi ? String(lo) : `${lo}–${hi}`))
                .join(', ')}
            </b>
          </span>
        </div>
      )}
      {signal.comment && <div className="comment-box">{signal.comment}</div>}

      {valueEntries.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Value descriptions</h3>
          <table className="grid">
            <thead>
              <tr>
                <th className="num">Raw</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {valueEntries
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([raw, label]) => (
                  <tr key={raw}>
                    <td className="num" style={{ width: 70 }}>
                      {raw}
                    </td>
                    <td>{label}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {Object.keys(signal.attributes).length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Attributes</h3>
          <table className="grid">
            <tbody>
              {Object.entries(signal.attributes).map(([name, value]) => (
                <tr key={name}>
                  <td style={{ width: '50%' }}>{name}</td>
                  <td className="mono">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function DecodePanel({ message }: { message: DbcMessage }) {
  const [input, setInput] = useState('');
  // Clear the entered bytes when switching messages — stale bytes would
  // silently decode misleading values for the newly selected message.
  useEffect(() => setInput(''), [message]);
  const bytes = useMemo(() => parseHexBytes(input, message.dlc), [input, message.dlc]);
  const decoded = useMemo(
    () => (bytes ? decodeFrame(message.signals, bytes) : []),
    [bytes, message],
  );

  return (
    <div className="card">
      <h2>Decode frame</h2>
      <input
        className={`decode-input ${bytes === null ? 'invalid' : ''}`}
        placeholder={`Hex data, e.g. ${Array.from({ length: message.dlc }, () => '00').join(' ')}`}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        spellCheck={false}
      />
      {bytes === null ? (
        <div className="muted">Enter full bytes as hex (e.g. “12 AB 00” or “0x12AB”).</div>
      ) : (
        <>
          <div className="mono muted" style={{ marginBottom: 8 }}>
            [{[...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}]
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>Signal</th>
                <th className="num">Raw</th>
                <th className="num">Physical</th>
                <th>Unit</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {decoded.map(({ signal, raw, physical, label, active }, i) => (
                <tr key={`${signal.name}#${i}`} className={active ? '' : 'inactive'}>
                  <td>{signal.name}</td>
                  <td className="num">{fmtNum(raw)}</td>
                  <td className="num">
                    <b>{fmtNum(physical)}</b>
                  </td>
                  <td>{signal.unit}</td>
                  <td>{active ? label ?? '' : <span className="muted">mux inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
