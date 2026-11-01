import { describe, expect, it } from 'vitest';
import { MESSAGE_PAGE_SIZE, messagePageSize, pageOf } from './pages';

describe('pageOf', () => {
  it('splits rows into pages of the given size, the last one shorter', () => {
    expect(pageOf(5000, 200, 0)).toEqual({ page: 0, pages: 25, start: 0, end: 200 });
    expect(pageOf(5000, 200, 24)).toEqual({ page: 24, pages: 25, start: 4800, end: 5000 });
    expect(pageOf(1001, 200, 5)).toEqual({ page: 5, pages: 6, start: 1000, end: 1001 });
  });

  it('clamps a page outside the pages there are', () => {
    expect(pageOf(1001, 200, 99).page).toBe(5);
    expect(pageOf(1001, 200, -3).page).toBe(0);
    expect(pageOf(1001, 200, Number.NaN).page).toBe(0);
    // A smaller database with the page of a larger one shows its last page.
    expect(pageOf(300, 200, 24)).toEqual({ page: 1, pages: 2, start: 200, end: 300 });
  });

  it('has one empty page for no rows, and one page when everything fits', () => {
    expect(pageOf(0, 200, 0)).toEqual({ page: 0, pages: 1, start: 0, end: 0 });
    expect(pageOf(1000, 1000, 0)).toEqual({ page: 0, pages: 1, start: 0, end: 1000 });
  });
});

describe('messagePageSize', () => {
  it('shows every message up to 1000 and 200 a page above, like the list virtualizes', () => {
    expect(MESSAGE_PAGE_SIZE).toBe(200);
    expect(messagePageSize(0)).toBe(1);
    expect(messagePageSize(9)).toBe(9);
    expect(messagePageSize(1000)).toBe(1000);
    expect(messagePageSize(1001)).toBe(200);
    expect(messagePageSize(5000)).toBe(200);
  });
});
