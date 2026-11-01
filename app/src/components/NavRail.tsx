import { useEffect, useRef, useState } from 'react';
import { useI18n, type Lang, type MsgKey } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';
import type { IconName } from './icon-paths';

export type Destination = 'overview' | 'messages' | 'network' | 'nodes' | 'tables';

const DESTINATIONS: Array<{ key: Destination; label: MsgKey; icon: IconName; filled: IconName }> = [
  { key: 'overview', label: 'railOverview', icon: 'dashboard', filled: 'dashboard_fill' },
  { key: 'messages', label: 'railMessages', icon: 'list_alt', filled: 'list_alt_fill' },
  { key: 'network', label: 'railNetwork', icon: 'hub', filled: 'hub_fill' },
  { key: 'nodes', label: 'railNodes', icon: 'memory', filled: 'memory_fill' },
  { key: 'tables', label: 'railTables', icon: 'table_rows', filled: 'table_rows_fill' },
];

const LANGUAGES: Array<[Lang, string]> = [
  ['en', 'English'],
  ['de', 'Deutsch'],
];

/**
 * Material 3 navigation rail: settings menu, the "open file" FAB, the five
 * destinations and the theme toggle.
 */
export function NavRail({
  active,
  enabled,
  badges,
  onNavigate,
  onOpenFile,
  actions,
}: {
  active: Destination | null;
  enabled: Record<Destination, boolean>;
  badges: Partial<Record<Destination, number>>;
  onNavigate: (d: Destination) => void;
  onOpenFile: () => void;
  /** More file actions under the open-file button (Save as DBC). */
  actions?: React.ReactNode;
}) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  return (
    <nav className="rail" aria-label="CanViewer">
      <div ref={menuRef}>
        <button
          className="rail-icon-btn state"
          title={t('settings')}
          aria-label={t('settings')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name="menu" />
        </button>
        {menuOpen && (
          <div className="menu-popover" role="menu">
            <h3>{t('language')}</h3>
            {LANGUAGES.map(([code, name]) => (
              <button
                key={code}
                role="menuitemradio"
                aria-checked={lang === code}
                className="menu-item state"
                onClick={() => {
                  setLang(code);
                  setMenuOpen(false);
                }}
              >
                <Icon name="translate" size={20} />
                {name}
                {lang === code && <Icon name="check" size={20} className="trail" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="rail-fab state" title={t('openFile')} aria-label={t('openFile')} onClick={onOpenFile}>
        <Icon name="upload_file" />
      </button>
      {actions}

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
      <button
        className="rail-icon-btn state"
        title={theme === 'dark' ? t('themeToLight') : t('themeToDark')}
        aria-label={theme === 'dark' ? t('themeToLight') : t('themeToDark')}
        onClick={toggle}
      >
        <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
      </button>
    </nav>
  );
}
