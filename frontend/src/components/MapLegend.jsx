import { cx } from './ui';

/** Colour swatch list for legends. */
export default function Legend({ title, items }) {
  return (
    <>
      {title && <div className="mb-1.5 font-semibold uppercase tracking-wider text-subtle">{title}</div>}
      <ul className="flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2 text-ink">
            <span
              className={cx('size-3 shrink-0 ring-1 ring-black/10', it.shape === 'point' ? 'rounded-full' : it.shape === 'line' ? 'h-0.5 w-3.5 rounded-none' : 'rounded-[3px]')}
              style={{ background: it.color }}
            />
            {it.label}
          </li>
        ))}
      </ul>
    </>
  );
}
