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
