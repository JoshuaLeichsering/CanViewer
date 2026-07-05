import type { DbcValueTable } from '../lib/dbc/types';

export function ValueTableDetail({ table }: { table: DbcValueTable }) {
  return (
    <div>
      <div className="card">
        <div className="detail-header">
          <h1>{table.name}</h1>
          <span className="pill node">Value table</span>
        </div>
      </div>
      <div className="card">
        <table className="grid">
          <thead>
            <tr>
              <th className="num">Raw value</th>
              <th>Meaning</th>
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
