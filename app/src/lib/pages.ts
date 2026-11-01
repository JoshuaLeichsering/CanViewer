// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Paging for a table too long to render at once: the Overview's message table
 * of a database with more than 1000 messages shows 200 messages at a time, the
 * same limit as the message list's virtualization. Kept free of React so it
 * can be tested.
 */
import { shouldVirtualize } from './virtual-window';

/** Rows per page of the Overview's message table above 1000 messages. */
export const MESSAGE_PAGE_SIZE = 200;

export interface Page {
  /** The page shown, from 0. */
  page: number;
  /** Number of pages, at least 1. */
  pages: number;
  /** First row of the page. */
  start: number;
  /** One past the last row of the page. */
  end: number;
}

/** Page `page` of `total` rows at `size` rows a page, clamped to the pages there are. */
export function pageOf(total: number, size: number, page: number): Page {
  const rows = Math.max(0, total);
  const perPage = Math.max(1, Math.floor(size));
  const pages = Math.max(1, Math.ceil(rows / perPage));
  const shown = Number.isFinite(page) ? Math.min(Math.max(0, Math.floor(page)), pages - 1) : 0;
  return { page: shown, pages, start: shown * perPage, end: Math.min(rows, (shown + 1) * perPage) };
}

/** Rows per page of the Overview's message table: every message up to 1000 of them. */
export function messagePageSize(messageCount: number): number {
  return shouldVirtualize(messageCount) ? MESSAGE_PAGE_SIZE : Math.max(1, messageCount);
}
