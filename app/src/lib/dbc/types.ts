/** Attribute value: number for INT/HEX/FLOAT/ENUM-index-resolved, string for STRING/ENUM. */
export type AttrValue = number | string;

export type ByteOrder = 'intel' | 'motorola';

export type SignalValueType = 'unsigned' | 'signed' | 'float' | 'double';

export interface MultiplexInfo {
  /** 'multiplexor' = the switch signal (M), 'multiplexed' = switched signal (m<N>), 'both' = m<N>M (extended mux). */
  role: 'none' | 'multiplexor' | 'multiplexed' | 'both';
  /** Switch value for simple multiplexed signals (m<N>). */
  switchValue?: number;
  /** Extended multiplexing (SG_MUL_VAL_): which switch signal and value ranges activate this signal. */
  extended?: {
    switchName: string;
    ranges: Array<[number, number]>;
  };
}

export interface DbcSignal {
  name: string;
  /** Start bit exactly as written in the DBC (Intel: LSB position, Motorola: MSB position, sawtooth numbering). */
  startBit: number;
  /** Length in bits. */
  length: number;
  byteOrder: ByteOrder;
  valueType: SignalValueType;
  factor: number;
  offset: number;
  min: number;
  max: number;
  unit: string;
  receivers: string[];
  multiplex: MultiplexInfo;
  /** Value descriptions from VAL_ (raw value -> text). */
  values?: Record<number, string>;
  comment?: string;
  attributes: Record<string, AttrValue>;
}

export interface DbcMessage {
  /** CAN arbitration id without the extended-frame flag bit. */
  id: number;
  /** Raw id as written in the DBC (may include the 0x80000000 extended flag). */
  rawId: number;
  isExtended: boolean;
  name: string;
  /** Data length code (bytes). */
  dlc: number;
  /** Sender node ("Vector__XXX" if unassigned). */
  sender: string;
  /** Additional transmitters from BO_TX_BU_. */
  transmitters: string[];
  signals: DbcSignal[];
  comment?: string;
  attributes: Record<string, AttrValue>;
}

export interface DbcNode {
  name: string;
  comment?: string;
  attributes: Record<string, AttrValue>;
}

export interface DbcValueTable {
  name: string;
  values: Record<number, string>;
}

export interface DbcAttributeDefinition {
  name: string;
  /** '' = global (network), BU_ = node, BO_ = message, SG_ = signal, EV_ = env var. */
  objectType: '' | 'BU_' | 'BO_' | 'SG_' | 'EV_';
  valueType: 'INT' | 'HEX' | 'FLOAT' | 'STRING' | 'ENUM';
  min?: number;
  max?: number;
  enumValues?: string[];
  defaultValue?: AttrValue;
}

export interface ParseProblem {
  line: number;
  text: string;
  reason: string;
}

export interface DbcDatabase {
  version: string;
  nodes: DbcNode[];
  messages: DbcMessage[];
  valueTables: DbcValueTable[];
  attributeDefinitions: DbcAttributeDefinition[];
  /** Network-level attribute values (BA_ without object). */
  attributes: Record<string, AttrValue>;
  comment?: string;
  /** Lines the parser could not understand (never throws away the file over one bad line). */
  problems: ParseProblem[];
  /** Statement keywords that were recognized but intentionally skipped (EV_, SIG_GROUP_, ...). */
  skipped: Record<string, number>;
}
