import { useState } from 'react';
import { useI18n, type MsgKey } from '../lib/i18n';
import { pageOf, type Page } from '../lib/pages';
import type { IconName } from './icon-paths';
import { Icon } from './Icon';
import './TablePager.css';

/** The page last shown for each table source (a database), kept while the table is not shown. */
const remembered = new WeakMap<object, number>();

export interface PageState extends Page {
  setPage: (page: number) => void;
}

/**
 * The page of a long table to show. The page is remembered for `source` (the
 * database), so a table that is shown again, after a message was opened from
 * it, comes back on the same page; another source starts on the first page.
 */
export function usePage(total: number, size: number, source: object): PageState {
  const [, rerender] = useState(0);
  const page = pageOf(total, size, remembered.get(source) ?? 0);
  return {
    ...page,
    setPage: (next: number) => {
      remembered.set(source, pageOf(total, size, next).page);
      rerender((n) => n + 1);
    },
  };
}

/**
 * First, previous, next and last page buttons with the range shown, as in
 * Material's data table pagination. The buttons at an end are marked
 * aria-disabled rather than disabled, so a button keeps the keyboard focus
 * when it reaches the end; the range is announced when it changes.
 */
export function TablePager({ pager, total, label }: { pager: PageState; total: number; label: string }) {
  const { t } = useI18n();
  const { page, pages, start, end, setPage } = pager;
  const buttons: Array<[IconName, MsgKey, number]> = [
    ['first_page', 'tblFirstPage', 0],
    ['chevron_left', 'tblPrevPage', page - 1],
    ['chevron_right', 'tblNextPage', page + 1],
    ['last_page', 'tblLastPage', pages - 1],
  ];
  return (
    <div className="tbl-pager" role="group" aria-label={label} data-testid="tbl-pager">
      <span className="tbl-pager-range" aria-live="polite">
        {t('tblPageRange', { from: total === 0 ? 0 : start + 1, to: end, total })}
      </span>
      {buttons.map(([icon, key, target]) => {
        const disabled = target < 0 || target >= pages || target === page;
        return (
          <button
            key={key}
            type="button"
            className="tbl-pager-btn state"
            title={t(key)}
            aria-label={t(key)}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) setPage(target);
            }}
          >
            <Icon name={icon} size={20} />
          </button>
        );
      })}
    </div>
  );
}
