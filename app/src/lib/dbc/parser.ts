import type {
  AttrValue,
  DbcAttributeDefinition,
  DbcDatabase,
  DbcMessage,
  DbcSignal,
  DbcValueTable,
  ParseProblem,
} from './types';

/** Placeholder node name Vector tools use for "no sender / no receiver". */
export const NO_NODE = 'Vector__XXX';

const EXT_FLAG = 0x80000000;

/** Longest a single signal may be (CAN FD frame = 64 bytes = 512 bits). */
export const MAX_SIGNAL_BITS = 512;

const MAX_PROBLEMS = 1000;

interface Statement {
  line: number;
  text: string;
}

/** Statement keywords that are recognized but not modeled by the viewer. */
export const SKIPPED_KEYWORDS = [
  'NS_',
  'BS_',
  'EV_',
  'ENVVAR_DATA_',
  'EV_DATA_',
  'SGTYPE_',
  'SGTYPE_VAL_',
  'BA_DEF_SGTYPE_',
  'BA_SGTYPE_',
  'SIG_TYPE_REF_',
  'SIG_GROUP_',
  'SIGTYPE_VALTYPE_',
  'BA_DEF_REL_',
  'BA_DEF_DEF_REL_',
  'BA_REL_',
  'BU_SG_REL_',
  'BU_EV_REL_',
  'BU_BO_REL_',
  'NS_DESC_',
  'CAT_DEF_',
  'CAT_',
  'FILTER',
];

/** Keywords that may appear indented in the NS_ block. */
const NS_KEYWORDS = new Set([
  'NS_DESC_', 'CM_', 'BA_DEF_', 'BA_', 'VAL_', 'CAT_DEF_', 'CAT_', 'FILTER',
  'BA_DEF_DEF_', 'EV_DATA_', 'ENVVAR_DATA_', 'SGTYPE_', 'SGTYPE_VAL_',
  'BA_DEF_SGTYPE_', 'BA_SGTYPE_', 'SIG_TYPE_REF_', 'VAL_TABLE_', 'SIG_GROUP_',
  'SIG_VALTYPE_', 'SIGTYPE_VALTYPE_', 'BO_TX_BU_', 'BA_DEF_REL_', 'BA_REL_',
  'BA_DEF_DEF_REL_', 'BU_SG_REL_', 'BU_EV_REL_', 'BU_BO_REL_', 'SG_MUL_VAL_',
]);

/** Every keyword that can legally start a DBC statement. */
const KNOWN_KEYWORDS = new Set([
  'VERSION', 'NS_', 'BS_', 'BU_', 'BO_', 'SG_',
  ...NS_KEYWORDS,
  ...SKIPPED_KEYWORDS,
]);

/** Statements the grammar terminates with ';' — these may wrap across lines. */
const SEMI_TERMINATED = new Set([
  'CM_', 'BA_DEF_', 'BA_DEF_DEF_', 'BA_', 'VAL_', 'VAL_TABLE_',
  'SIG_VALTYPE_', 'SG_MUL_VAL_', 'BO_TX_BU_',
  'BA_DEF_REL_', 'BA_DEF_DEF_REL_', 'BA_REL_', 'CAT_DEF_',
]);

function keywordOf(text: string): string {
  return text.match(/^\s*([A-Za-z_]+)/)?.[1] ?? '';
}

/** DBC writers (e.g. cantools) escape quotes inside strings as \" — undo that. */
function unescapeString(s: string): string {
  return s.replace(/\\"/g, '"');
}

/**
 * Split raw DBC text into logical statements. A statement is normally one
 * line, but:
 *  - quoted strings (CM_ comments) may span lines, with \" escapes,
 *  - ';'-terminated statements may wrap across lines (long ENUM lists),
 *  - BU_ node lists may continue on indented lines,
 *  - a stray unclosed quote must not swallow the rest of the file: at EOF the
 *    offending line is emitted alone and the remaining lines are re-split.
 */
function splitStatements(text: string): Statement[] {
  const lines = text.split(/\r\n|\r|\n/);
  const statements: Statement[] = [];
  let buffer = '';
  let startLine = 0;
  let inString = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (buffer === '') startLine = i + 1;
    buffer = buffer === '' ? line : buffer + '\n' + line;
    for (let j = 0; j < line.length; j++) {
      if (inString && line[j] === '\\' && line[j + 1] === '"') {
        j++;
        continue;
      }
      if (line[j] === '"') inString = !inString;
    }
    if (inString) continue; // string spans to the next line

    const stmt = buffer.trim();
    if (stmt === '') {
      buffer = '';
      continue;
    }

    const keyword = keywordOf(stmt);
    const next = lines[i + 1];
    const nextIsKeyword = next !== undefined && KNOWN_KEYWORDS.has(keywordOf(next));

    // Wrapped ';'-statement: keep joining until the terminator, unless the
    // next line clearly starts a new statement. A CM_ ending in '"' is
    // treated as complete so files omitting the ';' keep working.
    const looksComplete = /;\s*$/.test(stmt) || (keyword === 'CM_' && /"$/.test(stmt));
    if (SEMI_TERMINATED.has(keyword) && !looksComplete && next !== undefined && !nextIsKeyword) {
      continue;
    }
    // Node list continued on an indented line (canmatrix style).
    if (keyword === 'BU_' && next !== undefined && /^\s+\S/.test(next) && !nextIsKeyword) {
      continue;
    }

    statements.push({ line: startLine, text: stmt });
    buffer = '';
  }

  const rest = buffer.trim();
  if (rest !== '') {
    if (inString) {
      // Unclosed string at EOF: emit the offending first line alone (it will
      // surface as a parse problem) and recover the rest of the file.
      const bufLines = buffer.split('\n');
      const first = bufLines[0].trim();
      if (first !== '') statements.push({ line: startLine, text: first });
      for (const s of splitStatements(bufLines.slice(1).join('\n'))) {
        statements.push({ line: startLine + s.line, text: s.text });
      }
    } else {
      statements.push({ line: startLine, text: rest });
    }
  }
  return statements;
}

/** Parse `<int> "<text>" <int> "<text>" ...` pairs used by VAL_ and VAL_TABLE_. */
function parseValuePairs(rest: string): Record<number, string> | null {
  const values: Record<number, string> = {};
  const re = /(-?\d+)\s+"([^"]*)"/g;
  let match: RegExpExecArray | null;
  let matchedLength = 0;
  while ((match = re.exec(rest)) !== null) {
    values[parseInt(match[1], 10)] = unescapeString(match[2]);
    matchedLength = re.lastIndex;
  }
  // Reject if there is leftover non-terminator content (malformed pair list).
  const leftover = rest.slice(matchedLength).replace(/[\s;]/g, '');
  if (leftover !== '') return null;
  return values;
}

function parseAttrValueToken(token: string): AttrValue {
  const t = token.trim().replace(/;$/, '').trim();
  const quoted = t.match(/^"([\s\S]*)"$/);
  if (quoted) return unescapeString(quoted[1]);
  const num = Number(t);
  return Number.isNaN(num) ? t : num;
}

const SIGNAL_RE =
  /^SG_\s+(\w+)\s*(M|m\d*M?)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)\s*\[\s*([^|\]]*?)\s*\|\s*([^|\]]*?)\s*\]\s*"([^"]*)"\s*(.*)$/;

function parseSignal(text: string): DbcSignal | null {
  const m = text.match(SIGNAL_RE);
  if (!m) return null;
  const [, name, mux, startBit, length, order, sign, factor, offset, min, max, unit, receivers] = m;

  const multiplex: DbcSignal['multiplex'] = { role: 'none' };
  if (mux) {
    const digits = mux.match(/^m(\d*)/)?.[1] ?? '';
    if (mux === 'M' || digits === '') {
      // A bare lowercase "m" occurs in the wild (vw_pq.dbc) and marks the
      // multiplexor switch just like "M".
      multiplex.role = 'multiplexor';
    } else {
      multiplex.role = mux.endsWith('M') ? 'both' : 'multiplexed';
      multiplex.switchValue = parseInt(digits, 10);
    }
  }

  return {
    name,
    startBit: parseInt(startBit, 10),
    length: parseInt(length, 10),
    byteOrder: order === '1' ? 'intel' : 'motorola',
    valueType: sign === '-' ? 'signed' : 'unsigned',
    factor: parseFloat(factor),
    offset: parseFloat(offset),
    min: min.trim() === '' ? 0 : parseFloat(min),
    max: max.trim() === '' ? 0 : parseFloat(max),
    unit,
    receivers: receivers
      .split(/[,\s]+/)
      .map((r) => r.trim())
      .filter((r) => r !== '' && r !== NO_NODE),
    multiplex,
    attributes: {},
  };
}

export function parseDbc(text: string): DbcDatabase {
  const db: DbcDatabase = {
    version: '',
    nodes: [],
    messages: [],
    valueTables: [],
    attributeDefinitions: [],
    attributes: {},
    problems: [],
    skipped: {},
  };

  const messagesByRawId = new Map<number, DbcMessage>();
  const nodesByName = new Map<string, { name: string; comment?: string; attributes: Record<string, AttrValue> }>();
  let currentMessage: DbcMessage | null = null;
  let insideNsBlock = false;
  let problemsSuppressed = false;

  const problem = (stmt: Statement, reason: string) => {
    if (problemsSuppressed) return;
    if (db.problems.length >= MAX_PROBLEMS) {
      problemsSuppressed = true;
      db.problems.push({
        line: stmt.line,
        text: '…',
        reason: `more than ${MAX_PROBLEMS} problems — this is probably not a DBC file; further problems suppressed`,
      });
      return;
    }
    db.problems.push({ line: stmt.line, text: stmt.text.slice(0, 200), reason } satisfies ParseProblem);
  };

  const skip = (keyword: string) => {
    db.skipped[keyword] = (db.skipped[keyword] ?? 0) + 1;
  };

  const findMessage = (rawId: number): DbcMessage | undefined =>
    messagesByRawId.get(rawId) ??
    db.messages.find((msg) => msg.id === (rawId & ~EXT_FLAG));

  const findSignal = (rawId: number, signalName: string): DbcSignal | undefined =>
    findMessage(rawId)?.signals.find((s) => s.name === signalName);

  for (const stmt of splitStatements(text)) {
    const { text: line } = stmt;
    const keyword = keywordOf(line);

    // NS_ block: the keyword list that follows "NS_ :" appears as bare
    // indented keywords; consume them silently until a real statement starts.
    if (keyword === 'NS_') {
      insideNsBlock = true;
      skip('NS_');
      continue;
    }
    if (insideNsBlock && NS_KEYWORDS.has(line.trim())) continue;
    insideNsBlock = false;

    switch (keyword) {
      case 'VERSION': {
        db.version = unescapeString(line.match(/^VERSION\s+"([^"]*)"/)?.[1] ?? '');
        continue;
      }

      case 'BU_': {
        // Node list: BU_: Node1 Node2 ...  (also matches BU_SG_REL_ etc., so check exact form)
        const m = line.match(/^BU_\s*:\s*([\s\S]*)$/);
        if (!m) break;
        for (const name of m[1].split(/\s+/).filter((n) => n !== '' && n !== NO_NODE)) {
          if (!nodesByName.has(name)) {
            const node = { name, attributes: {} };
            nodesByName.set(name, node);
            db.nodes.push(node);
          }
        }
        continue;
      }

      case 'BO_': {
        const m = line.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)\s*$/);
        if (!m) {
          problem(stmt, 'malformed BO_ message definition');
          currentMessage = null;
          continue;
        }
        const rawId = parseInt(m[1], 10);
        const isExtended = (rawId & EXT_FLAG) !== 0;
        currentMessage = {
          id: isExtended ? rawId & ~EXT_FLAG : rawId,
          rawId,
          isExtended,
          name: m[2],
          dlc: parseInt(m[3], 10),
          sender: m[4] === NO_NODE ? '' : m[4],
          transmitters: [],
          signals: [],
          attributes: {},
        };
        db.messages.push(currentMessage);
        if (messagesByRawId.has(rawId)) {
          problem(stmt, `duplicate message id ${rawId} — comments/attributes attach to the first definition`);
        } else {
          messagesByRawId.set(rawId, currentMessage);
        }
        continue;
      }

      case 'SG_': {
        if (!currentMessage) {
          problem(stmt, 'SG_ signal outside of a BO_ message block');
          continue;
        }
        const signal = parseSignal(line);
        if (!signal) {
          problem(stmt, 'malformed SG_ signal definition');
          continue;
        }
        if (signal.length < 1 || signal.length > MAX_SIGNAL_BITS || signal.startBit >= MAX_SIGNAL_BITS) {
          problem(stmt, `signal "${signal.name}" has an invalid start bit or length — skipped`);
          continue;
        }
        currentMessage.signals.push(signal);
        continue;
      }

      case 'BO_TX_BU_': {
        const m = line.match(/^BO_TX_BU_\s+(\d+)\s*:\s*([\s\S]*?);?\s*$/);
        if (!m) break;
        const msg = findMessage(parseInt(m[1], 10));
        if (!msg) {
          problem(stmt, 'BO_TX_BU_ references unknown message id');
          continue;
        }
        msg.transmitters = m[2]
          .split(/[,\s]+/)
          .filter((n) => n !== '' && n !== NO_NODE && n !== msg.sender);
        continue;
      }

      case 'CM_': {
        let m = line.match(/^CM_\s+"([\s\S]*)"\s*;?\s*$/);
        if (m) {
          db.comment = unescapeString(m[1]);
          continue;
        }
        m = line.match(/^CM_\s+BU_\s+(\w+)\s+"([\s\S]*)"\s*;?\s*$/);
        if (m) {
          const node = nodesByName.get(m[1]);
          if (node) node.comment = unescapeString(m[2]);
          else problem(stmt, 'CM_ BU_ references unknown node');
          continue;
        }
        m = line.match(/^CM_\s+BO_\s+(\d+)\s+"([\s\S]*)"\s*;?\s*$/);
        if (m) {
          const msg = findMessage(parseInt(m[1], 10));
          if (msg) msg.comment = unescapeString(m[2]);
          else problem(stmt, 'CM_ BO_ references unknown message id');
          continue;
        }
        m = line.match(/^CM_\s+SG_\s+(\d+)\s+(\w+)\s+"([\s\S]*)"\s*;?\s*$/);
        if (m) {
          const sig = findSignal(parseInt(m[1], 10), m[2]);
          if (sig) sig.comment = unescapeString(m[3]);
          else problem(stmt, 'CM_ SG_ references unknown signal');
          continue;
        }
        m = line.match(/^CM_\s+EV_\s+/);
        if (m) {
          skip('CM_ EV_');
          continue;
        }
        problem(stmt, 'malformed CM_ comment');
        continue;
      }

      case 'VAL_TABLE_': {
        const m = line.match(/^VAL_TABLE_\s+(\w+)\s+([\s\S]*)$/);
        if (!m) {
          problem(stmt, 'malformed VAL_TABLE_');
          continue;
        }
        const values = parseValuePairs(m[2]);
        if (!values) {
          problem(stmt, 'malformed VAL_TABLE_ value pairs');
          continue;
        }
        db.valueTables.push({ name: m[1], values } satisfies DbcValueTable);
        continue;
      }

      case 'VAL_': {
        const m = line.match(/^VAL_\s+(\d+)\s+(\w+)\s+([\s\S]*)$/);
        if (!m) {
          // VAL_ for environment variables: VAL_ <EnvVarName> ... — not modeled.
          if (/^VAL_\s+\w+\s+/.test(line)) skip('VAL_ (env var)');
          else problem(stmt, 'malformed VAL_');
          continue;
        }
        const sig = findSignal(parseInt(m[1], 10), m[2]);
        if (!sig) {
          problem(stmt, 'VAL_ references unknown signal');
          continue;
        }
        const values = parseValuePairs(m[3]);
        if (!values) {
          problem(stmt, 'malformed VAL_ value pairs');
          continue;
        }
        sig.values = values;
        continue;
      }

      case 'SIG_VALTYPE_': {
        const m = line.match(/^SIG_VALTYPE_\s+(\d+)\s+(\w+)\s*:?\s*(\d)\s*;?\s*$/);
        if (!m) {
          problem(stmt, 'malformed SIG_VALTYPE_');
          continue;
        }
        const sig = findSignal(parseInt(m[1], 10), m[2]);
        if (!sig) {
          problem(stmt, 'SIG_VALTYPE_ references unknown signal');
          continue;
        }
        if (m[3] === '1') sig.valueType = 'float';
        else if (m[3] === '2') sig.valueType = 'double';
        continue;
      }

      case 'SG_MUL_VAL_': {
        const m = line.match(/^SG_MUL_VAL_\s+(\d+)\s+(\w+)\s+(\w+)\s+([\d\s,-]+);?\s*$/);
        if (!m) {
          problem(stmt, 'malformed SG_MUL_VAL_');
          continue;
        }
        const sig = findSignal(parseInt(m[1], 10), m[2]);
        if (!sig) {
          problem(stmt, 'SG_MUL_VAL_ references unknown signal');
          continue;
        }
        const ranges: Array<[number, number]> = [];
        for (const part of m[4].split(',')) {
          const r = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
          if (r) ranges.push([parseInt(r[1], 10), parseInt(r[2], 10)]);
        }
        sig.multiplex.extended = { switchName: m[3], ranges };
        continue;
      }

      case 'BA_DEF_': {
        const m = line.match(/^BA_DEF_\s+(BU_|BO_|SG_|EV_)?\s*"([^"]+)"\s+(INT|HEX|FLOAT|STRING|ENUM)\s*([\s\S]*?);?\s*$/);
        if (!m) {
          problem(stmt, 'malformed BA_DEF_');
          continue;
        }
        const def: DbcAttributeDefinition = {
          name: m[2],
          objectType: (m[1] as DbcAttributeDefinition['objectType']) ?? '',
          valueType: m[3] as DbcAttributeDefinition['valueType'],
        };
        const rest = m[4].trim();
        if (def.valueType === 'ENUM') {
          def.enumValues = [...rest.matchAll(/"([^"]*)"/g)].map((e) => unescapeString(e[1]));
        } else if (def.valueType !== 'STRING' && rest !== '') {
          const nums = rest.split(/[\s,]+/).filter((t) => t !== '');
          if (nums.length >= 2) {
            def.min = parseFloat(nums[0]);
            def.max = parseFloat(nums[1]);
          }
        }
        db.attributeDefinitions.push(def);
        continue;
      }

      case 'BA_DEF_DEF_': {
        const m = line.match(/^BA_DEF_DEF_\s+"([^"]+)"\s+([\s\S]*?);?\s*$/);
        if (!m) {
          problem(stmt, 'malformed BA_DEF_DEF_');
          continue;
        }
        const def = db.attributeDefinitions.find((d) => d.name === m[1]);
        if (def) def.defaultValue = resolveAttrValue(def, parseAttrValueToken(m[2]));
        continue;
      }

      case 'BA_': {
        const def = (name: string) => db.attributeDefinitions.find((d) => d.name === name);
        let m = line.match(/^BA_\s+"([^"]+)"\s+BU_\s+(\w+)\s+([\s\S]*?);?\s*$/);
        if (m) {
          const node = nodesByName.get(m[2]);
          if (node) node.attributes[m[1]] = resolveAttrValue(def(m[1]), parseAttrValueToken(m[3]));
          else problem(stmt, 'BA_ BU_ references unknown node');
          continue;
        }
        m = line.match(/^BA_\s+"([^"]+)"\s+BO_\s+(\d+)\s+([\s\S]*?);?\s*$/);
        if (m) {
          const msg = findMessage(parseInt(m[2], 10));
          if (msg) msg.attributes[m[1]] = resolveAttrValue(def(m[1]), parseAttrValueToken(m[3]));
          else problem(stmt, 'BA_ BO_ references unknown message id');
          continue;
        }
        m = line.match(/^BA_\s+"([^"]+)"\s+SG_\s+(\d+)\s+(\w+)\s+([\s\S]*?);?\s*$/);
        if (m) {
          const sig = findSignal(parseInt(m[2], 10), m[3]);
          if (sig) sig.attributes[m[1]] = resolveAttrValue(def(m[1]), parseAttrValueToken(m[4]));
          else problem(stmt, 'BA_ SG_ references unknown signal');
          continue;
        }
        m = line.match(/^BA_\s+"([^"]+)"\s+EV_\s+/);
        if (m) {
          skip('BA_ EV_');
          continue;
        }
        m = line.match(/^BA_\s+"([^"]+)"\s+([\s\S]*?);?\s*$/);
        if (m) {
          db.attributes[m[1]] = resolveAttrValue(def(m[1]), parseAttrValueToken(m[2]));
          continue;
        }
        problem(stmt, 'malformed BA_');
        continue;
      }

      default:
        break;
    }

    if (SKIPPED_KEYWORDS.includes(keyword)) {
      skip(keyword);
    } else {
      problem(stmt, `unrecognized statement${keyword ? ` "${keyword}"` : ''}`);
    }
  }

  return db;
}

/** ENUM attribute values are stored as index numbers in BA_; resolve to the enum label. */
function resolveAttrValue(def: DbcAttributeDefinition | undefined, value: AttrValue): AttrValue {
  if (
    def?.valueType === 'ENUM' &&
    typeof value === 'number' &&
    Number.isInteger(value) &&
    def.enumValues &&
    value >= 0 &&
    value < def.enumValues.length
  ) {
    return def.enumValues[value];
  }
  return value;
}
