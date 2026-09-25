import { forwardRef } from 'react';

export const cx = (...c) => c.filter(Boolean).join(' ');

const BADGE_TONES = {
  success: 'bg-success-light text-success-dark',
  warning: 'bg-warning-light text-warning-dark',
  danger: 'bg-danger-light text-danger-dark',
  info: 'bg-info-light text-info-dark',
  primary: 'bg-[#cfe2ff] text-primary-dark',
  secondary: 'bg-neutral-light text-neutral-dark',
  purple: 'bg-purple-light text-purple',
  orange: 'bg-orange-light text-orange-dark',
  dark: 'bg-[#d3d3d4] text-[#1a1e21]',
};

/** Tinted text colours per tone (for buttons / icons that sit on a tone background). */
export const TONE_TEXT = {
  success: 'text-success-dark', warning: 'text-warning-dark', danger: 'text-danger-dark',
  info: 'text-info-dark', primary: 'text-primary-dark', secondary: 'text-neutral-dark',
  purple: 'text-purple', orange: 'text-orange-dark',
};
export const TONE_BG = {
  success: 'bg-success-light', warning: 'bg-warning-light', danger: 'bg-danger-light',
  info: 'bg-info-light', primary: 'bg-primary-light', secondary: 'bg-neutral-light',
  purple: 'bg-purple-light', orange: 'bg-orange-light',
};

export function Badge({ tone = 'secondary', className, children, ...rest }) {
  return (
    <span
      className={cx(
        'inline-flex animate-fade-up items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize tracking-wide',
        BADGE_TONES[tone] ?? BADGE_TONES.secondary,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

const BTN_VARIANTS = {
  primary: 'border-transparent bg-primary text-white hover:bg-primary-hover',
  secondary: 'bg-canvas text-ink border-line hover:border-primary hover:text-primary',
  ghost: 'border-transparent bg-transparent text-subtle hover:bg-hover hover:text-ink',
  outline: 'bg-transparent text-primary border-primary hover:bg-primary-light',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors duration-150',
        'focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-60',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-sm',
        BTN_VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
});

export const inputCls =
  'w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-faint transition focus:border-primary focus:shadow-focus focus:outline-none disabled:opacity-70';

export const labelCls = 'text-xs font-medium text-subtle';

/** Uppercase muted section heading used across panels. */
export function SectionTitle({ className, children, ...rest }) {
  return (
    <h2 className={cx('text-xs font-semibold uppercase tracking-[0.08em] text-subtle', className)} {...rest}>
      {children}
    </h2>
  );
}

export function Card({ className, children, ...rest }) {
  return (
    <section className={cx('rounded-xl border border-line bg-white p-4 shadow-sm', className)} {...rest}>
      {children}
    </section>
  );
}

export function Kicker({ children }) {
  return <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-primary">{children}</span>;
}

export function ErrorBanner({ children }) {
  if (!children) return null;
  return (
    <div className="mb-3 rounded-md border border-danger bg-danger-light px-4 py-2 text-sm text-danger-dark" role="alert">
      {children}
    </div>
  );
}

export function Skeleton({ className, style }) {
  return <span className={cx('skeleton', className)} style={style} />;
}

/** Page title block used at the top of every workspace. */
export function PageHeader({ step, title, description, actions }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {step && <Kicker>{step}</Kicker>}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function StatCard({ label, value, hint, accent = '#0d6efd', icon: Icon, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'flex animate-fade-up items-start gap-3 rounded-xl border border-line bg-white p-4 text-left shadow-sm transition',
        onClick && 'hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      {Icon && (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: `${accent}1f`, color: accent }}>
          <Icon />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-2xl font-bold tabular-nums text-ink">{value}</span>
        <span className="block text-xs font-medium uppercase tracking-wider text-subtle">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-faint">{hint}</span>}
      </span>
    </Tag>
  );
}

/** Horizontal bar 0–1 with a label and percentage. */
export function Meter({ label, value, color, suffix }) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs">
        <span className="text-subtle">{label}</span>
        <span className="font-semibold tabular-nums text-ink">{suffix ?? `${Math.round(v * 100)}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line-light">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${v * 100}%`, background: color }} />
      </div>
    </div>
  );
}

/** Inline success / error line that fades in. */
export function Notice({ tone = 'success', children }) {
  if (!children) return null;
  const cls = { success: 'bg-success-light text-success-dark', danger: 'bg-danger-light text-danger-dark', info: 'bg-primary-light text-primary-dark', warning: 'bg-warning-light text-warning-dark' }[tone];
  return <p role="status" className={cx('animate-scale-in rounded-md px-3 py-2 text-xs', cls)}>{children}</p>;
}

export const selectCls =
  'rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-primary focus:shadow-focus focus:outline-none';

export const th = 'sticky top-0 z-10 bg-canvas px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-subtle';
export const td = 'px-3 py-2 align-middle';
