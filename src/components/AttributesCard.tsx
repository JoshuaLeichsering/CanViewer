import type { AttrValue } from '../lib/dbc/types';

export function AttributesCard({
  title,
  attributes,
}: {
  title: string;
  attributes: Record<string, AttrValue>;
}) {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return null;
  return (
    <div className="card">
      <h3>{title}</h3>
      <table className="grid">
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name}>
              <td style={{ width: '50%' }}>{name}</td>
              <td className="mono">{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
