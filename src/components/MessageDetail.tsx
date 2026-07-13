import { useEffect, useMemo, useState } from 'react';
import type { DbcDatabase, DbcMessage, DbcSignal } from '../lib/dbc/types';
import { decodeFrame, parseHexBytes, signalOutOfBounds, signalsConflict } from '../lib/dbc/bits';
import { declaredFrameFormat, isCanFd, isJ1939Pg, isValidFrameSize, paddedFdSize } from '../lib/dbc/canfd';
import { ADDRESS_NAMES, decomposeJ1939Id, isJ1939Database, PGN_NAMES } from '../lib/dbc/j1939';
import { useI18n } from '../lib/i18n';
import { fmtNum, hexId, muxLabel } from '../lib/format';
import { BitMatrix, paletteIndex } from './BitMatrix';
import { AttributesCard } from './AttributesCard';

export function MessageDetail({
  db,
  message,
  selectedSignal,
  onSelectSignal,
}: {
  db: DbcDatabase;
  message: DbcMessage;
  selectedSignal?: string;
  onSelectSignal: (name: string | undefined) => void;
}) {
  const { t } = useI18n();
  const selected = message.signals.find((s) => s.name === selectedSignal);

  const warnings = useMemo(() => {
    const list: string[] = [];
    for (const signal of message.signals) {
      if (signalOutOfBounds(signal, message.dlc)) {
        list.push(t('warnExceeds', { name: signal.name, n: message.dlc }));
      }
    }
    for (let i = 0; i < message.signals.length; i++) {
      for (let j = i + 1; j < message.signals.length; j++) {
        const a = message.signals[i];
        const b = message.signals[j];
        if (signalsConflict(a, b)) {
          list.push(t('warnOverlap', { a: a.name, b: b.name }));
        }
      }
    }
    return list;
  }, [message, t]);

  // Frame-size sanity notes (informational, not errors like the ones above).
  const sizeNotes = useMemo(() => {
    const notes: string[] = [];
    const declared = declaredFrameFormat(db, message);
    if (declared === 'j1939pg') return notes; // J1939 PGs legitimately exceed CAN limits
    if (declared === 'classic') {
      // Explicitly classic frames can never carry more than 8 bytes — an
      // FD padding hint would be wrong here, this is a plain contradiction.
      if (message.dlc > 8) {
        notes.push(t('noteClassicTooBig', { n: message.dlc }));
      }
      return notes;
    }
    if (message.dlc > 64) {
      notes.push(t('noteDlcExceedsFd', { n: message.dlc }));
    } else if (message.dlc > 8 && !isValidFrameSize(message.dlc)) {
      notes.push(t('noteInvalidFdSize', { n: message.dlc, p: paddedFdSize(message.dlc)! }));
    }
    return notes;
  }, [db, message, t]);

  // J1939 identifier breakdown for extended frames in J1939 contexts.
  const j1939 = useMemo(
    () =>
      message.isExtended && (isJ1939Pg(db, message) || isJ1939Database(db))
        ? decomposeJ1939Id(message.id)
        : null,
    [db, message],
  );

  const cycleTime = message.attributes.GenMsgCycleTime;
  const sendType = message.attributes.GenMsgSendType;

  const hexByte = (n: number) => '0x' + n.toString(16).toUpperCase().padStart(2, '0');

  return (
    <div>
      <div className="card">
        <div className="detail-header">
          <h1>{message.name}</h1>
          <span className="mono">{hexId(message.id, message.isExtended)}</span>
          <span className="mono muted">({message.id})</span>
          {message.isExtended && <span className="pill ext">{t('pillExtended')}</span>}
          {isCanFd(db, message) && <span className="pill fd">CAN FD</span>}
          {isJ1939Pg(db, message) && <span className="pill node">J1939 PG</span>}
        </div>
        <div className="meta-row">
          <span>
            {t('dlc')} <b>{message.dlc}</b>
          </span>
          <span>
            {t('sender')} <b>{message.sender || '—'}</b>
            {message.transmitters.length > 0 && <> +{message.transmitters.join(', ')}</>}
          </span>
          {cycleTime !== undefined && (
            <span>
              {t('cycleTime')} <b>{String(cycleTime)} ms</b>
            </span>
          )}
          {sendType !== undefined && (
            <span>
              {t('sendType')} <b>{String(sendType)}</b>
            </span>
          )}
          <span>
            {t('signalsTitle')} <b>{message.signals.length}</b>
          </span>
        </div>
        {j1939 && (
          <div className="meta-row">
            <span>
              {t('priority')} <b>{j1939.priority}</b>
            </span>
            <span>
              PGN <b className="mono">{j1939.pgn}</b>{' '}
              <span className="mono muted">
                (0x{j1939.pgn.toString(16).toUpperCase()})
              </span>
              {PGN_NAMES[j1939.pgn] && <> — <b>{PGN_NAMES[j1939.pgn]}</b></>}
            </span>
            {j1939.pduType === 'PDU1' ? (
              <span>
                {t('destination')} <b className="mono">{hexByte(j1939.destinationAddress!)}</b>
                {ADDRESS_NAMES[j1939.destinationAddress!] && (
                  <> ({ADDRESS_NAMES[j1939.destinationAddress!]})</>
                )}
              </span>
            ) : (
              <span>
                PDU2 <span className="muted">{t('broadcast')}</span>
              </span>
            )}
            <span>
              {t('source')} <b className="mono">{hexByte(j1939.sourceAddress)}</b>
              {ADDRESS_NAMES[j1939.sourceAddress] && <> ({ADDRESS_NAMES[j1939.sourceAddress]})</>}
            </span>
            {j1939.dataPage > 0 && (
              <span>
                {t('dataPage')} <b>{j1939.dataPage}</b>
              </span>
            )}
          </div>
        )}
        {warnings.map((warning) => (
          <div key={warning} className="comment-box" style={{ borderLeftColor: 'var(--danger)' }}>
            ⚠ {warning}
          </div>
        ))}
        {sizeNotes.map((note) => (
          <div key={note} className="comment-box" style={{ borderLeftColor: '#f59e0b' }}>
            ⚠ {note}
          </div>
        ))}
        {message.comment && <div className="comment-box">{message.comment}</div>}
      </div>

      <div className="card">
        <h2>{t('signalsTitle')}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid">
            <thead>
              <tr>
                <th>{t('thName')}</th>
                <th>{t('thMux')}</th>
                <th className="num">{t('thStart')}</th>
                <th className="num">{t('thLength')}</th>
                <th>{t('thByteOrder')}</th>
                <th>{t('thType')}</th>
                <th className="num">{t('thFactor')}</th>
                <th className="num">{t('thOffset')}</th>
                <th className="num">Min</th>
                <th className="num">Max</th>
                <th>{t('thUnit')}</th>
                <th>{t('thReceivers')}</th>
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
          <h2>{t('bitLayout')}</h2>
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
            <div className="card muted">{t('selectSignalHint')}</div>
          )}
          <DecodePanel message={message} />
        </div>
      </div>

      <AttributesCard title={t('messageAttributes')} attributes={message.attributes} />
    </div>
  );
}

function SignalDetails({ signal }: { signal: DbcSignal }) {
  const { t } = useI18n();
  const valueEntries = Object.entries(signal.values ?? {});
  return (
    <div className="card">
      <h2>
        Signal: <span className="mono">{signal.name}</span>
      </h2>
      <div className="meta-row">
        <span>
          {t('physicalEquals')}{' '}
          <b className="mono">
            {t('rawWord')} × {fmtNum(signal.factor)} + {fmtNum(signal.offset)}
          </b>
        </span>
        {signal.unit && (
          <span>
            {t('unitLabel')} <b>{signal.unit}</b>
          </span>
        )}
      </div>
      {signal.multiplex.extended && (
        <div className="meta-row">
          <span>
            {t('activeWhen')} <b>{signal.multiplex.extended.switchName}</b> ∈{' '}
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
          <h3 style={{ marginTop: 14 }}>{t('valueDescriptions')}</h3>
          <table className="grid">
            <thead>
              <tr>
                <th className="num">{t('thRaw')}</th>
                <th>{t('thMeaning')}</th>
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
          <h3 style={{ marginTop: 14 }}>{t('attributes')}</h3>
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
  const { t } = useI18n();
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
      <h2>{t('decodeFrame')}</h2>
      <input
        className={`decode-input ${bytes === null ? 'invalid' : ''}`}
        placeholder={
          message.dlc <= 8
            ? t('decodePlaceholderShort', {
                ex: Array.from({ length: message.dlc }, () => '00').join(' '),
              })
            : t('decodePlaceholderLong', { n: message.dlc })
        }
        value={input}
        onChange={(e) => setInput(e.target.value)}
        spellCheck={false}
      />
      {bytes === null ? (
        <div className="muted">{t('decodeInvalid')}</div>
      ) : (
        <>
          <div className="mono muted" style={{ marginBottom: 8 }}>
            [{[...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}]
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th>{t('thSignal')}</th>
                <th className="num">{t('thRaw')}</th>
                <th className="num">{t('thPhysical')}</th>
                <th>{t('thUnit')}</th>
                <th>{t('thMeaning')}</th>
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
                  <td>{active ? label ?? '' : <span className="muted">{t('muxInactive')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
