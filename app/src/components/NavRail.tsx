// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useId, useRef, useState } from 'react';
import { listKeyTarget } from '../lib/keyboard';
import { useI18n, type Lang, type MsgKey } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';
import type { IconName } from './icon-paths';
import { useMediaQuery } from './useMediaQuery';

export type Destination = 'overview' | 'messages' | 'network' | 'nodes' | 'tables' | 'compare' | 'traces';

const DESTINATIONS: Array<{ key: Destination; label: MsgKey; icon: IconName; filled: IconName }> = [
  { key: 'overview', label: 'railOverview', icon: 'dashboard', filled: 'dashboard_fill' },
  { key: 'messages', label: 'railMessages', icon: 'list_alt', filled: 'list_alt_fill' },
  { key: 'network', label: 'railNetwork', icon: 'hub', filled: 'hub_fill' },
  { key: 'nodes', label: 'railNodes', icon: 'memory', filled: 'memory_fill' },
  { key: 'tables', label: 'railTables', icon: 'table_rows', filled: 'table_rows_fill' },
  { key: 'compare', label: 'difRail', icon: 'difference', filled: 'difference_fill' },
  { key: 'traces', label: 'trcRail', icon: 'receipt_long', filled: 'receipt_long_fill' },
];

const LANGUAGES: Array<[Lang, string]> = [
  ['en', 'English'],
  ['de', 'Deutsch'],
];

/**
 * Material 3 navigation rail: the settings menu (language, close file, About),
 * the "open file" FAB, the seven destinations and the theme toggle. Below
 * 600 px it becomes a navigation bar at the bottom and a top bar (narrow.css).
 */
export function NavRail({
  active,
  enabled,
  badges,
  onNavigate,
  onOpenFile,
  onCloseFile,
  onAbout,
  actions,
}: {
  active: Destination | null;
  enabled: Record<Destination, boolean>;
  badges: Partial<Record<Destination, number>>;
  onNavigate: (d: Destination) => void;
  onOpenFile: () => void;
  /** Close the open file and forget the stored copy; only while a file is open. */
  onCloseFile?: () => void;
  /** Show the About dialog. */
  onAbout: () => void;
  /** More file actions under the open-file button (Save as DBC). */
  actions?: React.ReactNode;
}) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const languageHeading = useId();
  // In the top bar (below 600 px, the breakpoint in narrow.css) the theme toggle
  // sits beside the menu and open buttons, so it follows them in the focus order
  // as well; in the rail it stays at the bottom, after the destinations.
  const compact = useMediaQuery('(max-width: 599px)');

  // Menu keyboard pattern: opening focuses the checked item, the arrow keys,
  // Home and End move between the items, Escape and Tab close the menu.
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];
  useEffect(() => {
    if (menuOpen) (items().find((i) => i.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus();
  }, [menuOpen]);
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') return setMenuOpen(false);
    const list = items();
    const next = listKeyTarget(e.key, list.indexOf(document.activeElement as HTMLElement), list.length);
    if (next === null) return;
    e.preventDefault();
    list[next].focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  // The focus moved to an element outside the menu, e.g. "/" focused the search:
  // close the menu. Without a related target the focus went nowhere, as on a
  // click in Safari, which does not focus the button clicked; the mousedown and
  // click handlers decide then.
  const onMenuBlur = (e: React.FocusEvent) => {
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false);
  };

  const themeButton = (
    <button
      className="rail-icon-btn state"
      title={theme === 'dark' ? t('themeToLight') : t('themeToDark')}
      aria-label={theme === 'dark' ? t('themeToLight') : t('themeToDark')}
      onClick={toggle}
    >
      <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
    </button>
  );

  return (
    <nav className="rail" aria-label="CanViewer">
      <div ref={menuRef} onBlur={onMenuBlur}>
        <button
          ref={menuButtonRef}
          className="rail-icon-btn state"
          title={t('settings')}
          aria-label={t('settings')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name="menu" />
        </button>
        {menuOpen && (
          <div className="menu-popover" role="menu" aria-label={t('settings')} onKeyDown={onMenuKeyDown}>
            {/* A menu may only hold items and groups: the heading names the group. */}
            <div role="group" aria-labelledby={languageHeading}>
              <h3 id={languageHeading} aria-hidden="true">
                {t('language')}
              </h3>
              {LANGUAGES.map(([code, name]) => (
                <button
                  key={code}
                  role="menuitemradio"
                  aria-checked={lang === code}
                  tabIndex={-1}
                  className="menu-item state"
                  onClick={() => {
                    setLang(code);
                    setMenuOpen(false);
                    menuButtonRef.current?.focus();
                  }}
                >
                  <Icon name="translate" size={20} />
                  {name}
                  {lang === code && <Icon name="check" size={20} className="trail" />}
                </button>
              ))}
            </div>
            <div className="menu-divider" role="separator" />
            {onCloseFile && (
              <button
                role="menuitem"
                tabIndex={-1}
                className="menu-item state"
                onClick={() => {
                  setMenuOpen(false);
                  menuButtonRef.current?.focus();
                  onCloseFile();
                }}
              >
                <Icon name="close" size={20} />
                {t('closeFile')}
              </button>
            )}
            <button
              role="menuitem"
              tabIndex={-1}
              className="menu-item state"
              onClick={() => {
                setMenuOpen(false);
                menuButtonRef.current?.focus();
                onAbout();
              }}
            >
              <Icon name="info" size={20} />
              {t('abtMenu')}
            </button>
          </div>
        )}
      </div>

      <button className="rail-fab state" title={t('openFile')} aria-label={t('openFile')} onClick={onOpenFile}>
        <Icon name="upload_file" />
      </button>
      {actions}
      {compact && themeButton}

      {DESTINATIONS.map((d) => {
        const isActive = active === d.key;
        const badge = badges[d.key];
        return (
          <button
            key={d.key}
            className={`rail-item ${isActive ? 'active' : ''}`}
            disabled={!enabled[d.key]}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onNavigate(d.key)}
          >
            <span className="pill state">
              <Icon name={isActive ? d.filled : d.icon} />
              {badge ? <span className="rail-badge">{badge > 999 ? '999+' : badge}</span> : null}
            </span>
            <span className="label">{t(d.label)}</span>
          </button>
        );
      })}

      <div className="rail-spacer" />
      {!compact && themeButton}
    </nav>
  );
}
