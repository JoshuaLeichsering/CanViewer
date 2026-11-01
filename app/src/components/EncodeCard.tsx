import { useEffect, useMemo, useState } from 'react';
import type { DbcMessage, DbcSignal } from '../lib/dbc/types';
import { toPhysical } from '../lib/dbc/bits';
import { encodeFrame, parsePhysicalInput, physicalRange, type EncodedSignal, type EncodeProblem } from '../lib/dbc/encode';
import { useI18n } from '../lib/i18n';
import { fmtNum } from '../lib/format';
import { signalNumber, signalTone } from './BitMatrix';
import { Icon } from './Icon';
import './trc.css';

const toHex = (data: Uint8Array) => [...data].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

interface EncoderState {
  message: DbcMessage;
  /** What the person typed, one entry per signal. */
  inputs: string[];
  /** The frame that bits without a value come from; null is all zeros. */
  base: Uint8Array | null;
}

const fresh = (message: DbcMessage): EncoderState => ({ message, inputs: message.signals.map(() => ''), base: null });

/**
 * The frame encoder, the inverse of the decode card: a physical value per
 * signal in, the frame's bytes out. Multiplexed signals count only when the
 * multiplexor values entered select them. Every frame is decoded again, so
 * each row shows what the frame really holds.
 */
export function EncodeCard({
  message,
  decoderBytes,
  decoderHasInput,
  onDecode,
  selectedSignal,
  onSelectSignal,
}: {
  message: DbcMessage;
  /** The decode card's frame, or null when its input is not valid hex. */
  decoderBytes: Uint8Array | null;
  decoderHasInput: boolean;
  /** Put hex into the decode card. */
  onDecode: (hex: string) => void;
  selectedSignal?: string;
  onSelectSignal: (name: string) => void;
}) {
  const { t } = useI18n();
  const [stored, setStored] = useState<EncoderState>(() => fresh(message));
  // A different message starts afresh; values typed for another message mean nothing here.
  const state = stored.message === message ? stored : fresh(message);
  if (state !== stored) setStored(state);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const parsed = useMemo(() => state.inputs.map(parsePhysicalInput), [state.inputs]);
  const result = useMemo(
    () =>
      encodeFrame(
        message.signals,
        message.dlc,
        parsed.map((v) => (v === null ? undefined : v)),
        state.base ?? undefined,
      ),
    [message, parsed, state.base],
  );
  const hex = toHex(result.data);

  const setInput = (index: number, value: string) =>
    setStored({ ...state, inputs: state.inputs.map((v, i) => (i === index ? value : v)) });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <div className="card trc-enc" data-testid="trc-encoder">
      <h2>{t('trcEncTitle')}</h2>
      <p className="trc-enc-help">
        {t('trcEncHint')} {state.base ? t('trcEncBaseDecoder') : t('trcEncBaseZero')}
      </p>
      <div className="trc-enc-rows">
        {message.signals.map((signal, index) => (
          <EncodeRow
            key={`${signal.name}#${index}`}
            signal={signal}
            index={index}
            dlc={message.dlc}
            input={state.inputs[index]}
            value={parsed[index]}
            encoded={result.signals[index]}
            problem={result.problems.find((p) => p.index === index)}
            selected={selectedSignal === signal.name}
            onInput={(v) => setInput(index, v)}
            onFocus={() => onSelectSignal(signal.name)}
          />
        ))}
      </div>
      {result.problems.some((p) => p.kind === 'overwritten') && (
        <div className="banner error trc-enc-banner">
          <Icon name="error" size={20} />
          <span>{t('trcEncProblems')}</span>
        </div>
      )}
      <div className="trc-enc-out">
        <div className="trc-enc-out-label">{t('trcEncHex')}</div>
        <output className="trc-enc-hex" data-testid="trc-enc-hex" aria-live="polite">
          {hex || '—'}
        </output>
        <div className="trc-enc-actions">
          <button className="btn tonal with-icon state" onClick={() => void copy()} disabled={hex === ''}>
            <Icon name="content_copy" size={18} />
            {copied === 'ok' ? t('trcEncCopied') : copied === 'failed' ? t('trcEncCopyFailed') : t('trcEncCopy')}
          </button>
          <button
            className="btn tonal with-icon state"
            title={t('trcEncToDecoderTitle')}
            onClick={() => onDecode(hex)}
            disabled={hex === ''}
          >
            <Icon name="north" size={18} />
            {t('trcEncToDecoder')}
          </button>
          <button
            className="btn text with-icon state"
            title={t('trcEncFromDecoderTitle')}
            disabled={!decoderBytes || !decoderHasInput}
            onClick={() => decoderBytes && setStored({ message, inputs: message.signals.map(() => ''), base: decoderBytes.slice() })}
          >
            <Icon name="south" size={18} />
            {t('trcEncFromDecoder')}
          </button>
          <button className="btn text state" onClick={() => setStored(fresh(message))}>
            {t('trcEncReset')}
          </button>
        </div>
      </div>
    </div>
  );
}

function EncodeRow({
  signal,
  index,
  dlc,
  input,
  value,
  encoded,
  problem,
  selected,
  onInput,
  onFocus,
}: {
  signal: DbcSignal;
  index: number;
  dlc: number;
  input: string;
  value: number | undefined | null;
  encoded: EncodedSignal;
  problem?: EncodeProblem;
  selected: boolean;
  onInput: (value: string) => void;
  onFocus: () => void;
}) {
  const { t } = useI18n();
  const unit = signal.unit ? ` ${signal.unit}` : '';
  const decoded = encoded.decoded;
  const range = physicalRange(signal);
  const valueEntries = Object.entries(signal.values ?? {}).sort(([a], [b]) => Number(a) - Number(b));

  let note: React.ReactNode = null;
  let tone: 'error' | 'warn' | '' = '';
  if (value === null) {
    note = t('trcEncInvalid');
    tone = 'error';
  } else if (problem?.kind === 'range' || problem?.kind === 'notFinite') {
    note = range ? t('trcEncRange', { min: fmtNum(range[0]), max: fmtNum(range[1]) }) : t('trcEncInvalid');
    tone = 'error';
  } else if (problem?.kind === 'outOfBounds') {
    note = t('trcEncOutOfBounds', { n: dlc });
    tone = 'error';
  } else if (problem?.kind === 'overwritten') {
    note = t('trcEncOverwritten');
    tone = 'error';
  } else if (!encoded.active) {
    note = t('muxInactive');
  } else if (decoded && value !== undefined && decoded.physical !== value) {
    note = t('trcEncRounded', { value: fmtNum(decoded.physical) + unit });
  } else if (value !== undefined && !(signal.min === 0 && signal.max === 0) && (value < signal.min || value > signal.max)) {
    note = t('trcEncLimit', { min: fmtNum(signal.min), max: fmtNum(signal.max) });
    tone = 'warn';
  } else if (valueEntries.length > 0 && decoded) {
    // Value descriptions: pick one to enter its value.
    const current = valueEntries.some(([raw]) => Number(raw) === decoded.raw) ? String(decoded.raw) : '';
    note = (
      <select
        className="trc-enc-select"
        aria-label={t('trcEncChoose', { name: signal.name })}
        value={current}
        onFocus={onFocus}
        onChange={(e) => e.target.value !== '' && onInput(fmtNum(toPhysical(signal, Number(e.target.value))))}
      >
        <option value="">{t('trcEncRaw', { n: fmtNum(decoded.raw) })}</option>
        {valueEntries.map(([raw, label]) => (
          <option key={raw} value={raw}>
            {raw} · {label}
          </option>
        ))}
      </select>
    );
  } else if (decoded) {
    note = t('trcEncRaw', { n: fmtNum(decoded.raw) });
  }

  const placeholder = decoded ? fmtNum(decoded.physical) : '';
  return (
    <div className={`trc-enc-row ${encoded.active ? '' : 'inactive'} ${selected ? 'selected' : ''}`} data-signal={signal.name}>
      <span className="trc-enc-name" title={signal.name}>
        <span className={`sig-chip tone-${signalTone(index)}`}>{signalNumber(index)}</span>
        {signal.name}
      </span>
      <label className={`trc-enc-field ${tone === 'error' ? 'invalid' : ''}`}>
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onFocus={onFocus}
          placeholder={placeholder}
          inputMode="decimal"
          spellCheck={false}
          autoComplete="off"
          aria-label={signal.unit ? `${signal.name} (${signal.unit})` : signal.name}
          aria-invalid={tone === 'error' || undefined}
        />
        {signal.unit && <span className="trc-enc-unit">{signal.unit}</span>}
      </label>
      <span className={`trc-enc-note ${tone}`} title={typeof note === 'string' ? note : undefined}>
        {note}
      </span>
    </div>
  );
}
