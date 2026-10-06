import { useState } from 'react';

/**
 * Minimal single-series charts (one hue, so no legend box: the card title names
 * the series). Thin bars with 4px rounded data-ends, recessive grid, a hover
 * tooltip per bar and an accessible table fallback via <details>.
 */
export function ColumnChart({ data, valueKey, labelKey, format = (v) => v, height = 180, ariaLabel }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <figure aria-label={ariaLabel}>
      <div className="relative" style={{ height }}>
        {[0.5, 1].map((f) => (
          <div key={f} className="absolute inset-x-0 border-t border-dashed border-slate-200" style={{ bottom: `${f * 100}%` }}>
            <span className="absolute -top-2.5 right-0 bg-white pl-1 text-[0.65rem] text-slate-400">{format(Math.round(max * f * 10) / 10)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px] border-b border-slate-300 pr-8">
          {data.map((d, i) => (
            <div
              key={d[labelKey]}
              className="group relative flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className="w-full max-w-7 rounded-t-[4px] bg-brand-600 transition group-hover:bg-brand-800"
                style={{ height: `${(d[valueKey] / max) * 100}%`, minHeight: d[valueKey] > 0 ? 2 : 0 }}
              />
              {hover === i && (
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow">
                  {d[labelKey]}: <strong>{format(d[valueKey])}</strong>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-[2px] pr-8 text-[0.65rem] text-slate-500">
        {data.map((d, i) => (
          <span key={d[labelKey]} className="flex-1 truncate text-center">
            {data.length > 14 && i % Math.ceil(data.length / 10) !== 0 ? '' : d[labelKey]}
          </span>
        ))}
      </div>
      <DataTable data={data} columns={[[labelKey, ''], [valueKey, '', format]]} />
    </figure>
  );
}

export function BarList({ data, valueKey, labelKey, format = (v) => v, max: fixedMax, detail }) {
  const max = fixedMax || Math.max(1, ...data.map((d) => d[valueKey]));
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d[labelKey]} title={`${d[labelKey]}: ${format(d[valueKey])}`}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{d[labelKey]}</span>
            <span className="shrink-0 font-medium text-slate-900">
              {format(d[valueKey])}
              {detail && <span className="ml-1 font-normal text-slate-500">{detail(d)}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (d[valueKey] / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DataTable({ data, columns }) {
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer">View as table</summary>
      <table className="mt-1 w-full text-left">
        <tbody>
          {data.map((d) => (
            <tr key={d[columns[0][0]]} className="border-t border-slate-100">
              {columns.map(([key, , fmt]) => (
                <td key={key} className="py-0.5">
                  {fmt ? fmt(d[key]) : d[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
