// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useMemo, useState } from 'react';
import type { DbcDatabase, DbcMessage, DbcSignal } from '../lib/dbc/types';
import { decodeFrame, parseHexBytes, signalOutOfBounds, signalsConflict, type DecodedSignal } from '../lib/dbc/bits';
import { declaredFrameFormat, isCanFd, isJ1939Pg, isValidFrameSize, paddedFdSize } from '../lib/dbc/canfd';
import { ADDRESS_NAMES, decomposeJ1939Id, isJ1939Database, PGN_NAMES } from '../lib/dbc/j1939';
import { useI18n } from '../lib/i18n';
import { fmtNum, hexId } from '../lib/format';
import { BitMatrix, signalNumber } from './BitMatrix';
import { AttributesCard } from './AttributesCard';
import { SignalTable } from './SignalTable';
import { EncodeCard } from './EncodeCard';
import { Icon } from './Icon';
import { CopyCodeMenu } from './ExportMenu';

const hexByte = (n: number) => '0x' + n.toString(16).toUpperCase().padStart(2, '0');

export function MessageDetail({
  db,
  fileName,
  message,
  selectedSignal,
  onSelectSignal,
  onCopyLink,
}: {
  db: DbcDatabase;
  fileName: string;
  message: DbcMessage;
  selectedSignal?: string;
  onSelectSignal: (name: string | undefined) => void;
  onCopyLink: () => void;
}) {
  const { t } = useI18n();
  const selectedIndex = message.signals.findIndex((s) => s.name === selectedSignal);

  // Decoder input lives here so the signal card can mark the decoded value.
  // Cleared on switching messages: stale bytes would decode misleading values.
  const [hexInput, setHexInput] = useState('');
  useEffect(() => setHexInput(''), [message]);
  const bytes = useMemo(() => parseHexBytes(hexInput, message.dlc), [hexInput, message.dlc]);
  const decoded = useMemo(() => (bytes ? decodeFrame(message.signals, bytes) : null), [bytes, message]);

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
        if (signalsConflict(a, b)) list.push(t('warnOverlap', { a: a.name, b: b.name }));
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
      if (message.dlc > 8) notes.push(t('noteClassicTooBig', { n: message.dlc }));
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
      message.isExtended && (isJ1939Pg(db, message) || isJ1939Database(db)) ? decomposeJ1939Id(message.id) : null,
    [db, message],
  );

  const cycleTime = message.attributes.GenMsgCycleTime;
  const sendType = message.attributes.GenMsgSendType;
  const facts: Array<[string, string]> = [
    [t('dlc'), t('factDlcValue', { n: message.dlc })],
    [
      t('sender'),
      (message.sender || '—') + (message.transmitters.length > 0 ? ` +${message.transmitters.join(', ')}` : ''),
    ],
    [t('factCycle'), cycleTime !== undefined ? `${String(cycleTime)} ms` : '—'],
    [t('sendType'), sendType !== undefined ? String(sendType) : '—'],
    [t('signalsTitle'), String(message.signals.length)],
  ];

  const toggle = (name: string) => onSelectSignal(selectedSignal === name ? undefined : name);

  return (
    <div>
      <header className="page-header split">
        <div style={{ minWidth: 0 }}>
          <div className="overline">{t('messageOverline', { file: fileName })}</div>
          <h1>{message.name}</h1>
          <div className="assist-chips">
            <span className="assist-chip mono">
              <Icon name="tag" size={18} />
              {hexId(message.id, message.isExtended)} · {message.id}
            </span>
            {message.isExtended && <span className="assist-chip">{t('pillExtended')}</span>}
            {isCanFd(db, message) && <span className="assist-chip">CAN FD</span>}
            {isJ1939Pg(db, message) && <span className="assist-chip">J1939 PG</span>}
          </div>
        </div>
        <CopyCodeMenu db={db} message={message} fileName={fileName} />
        <button className="btn outlined with-icon state" onClick={onCopyLink}>
          <Icon name="link" size={18} />
          {t('copyLink')}
        </button>
      </header>

      <div className="facts">
        {facts.map(([k, v]) => (
          <div className="fact" key={k}>
            <div className="k">{k}</div>
            <div className="v" title={v}>
              {v}
            </div>
          </div>
        ))}
      </div>

      {j1939 && (
        <div className="strip">
          <span className="strip-label">J1939</span>
          <span>
            {t('priority')} <b>{j1939.priority}</b>
          </span>
          <span>
            PGN <b>{j1939.pgn}</b>{' '}
            <span className="muted mono">(0x{j1939.pgn.toString(16).toUpperCase()})</span>
            {PGN_NAMES[j1939.pgn] && <> {PGN_NAMES[j1939.pgn]}</>}
          </span>
          {j1939.pduType === 'PDU1' ? (
            <span>
              PDU1 · {t('destination')} <b>{hexByte(j1939.destinationAddress!)}</b>
              {ADDRESS_NAMES[j1939.destinationAddress!] && <> {ADDRESS_NAMES[j1939.destinationAddress!]}</>}
            </span>
          ) : (
            <span>
              PDU2 <span className="muted">{t('broadcast')}</span>
            </span>
          )}
          <span>
            {t('source')} <b>{hexByte(j1939.sourceAddress)}</b>
            {ADDRESS_NAMES[j1939.sourceAddress] && <> {ADDRESS_NAMES[j1939.sourceAddress]}</>}
          </span>
          {j1939.dataPage > 0 && (
            <span>
              {t('dataPage')} <b>{j1939.dataPage}</b>
            </span>
          )}
        </div>
      )}

      {(warnings.length > 0 || sizeNotes.length > 0) && (
        <div className="banner-stack">
          {warnings.map((warning) => (
            <div key={warning} className="banner error">
              <Icon name="error" size={20} />
              <span>{warning}</span>
            </div>
          ))}
          {sizeNotes.map((note) => (
            <div key={note} className="banner warn">
              <Icon name="warning" size={20} />
              <span>{note}</span>
            </div>
          ))}
        </div>
      )}

      {message.comment && (
        <p className="lead" style={{ margin: '0 0 16px' }}>
          {message.comment}
        </p>
      )}

      <div className="row">
        <BitMatrix message={message} selectedSignal={selectedSignal} onSelectSignal={onSelectSignal} />
        <div className="col" style={{ flex: '1 1 320px' }}>
          {selectedIndex >= 0 ? (
            <SignalCard
              message={message}
              signal={message.signals[selectedIndex]}
              index={selectedIndex}
              decoded={decoded?.[selectedIndex]}
            />
          ) : (
            <div className="card muted">{t('selectSignalHint')}</div>
          )}
          <DecodeCard
            message={message}
            input={hexInput}
            onInput={setHexInput}
            bytes={bytes}
            decoded={decoded}
            selectedSignal={selectedSignal}
            onSelectSignal={toggle}
          />
          <EncodeCard
            message={message}
            decoderBytes={bytes}
            decoderHasInput={hexInput.trim() !== ''}
            onDecode={setHexInput}
            selectedSignal={selectedSignal}
            onSelectSignal={onSelectSignal}
          />
        </div>
      </div>

      <SignalTable message={message} selectedSignal={selectedSignal} onToggleSignal={toggle} />

      <AttributesCard title={t('messageAttributes')} attributes={message.attributes} />
    </div>
  );
}

function SignalCard({
  message,
  signal,
  index,
  decoded,
}: {
  message: DbcMessage;
  signal: DbcSignal;
  index: number;
  decoded?: DecodedSignal;
}) {
  const { t } = useI18n();
  const valueEntries = Object.entries(signal.values ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  const attributes = Object.entries(signal.attributes);
  // Simple m<N> signals always switch on the root multiplexor (M), never on
  // an m<N>M sub-multiplexor (same rule as decodeFrame).
  const multiplexor = message.signals.find((s) => s.multiplex.role === 'multiplexor');
  const ranges = (r: Array<[number, number]>) => r.map(([lo, hi]) => (lo === hi ? String(lo) : `${lo}–${hi}`)).join(', ');

  // When it is active: extended mux names its switch and ranges, simple mux
  // switches on the message's multiplexor signal.
  const when = signal.multiplex.extended
    ? `${signal.multiplex.extended.switchName} ∈ ${ranges(signal.multiplex.extended.ranges)}`
    : signal.multiplex.switchValue !== undefined
      ? t('muxEquals', { name: multiplexor && multiplexor !== signal ? multiplexor.name : 'M', n: signal.multiplex.switchValue })
      : '';
  const mux =
    signal.multiplex.role === 'multiplexor'
      ? t('muxRoleMultiplexor')
      : signal.multiplex.role === 'both'
        ? t('muxRoleBoth', { when })
        : signal.multiplex.role === 'multiplexed'
          ? when
          : '';

  return (
    <div className="card signal-card">
      <div className="card-overline">{t('signalOverline', { n: signalNumber(index) })}</div>
      <h2 className="signal-title">{signal.name}</h2>
      <div className="kv-grid">
        <div className="kv">
          <div className="k">{t('kvPhysical')}</div>
          <div className="v mono">
            {t('rawWord')} × {fmtNum(signal.factor)} + {fmtNum(signal.offset)}
          </div>
        </div>
        <div className="kv">
          <div className="k">{t('kvRange')}</div>
          <div className="v mono">
            {fmtNum(signal.min)} … {fmtNum(signal.max)} {signal.unit}
          </div>
        </div>
        <div className="kv">
          <div className="k">{t('kvBits')}</div>
          <div className="v mono">
            {signal.startBit} · {signal.length} · {signal.byteOrder === 'intel' ? 'Intel' : 'Motorola'}
          </div>
        </div>
        <div className="kv">
          <div className="k">{t('thReceivers')}</div>
          <div className="v">{signal.receivers.filter((r) => r !== 'Vector__XXX').join(', ') || '—'}</div>
        </div>
        <div className="kv">
          <div className="k">{t('thType')}</div>
          <div className="v mono">{signal.valueType}</div>
        </div>
        {mux && (
          <div className="kv">
            <div className="k">{signal.multiplex.role === 'multiplexor' ? t('kvMux') : t('activeWhen')}</div>
            <div className="v mono">{mux}</div>
          </div>
        )}
      </div>
      {signal.comment && <p className="comment">{signal.comment}</p>}
      {valueEntries.length > 0 && (
        <div className="value-chips" aria-label={t('valueDescriptions')}>
          {valueEntries.map(([raw, label]) => (
            <span
              key={raw}
              className={`value-chip ${decoded && decoded.active && decoded.raw === Number(raw) ? 'current' : ''}`}
            >
              {raw} · {label}
            </span>
          ))}
        </div>
      )}
      {attributes.length > 0 && (
        <dl className="mini-kv" aria-label={t('attributes')}>
          {attributes.map(([name, value]) => [<dt key={`k${name}`}>{name}</dt>, <dd key={`v${name}`}>{String(value)}</dd>])}
        </dl>
      )}
    </div>
  );
}

function DecodeCard({
  message,
  input,
  onInput,
  bytes,
  decoded,
  selectedSignal,
  onSelectSignal,
}: {
  message: DbcMessage;
  input: string;
  onInput: (value: string) => void;
  bytes: Uint8Array | null;
  decoded: DecodedSignal[] | null;
  selectedSignal?: string;
  onSelectSignal: (name: string) => void;
}) {
  const { t } = useI18n();
  // Long FD frames: a short placeholder, the explanation goes below the field.
  const placeholder = Array.from({ length: Math.min(message.dlc, 8) }, () => '00').join(' ') + (message.dlc > 8 ? ' …' : '');
  const entered = input.replace(/0x/gi, '').replace(/[\s,;.-]+/g, '').length / 2;

  return (
    <div className="card">
      <h2 style={{ marginBottom: 16 }}>{t('decodeFrame')}</h2>
      <label className={`text-field ${bytes === null ? 'invalid' : ''}`}>
        <span className="field-label">{t('hexPayload')}</span>
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
        />
        {input !== '' && (
          <button className="clear state" title={t('clearPayload')} aria-label={t('clearPayload')} onClick={() => onInput('')}>
            <Icon name="close" size={20} />
          </button>
        )}
      </label>
      {bytes === null ? (
        <div className="field-help error">{t('decodeInvalid')}</div>
      ) : input.trim() !== '' && entered !== message.dlc ? (
        // Shorter input is zero-padded, longer input cut to the DLC: show what is decoded.
        <div className="field-help mono">
          [{[...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}]
        </div>
      ) : (
        message.dlc > 8 && <div className="field-help">{t('decodePlaceholderLong', { n: message.dlc })}</div>
      )}
      {decoded && (
        <div className="decoded">
          {decoded.map(({ signal, raw, physical, label, active }, i) => (
            <div
              key={`${signal.name}#${i}`}
              className={`decoded-row ${active ? '' : 'inactive'} ${selectedSignal === signal.name ? 'selected' : ''}`}
              title={`${t('thRaw')} ${fmtNum(raw)}`}
              onClick={() => onSelectSignal(signal.name)}
            >
              <span className="name">{signal.name}</span>
              <span className="value">{active ? `${fmtNum(physical)}${signal.unit ? ` ${signal.unit}` : ''}` : '—'}</span>
              <span className="extra">{active ? label ?? '' : t('muxInactive')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
