import type { AttrValue } from '../lib/dbc/types';
import { useFocusableWhenScrolling } from './useFocusableWhenScrolling';

export function AttributesCard({
  title,
  attributes,
}: {
  title: string;
  attributes: Record<string, AttrValue>;
}) {
  const entries = Object.entries(attributes);
  const scrollable = useFocusableWhenScrolling<HTMLDivElement>();
  if (entries.length === 0) return null;
  return (
    <div className="card table-card" ref={scrollable}>
      <h2>{title}</h2>
      <table className="m3">
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name}>
              <td className="strong" style={{ width: '40%' }}>
                {name}
              </td>
              <td className="mono">{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
