import { useEffect, useRef, useState } from 'react';
import { useI18n, type Lang } from '../lib/i18n';

export function SettingsMenu() {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="settings-menu" ref={ref}>
      <button
        className="btn"
        title={t('settings')}
        aria-label={t('settings')}
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {open && (
        <div className="settings-popover">
          <label htmlFor="lang-select">{t('language')}</label>
          <select
            id="lang-select"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </div>
      )}
    </div>
  );
}
