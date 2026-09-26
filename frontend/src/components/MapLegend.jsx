import { cx } from './ui';

/** Colour swatch list for legends. */
export default function Legend({ title, items }) {
  return (
    <>
      {title && <div className="mb-1 font-semibold text-ink">{title}</div>}
      <ul className="flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2 text-ink">
            <span
              className={cx('size-2.5 shrink-0 ring-1 ring-black/15', it.shape === 'point' ? 'rounded-full' : it.shape === 'line' ? 'h-0.5 w-3.5 rounded-none' : 'rounded-[1px]')}
              style={{ background: it.color }}
            />
            {it.label}
          </li>
        ))}
      </ul>
    </>
  );
}
