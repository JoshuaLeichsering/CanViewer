import type { DbcValueTable } from '../lib/dbc/types';
import { useI18n } from '../lib/i18n';

export function ValueTableDetail({ table }: { table: DbcValueTable }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="card">
        <div className="detail-header">
          <h1>{table.name}</h1>
          <span className="pill node">{t('pillValueTable')}</span>
        </div>
      </div>
      <div className="card">
        <table className="grid">
          <thead>
            <tr>
              <th className="num">{t('thRawValue')}</th>
              <th>{t('thMeaning')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(table.values)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([raw, label]) => (
                <tr key={raw}>
                  <td className="num" style={{ width: 100 }}>
                    {raw}
                  </td>
                  <td>{label}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
