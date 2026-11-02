// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseDbc } from './parser';
import { findMessageByOccurrence, occurrenceOf } from './identity';

const db = parseDbc(
  [
    'VERSION ""',
    'BU_: A',
    'BO_ 5 First: 8 A',
    ' SG_ S : 0|8@1+ (1,0) [0|255] "" A',
    'BO_ 6 Other: 8 A',
    ' SG_ T : 0|8@1+ (1,0) [0|255] "" A',
    'BO_ 5 Second: 8 A',
    ' SG_ U : 0|8@1+ (1,0) [0|255] "" A',
    '',
  ].join('\n'),
);

describe('message identity with duplicate ids', () => {
  it('numbers the messages sharing a raw id in file order', () => {
    const [first, other, second] = db.messages;
    expect([first.name, other.name, second.name]).toEqual(['First', 'Other', 'Second']);
    expect(occurrenceOf(db, first)).toBe(0);
    expect(occurrenceOf(db, other)).toBe(0);
    expect(occurrenceOf(db, second)).toBe(1);
    // Asking again uses the cached numbering and gives the same answer.
    expect(occurrenceOf(db, second)).toBe(1);
  });

  it('finds a message by raw id and occurrence', () => {
    expect(findMessageByOccurrence(db, 5, 0)?.name).toBe('First');
    expect(findMessageByOccurrence(db, 5, 1)?.name).toBe('Second');
    expect(findMessageByOccurrence(db, 5, 2)).toBeUndefined();
    expect(findMessageByOccurrence(db, 7, 0)).toBeUndefined();
  });

  it('gives 0 for a message that is not in the database', () => {
    const stranger = { ...db.messages[0] };
    expect(occurrenceOf(db, stranger)).toBe(0);
  });
});
