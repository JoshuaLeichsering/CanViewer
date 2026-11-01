import type { DbcMessage, DbcSignal } from '../dbc/types';

/**
 * Turning DBC names into C identifiers. DBC names are meant to be C
 * identifiers already, but files in the wild (and formats imported through
 * canmatrix) carry dots, dashes, umlauts, leading digits, C keywords and
 * duplicate signal names. A name that cannot be used as is changes as little
 * as possible, and the generated code keeps the original in a comment.
 */

/** C keywords up to C23, and the C++ alternative tokens (pseudo-code uses `and`/`or`). */
const C_KEYWORDS = new Set([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return',
  'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void',
  'volatile', 'while', 'alignas', 'alignof', 'bool', 'constexpr', 'false', 'nullptr', 'static_assert',
  'thread_local', 'true', 'typeof', 'typeof_unqual', '_Alignas', '_Alignof', '_Atomic', '_BitInt',
  '_Bool', '_Complex', '_Decimal128', '_Decimal32', '_Decimal64', '_Generic', '_Imaginary',
  '_Noreturn', '_Static_assert', '_Thread_local',
]);

/**
 * Names that <stdint.h> or the compiler itself defines as macros (GCC's GNU
 * modes predefine `linux`, `unix` and `i386`) or as types: a member with one
 * of these names would be expanded or misread.
 */
const RESERVED = [
  /^U?INT(?:_LEAST|_FAST)?(?:8|16|32|64)_(?:MIN|MAX|C|WIDTH)$/,
  /^U?INT(?:MAX|PTR)_(?:MIN|MAX|C|WIDTH)$/,
  /^(?:SIZE|PTRDIFF|SIG_ATOMIC|WCHAR|WINT)_(?:MIN|MAX|WIDTH)$/,
  /^u?int(?:_least|_fast)?(?:8|16|32|64)_t$/,
  /^u?int(?:max|ptr)_t$/,
  /^(?:linux|unix|i386|NULL|size_t|wchar_t|ptrdiff_t)$/,
];

/** A valid C identifier for `name` that avoids keywords, reserved names and `avoid`. */
export function cIdentifier(name: string, avoid: ReadonlySet<string> = new Set()): string {
  let id = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (id === '') id = 'unnamed';
  // A leading digit is not allowed; `__x` and `_X` are reserved for the implementation.
  if (/^(?:[0-9]|__|_[A-Z])/.test(id)) id = 'x' + id;
  while (C_KEYWORDS.has(id) || RESERVED.some((r) => r.test(id)) || avoid.has(id)) id += '_';
  return id;
}

/**
 * Unique identifiers for a message's signals, in signal order. A name taken
 * by an earlier signal gets `_2`, `_3`, … (malformed files repeat names).
 */
export function signalIdentifiers(signals: DbcSignal[], avoid: ReadonlySet<string> = new Set()): string[] {
  const taken = new Set(avoid);
  return signals.map((signal) => {
    const base = cIdentifier(signal.name, avoid);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = cIdentifier(`${base}_${n}`, avoid);
    taken.add(id);
    return id;
  });
}

/** Identifier for the message itself: the struct is `<id>_t`, the macros `<ID>_…`. */
export function messageIdentifier(message: Pick<DbcMessage, 'name'>): string {
  let id = cIdentifier(message.name);
  // The struct type and the macros are file-scope names, and there every name
  // that starts with an underscore is reserved (C99 7.1.3); the upper-cased
  // macros would also start with `_X`, which is reserved everywhere.
  if (id.startsWith('_')) id = 'x' + id;
  // `<id>_t` must not redefine a <stdint.h> type (a message named `uint8`).
  while (RESERVED.some((r) => r.test(`${id}_t`))) id += '_';
  return id;
}
