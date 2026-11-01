// SPDX-License-Identifier: GPL-2.0-or-later
import { useMemo } from 'react';
import type { DbcDatabase, DbcValueTable } from '../lib/dbc/types';
import type { Selection } from '../App';
import { occurrenceOf } from '../lib/dbc/identity';
import { useI18n } from '../lib/i18n';
import { Icon } from './Icon';
import { useFocusableWhenScrolling } from './useFocusableWhenScrolling';

/** A value map as a canonical string, so equal maps compare equal. */
const canonical = (values: Record<number, string>) =>
  JSON.stringify(
    Object.entries(values)
      .map(([raw, label]) => [Number(raw), label] as const)
      .sort((a, b) => a[0] - b[0]),
  );

export function ValueTableDetail({
  db,
  fileName,
  table,
  onSelect,
}: {
  db: DbcDatabase;
  fileName: string;
  table: DbcValueTable;
  onSelect: (s: Selection) => void;
}) {
  const { t } = useI18n();
  const scrollable = useFocusableWhenScrolling<HTMLDivElement>();
  const rows = Object.entries(table.values)
    .map(([raw, label]) => [Number(raw), label] as const)
    .sort((a, b) => a[0] - b[0]);

  // DBC files do not record which signals use a VAL_TABLE_; signals whose own
  // VAL_ is identical are the best available back-reference.
  const usedBy = useMemo(() => {
    const key = canonical(table.values);
    return db.messages.flatMap((message) =>
      message.signals
        .filter((s) => s.values && Object.keys(s.values).length > 0 && canonical(s.values) === key)
        .map((signal) => ({ message, signal })),
    );
  }, [db, table]);

  return (
    <div>
      <header className="page-header">
        <div className="overline">{t('tableOverline', { file: fileName })}</div>
        <h1>{table.name}</h1>
      </header>
      <div className="row">
        <div className="card table-card" ref={scrollable} style={{ flex: '1 1 420px', maxWidth: 640 }}>
          <table className="m3">
            <thead>
              <tr>
                <th className="num" style={{ width: 90 }}>
                  {t('thRaw')}
                </th>
                <th className="num" style={{ width: 90 }}>
                  {t('thHex')}
                </th>
                <th>{t('thMeaning')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([raw, label]) => (
                <tr key={raw}>
                  <td className="num">{raw}</td>
                  <td className="num muted">
                    {raw >= 0 ? '0x' + raw.toString(16).toUpperCase().padStart(2, '0') : ''}
                  </td>
                  <td>{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {usedBy.length > 0 && (
          <div className="card" style={{ flex: '0 1 320px' }}>
            <div className="card-overline neutral">{t('usedByTitle')}</div>
            <div className="used-by">
              {usedBy.map(({ message, signal }) => (
                <button
                  key={`${message.rawId}.${occurrenceOf(db, message)}/${signal.name}`}
                  className="assist-chip state"
                  onClick={() =>
                    onSelect({ kind: 'message', rawId: message.rawId, occ: occurrenceOf(db, message), signal: signal.name })
                  }
                >
                  <Icon name="sensors" size={18} />
                  {message.name}.{signal.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
