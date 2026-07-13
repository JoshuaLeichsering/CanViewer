import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Lang = 'en' | 'de';

const STORAGE_KEY = 'canviewer.lang';

/**
 * All user-visible UI strings. Technical vocabulary that is identical in
 * German automotive usage (Intel/Motorola, DLC, PGN, Mux, CAN FD, signal
 * type names) intentionally stays untranslated.
 */
const en = {
  // toolbar / app shell
  openDbc: 'Open DBC…',
  version: 'version',
  messagesWord: 'messages',
  signalsWord: 'signals',
  nodesWord: 'nodes',
  parseProblemOne: '⚠ {n} parse problem',
  parseProblemMany: '⚠ {n} parse problems',
  settings: 'Settings',
  language: 'Language',
  welcomeTagline: 'A viewer for DBC CAN database files.',
  welcomeOpen: 'Open DBC file…',
  welcomeDrop: '…or drag & drop a .dbc file anywhere in this window',
  welcomeExampleHint: 'An example database ships with the repository:',
  dropOverlay: 'Drop DBC file to open',

  // sidebar
  searchPlaceholder: 'Search messages, signals, nodes…',
  network: 'Network',
  overview: 'Overview',
  ecuNetwork: 'ECU network',
  sidebarMessages: 'Messages',
  sidebarNodes: 'Nodes',
  sidebarValueTables: 'Value tables',
  noMatches: 'no matches',

  // overview
  statMessages: 'Messages',
  statSignals: 'Signals',
  statNodes: 'Nodes',
  statValueTables: 'Value tables',
  statAttrDefs: 'Attribute defs',
  dbComment: 'Database comment',
  parseProblemsTitle: '⚠ Parse problems ({n})',
  parseProblemsHint:
    'These lines could not be understood and were skipped — the rest of the file is loaded normally.',
  thLine: 'Line',
  thReason: 'Reason',
  thContent: 'Content',
  moreProblems: '… and {n} more problems not shown.',
  thId: 'ID',
  thName: 'Name',
  thSignals: 'Signals',
  thSender: 'Sender',
  thCycle: 'Cycle (ms)',
  thComment: 'Comment',
  attrDefsTitle: 'Attribute definitions',
  thAppliesTo: 'Applies to',
  thType: 'Type',
  thDefault: 'Default',
  thEnumValues: 'Enum values',
  appliesNetwork: 'Network',
  appliesNode: 'Node',
  appliesMessage: 'Message',
  appliesSignal: 'Signal',
  appliesEnvVar: 'Env var',
  networkAttributes: 'Network attributes',
  skippedTitle: 'Not displayed (parsed & skipped)',

  // message detail
  pillExtended: 'Extended 29-bit',
  dlc: 'DLC',
  sender: 'Sender',
  cycleTime: 'Cycle time',
  sendType: 'Send type',
  priority: 'Priority',
  destination: 'Destination',
  source: 'Source',
  broadcast: '(broadcast)',
  dataPage: 'Data page',
  warnExceeds: 'Signal “{name}” exceeds the {n}-byte data area.',
  warnOverlap: 'Signals “{a}” and “{b}” overlap.',
  noteDlcExceedsFd: 'DLC {n} exceeds the 64-byte CAN FD maximum.',
  noteInvalidFdSize:
    '{n} bytes is not a valid CAN FD frame size — on the wire the frame will be padded to {p} bytes.',
  noteClassicTooBig:
    'VFrameFormat declares this message classic CAN, but DLC {n} exceeds the classic 8-byte maximum.',
  signalsTitle: 'Signals',
  thMux: 'Mux',
  thStart: 'Start',
  thLength: 'Length',
  thByteOrder: 'Byte order',
  thFactor: 'Factor',
  thOffset: 'Offset',
  thUnit: 'Unit',
  thReceivers: 'Receivers',
  bitLayout: 'Bit layout',
  selectSignalHint: 'Select a signal in the table or bit matrix to see its details.',
  physicalEquals: 'Physical =',
  thPhysical: 'Physical',
  rawWord: 'raw',
  unitLabel: 'Unit',
  activeWhen: 'Active when',
  valueDescriptions: 'Value descriptions',
  thRaw: 'Raw',
  thMeaning: 'Meaning',
  attributes: 'Attributes',
  messageAttributes: 'Message attributes',
  decodeFrame: 'Decode frame',
  decodePlaceholderShort: 'Hex data, e.g. {ex}',
  decodePlaceholderLong: 'Hex data, up to {n} bytes — missing bytes are zero-padded',
  decodeInvalid: 'Enter full bytes as hex (e.g. “12 AB 00” or “0x12AB”).',
  muxInactive: 'mux inactive',

  // bit matrix
  bytesUnused: '⋯ bytes {from}–{to} unused',
  conflictTooltip: 'CONFLICT: {names}',
  muxAltTooltip: '{names} (bit {pos}, mux alternatives)',
  bitTooltip: '{name} (bit {pos})',

  // node detail
  pillNode: 'Node',
  transmitsPrefix: 'Transmits',
  messagesSuffix: 'messages',
  receivesPrefix: 'Receives',
  signalsSuffix: 'signals',
  txTitle: 'Transmitted messages',
  txNone: 'This node transmits no messages.',
  rxTitle: 'Received signals',
  rxNone: 'This node receives no signals.',
  thMessage: 'Message',
  thInMessage: 'In message',
  thFrom: 'From',
  thSignal: 'Signal',
  nodeAttributes: 'Node attributes',

  // value table detail
  pillValueTable: 'Value table',
  thRawValue: 'Raw value',

  // network graph
  graphHint:
    'Arrows point from sender to receiver; line width scales with the number of messages. Hover to trace a node, click nodes or connections for details.',
  graphEmpty:
    'This file contains no sender → receiver relationships, so there is nothing to draw. Many reverse-engineered DBC files assign all messages to a single placeholder node and leave receivers empty.',
  notConnected: 'Not connected:',
  unrouted: '{n} message(s) have no sender or no receivers and are not shown.',
  edgeMessagesOne: '({n} message)',
  edgeMessagesMany: '({n} messages)',
  edgeTitleOne: '{from} → {to}: {n} message',
  edgeTitleMany: '{from} → {to}: {n} messages',
  msgsCount: '{n} msgs',
  sendsTo: 'Sends to ({n})',
  receivesFrom: 'Receives from ({n})',
  nothing: 'nothing',
  openNodeView: 'Open node view →',
  graphClickHint: 'Click an ECU or a connection in the graph to list the messages behind it.',
};

export type MsgKey = keyof typeof en;

const de: Record<MsgKey, string> = {
  openDbc: 'DBC öffnen…',
  version: 'Version',
  messagesWord: 'Botschaften',
  signalsWord: 'Signale',
  nodesWord: 'Knoten',
  parseProblemOne: '⚠ {n} Parse-Problem',
  parseProblemMany: '⚠ {n} Parse-Probleme',
  settings: 'Einstellungen',
  language: 'Sprache',
  welcomeTagline: 'Ein Viewer für DBC-CAN-Datenbanken.',
  welcomeOpen: 'DBC-Datei öffnen…',
  welcomeDrop: '…oder eine .dbc-Datei einfach in dieses Fenster ziehen',
  welcomeExampleHint: 'Eine Beispiel-Datenbank liegt im Repository:',
  dropOverlay: 'DBC-Datei zum Öffnen loslassen',

  searchPlaceholder: 'Botschaften, Signale, Knoten suchen…',
  network: 'Netzwerk',
  overview: 'Übersicht',
  ecuNetwork: 'ECU-Netzwerk',
  sidebarMessages: 'Botschaften',
  sidebarNodes: 'Knoten',
  sidebarValueTables: 'Wertetabellen',
  noMatches: 'keine Treffer',

  statMessages: 'Botschaften',
  statSignals: 'Signale',
  statNodes: 'Knoten',
  statValueTables: 'Wertetabellen',
  statAttrDefs: 'Attribut-Defs',
  dbComment: 'Datenbank-Kommentar',
  parseProblemsTitle: '⚠ Parse-Probleme ({n})',
  parseProblemsHint:
    'Diese Zeilen konnten nicht interpretiert werden und wurden übersprungen — der Rest der Datei ist normal geladen.',
  thLine: 'Zeile',
  thReason: 'Grund',
  thContent: 'Inhalt',
  moreProblems: '… und {n} weitere Probleme werden nicht angezeigt.',
  thId: 'ID',
  thName: 'Name',
  thSignals: 'Signale',
  thSender: 'Sender',
  thCycle: 'Zyklus (ms)',
  thComment: 'Kommentar',
  attrDefsTitle: 'Attribut-Definitionen',
  thAppliesTo: 'Gilt für',
  thType: 'Typ',
  thDefault: 'Standard',
  thEnumValues: 'Enum-Werte',
  appliesNetwork: 'Netzwerk',
  appliesNode: 'Knoten',
  appliesMessage: 'Botschaft',
  appliesSignal: 'Signal',
  appliesEnvVar: 'Umgebungsvariable',
  networkAttributes: 'Netzwerk-Attribute',
  skippedTitle: 'Nicht dargestellt (erkannt & übersprungen)',

  pillExtended: 'Extended 29-Bit',
  dlc: 'DLC',
  sender: 'Sender',
  cycleTime: 'Zykluszeit',
  sendType: 'Sendetyp',
  priority: 'Priorität',
  destination: 'Ziel',
  source: 'Quelle',
  broadcast: '(Broadcast)',
  dataPage: 'Data Page',
  warnExceeds: 'Signal „{name}“ überschreitet den {n}-Byte-Datenbereich.',
  warnOverlap: 'Signale „{a}“ und „{b}“ überlappen sich.',
  noteDlcExceedsFd: 'DLC {n} überschreitet das CAN-FD-Maximum von 64 Bytes.',
  noteInvalidFdSize:
    '{n} Bytes sind keine gültige CAN-FD-Framegröße — auf dem Bus wird der Frame auf {p} Bytes aufgefüllt.',
  noteClassicTooBig:
    'VFrameFormat deklariert diese Botschaft als klassisches CAN, aber DLC {n} überschreitet das klassische Maximum von 8 Bytes.',
  signalsTitle: 'Signale',
  thMux: 'Mux',
  thStart: 'Start',
  thLength: 'Länge',
  thByteOrder: 'Byte-Reihenfolge',
  thFactor: 'Faktor',
  thOffset: 'Offset',
  thUnit: 'Einheit',
  thReceivers: 'Empfänger',
  bitLayout: 'Bit-Layout',
  selectSignalHint: 'Signal in Tabelle oder Bit-Matrix auswählen, um Details zu sehen.',
  physicalEquals: 'Physikalisch =',
  thPhysical: 'Physikalisch',
  rawWord: 'Rohwert',
  unitLabel: 'Einheit',
  activeWhen: 'Aktiv wenn',
  valueDescriptions: 'Wertebeschreibungen',
  thRaw: 'Rohwert',
  thMeaning: 'Bedeutung',
  attributes: 'Attribute',
  messageAttributes: 'Botschafts-Attribute',
  decodeFrame: 'Frame dekodieren',
  decodePlaceholderShort: 'Hex-Daten, z. B. {ex}',
  decodePlaceholderLong: 'Hex-Daten, bis zu {n} Bytes — fehlende Bytes werden mit Null aufgefüllt',
  decodeInvalid: 'Ganze Bytes als Hex eingeben (z. B. „12 AB 00“ oder „0x12AB“).',
  muxInactive: 'Mux inaktiv',

  bytesUnused: '⋯ Bytes {from}–{to} ungenutzt',
  conflictTooltip: 'KONFLIKT: {names}',
  muxAltTooltip: '{names} (Bit {pos}, Mux-Alternativen)',
  bitTooltip: '{name} (Bit {pos})',

  pillNode: 'Knoten',
  transmitsPrefix: 'Sendet',
  messagesSuffix: 'Botschaften',
  receivesPrefix: 'Empfängt',
  signalsSuffix: 'Signale',
  txTitle: 'Gesendete Botschaften',
  txNone: 'Dieser Knoten sendet keine Botschaften.',
  rxTitle: 'Empfangene Signale',
  rxNone: 'Dieser Knoten empfängt keine Signale.',
  thMessage: 'Botschaft',
  thInMessage: 'In Botschaft',
  thFrom: 'Von',
  thSignal: 'Signal',
  nodeAttributes: 'Knoten-Attribute',

  pillValueTable: 'Wertetabelle',
  thRawValue: 'Rohwert',

  graphHint:
    'Pfeile zeigen vom Sender zum Empfänger; die Linienstärke wächst mit der Anzahl der Botschaften. Zum Verfolgen über einen Knoten fahren, für Details Knoten oder Verbindungen anklicken.',
  graphEmpty:
    'Diese Datei enthält keine Sender-→-Empfänger-Beziehungen, es gibt also nichts zu zeichnen. Viele reverse-engineerte DBC-Dateien hängen alle Botschaften an einen Platzhalterknoten und lassen die Empfänger leer.',
  notConnected: 'Nicht verbunden:',
  unrouted: '{n} Botschaft(en) haben keinen Sender oder keine Empfänger und werden nicht gezeigt.',
  edgeMessagesOne: '({n} Botschaft)',
  edgeMessagesMany: '({n} Botschaften)',
  edgeTitleOne: '{from} → {to}: {n} Botschaft',
  edgeTitleMany: '{from} → {to}: {n} Botschaften',
  msgsCount: '{n} Botsch.',
  sendsTo: 'Sendet an ({n})',
  receivesFrom: 'Empfängt von ({n})',
  nothing: 'nichts',
  openNodeView: 'Knoten-Ansicht öffnen →',
  graphClickHint: 'ECU oder Verbindung im Graphen anklicken, um die zugehörigen Botschaften zu sehen.',
};

const dictionaries: Record<Lang, Record<MsgKey, string>> = { en, de };

export type TParams = Record<string, string | number>;

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'de') return stored;
  } catch {
    // storage unavailable — fall through to browser language
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

const I18nContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: 'en',
  setLang: () => {},
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // not persisted, selection still applies for this session
    }
  }, [lang]);

  return <I18nContext.Provider value={{ lang, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const { lang, setLang } = useContext(I18nContext);
  const t = useCallback(
    (key: MsgKey, params?: TParams) => interpolate(dictionaries[lang][key], params),
    [lang],
  );
  /** Count-aware variant: picks the singular or plural key by params.n. */
  const tn = useCallback(
    (oneKey: MsgKey, manyKey: MsgKey, n: number, params?: TParams) =>
      interpolate(dictionaries[lang][n === 1 ? oneKey : manyKey], { n, ...params }),
    [lang],
  );
  return { t, tn, lang, setLang };
}
