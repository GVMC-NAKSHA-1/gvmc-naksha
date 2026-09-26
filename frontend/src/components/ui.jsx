import { forwardRef } from 'react';
import { useLocation } from 'react-router-dom';
import { FiAlertCircle, FiChevronRight, FiInfo } from 'react-icons/fi';
import { STEPS, navFor } from './nav';

export const cx = (...c) => c.filter(Boolean).join(' ');

/** Status dot colour per tone. */
const DOT_TONES = {
  success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info', primary: 'bg-primary',
  secondary: 'bg-faint', purple: 'bg-purple', orange: 'bg-orange', dark: 'bg-ink',
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

/** Status label: a small coloured dot plus plain text — reads like a status column, not a sticker. */
export function Badge({ tone = 'secondary', className, children, ...rest }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium capitalize text-ink', className)} {...rest}>
      <span className={cx('size-1.5 shrink-0 rounded-full', DOT_TONES[tone] ?? DOT_TONES.secondary)} aria-hidden="true" />
      {children}
    </span>
  );
}

const BTN_VARIANTS = {
  primary: 'border-primary bg-primary text-white hover:bg-primary-hover',
  secondary: 'border-line bg-white text-ink hover:border-faint hover:bg-hover',
  ghost: 'border-transparent bg-transparent text-subtle hover:bg-hover hover:text-ink',
  outline: 'border-primary bg-white text-primary hover:bg-primary-light',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // Icon-only buttons carry an aria-label; surface it as a hover tooltip too.
      title={rest.title ?? rest['aria-label']}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors duration-100',
        'focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
        BTN_VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
});

export const inputCls =
  'w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-primary focus:shadow-focus focus:outline-none disabled:bg-canvas disabled:opacity-70';

export const labelCls = 'text-xs font-medium text-subtle';

/** Panel / section heading. */
export function SectionTitle({ className, children, ...rest }) {
  return (
    <h2 className={cx('text-sm font-semibold text-ink', className)} {...rest}>
      {children}
    </h2>
  );
}

/** Bordered panel. Flat: no shadow, square-ish corners. */
export function Card({ className, children, ...rest }) {
  return (
    <section className={cx('rounded-md border border-line bg-white p-4', className)} {...rest}>
      {children}
    </section>
  );
}

/** Panel with a title bar (toolbar-style header) and an unpadded body — for tables, maps and lists. */
export function Panel({ title, actions, className, bodyClassName, children, ...rest }) {
  return (
    <section className={cx('flex min-w-0 flex-col rounded-md border border-line bg-white', className)} {...rest}>
      <header className="flex min-h-10 flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-3 py-1.5">
        <SectionTitle className="mr-auto">{title}</SectionTitle>
        {actions}
      </header>
      <div className={cx('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Kicker({ children }) {
  return <span className="mb-0.5 flex items-center gap-1 text-xs text-subtle">{children}</span>;
}

export function ErrorBanner({ children }) {
  if (!children) return null;
  return (
    <div className="mb-3 rounded-md border border-danger/40 bg-danger-light px-3 py-2 text-sm text-danger-dark" role="alert">
      {children}
    </div>
  );
}

/**
 * User-facing error: a plain-language title and explanation, optional actions (Retry / Dismiss),
 * and the raw technical message folded away for whoever needs to debug it.
 */
export function ErrorPanel({ title, error, actions }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded-md border border-danger/40 border-l-4 border-l-danger bg-white px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <FiAlertCircle className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{title}</p>
          <p className="text-subtle">{error.message}</p>
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {error.detail && (
        <details className="pl-7 text-xs text-subtle">
          <summary className="cursor-pointer select-none hover:text-ink">Technical details</summary>
          <code className="mt-1 block break-all rounded-sm bg-canvas px-2 py-1 font-mono">{error.detail}</code>
        </details>
      )}
    </div>
  );
}

export function Skeleton({ className, style }) {
  return <span className={cx('skeleton', className)} style={style} />;
}

/**
 * Page title bar used at the top of every workspace. The breadcrumb ("Workflow › 3 Match & resolve")
 * and the one-line summary come from the nav entry for the current route, so they always match the
 * sidebar; `description` holds the longer technical explanation, folded under "How this works".
 */
export function PageHeader({ step, title, summary, description, actions }) {
  const { pathname } = useLocation();
  const nav = navFor(pathname);
  const lead = summary ?? nav?.hint;
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div className="min-w-0">
        {nav?.step ? (
          <Kicker>
            Workflow <FiChevronRight aria-hidden="true" />
            <span>{`Step ${nav.step.n} of ${STEPS.length} · ${nav.step.title}`}</span>
          </Kicker>
        ) : step && <Kicker>{step}</Kicker>}
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {lead && <p className="mt-0.5 max-w-3xl text-sm text-subtle">{lead}</p>}
        {description && (
          <details className="mt-1 max-w-3xl text-sm">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-primary hover:underline [&::-webkit-details-marker]:hidden">
              <FiInfo aria-hidden="true" /> How this works
            </summary>
            <p className="mt-1.5 border-l-2 border-line pl-3 text-xs leading-relaxed text-subtle">{description}</p>
          </details>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Summary figure. Rendered as a plain labelled value with a left rule (like a GIS attribute
 * summary), not a decorated KPI tile. `icon` / `accent` are accepted for compatibility but unused.
 */
export function StatCard({ label, value, hint, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx('flex min-w-0 flex-col border-l-2 border-line py-0.5 pl-3 text-left', onClick && 'hover:border-primary')}
    >
      <span className="text-xs text-subtle">{label}</span>
      <span className="text-lg font-semibold tabular-nums leading-tight text-ink">{value}</span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </Tag>
  );
}

/** Horizontal bar 0–1 with a label and percentage. A missing value shows "—", never a made-up 0%. */
export function Meter({ label, value, color, suffix }) {
  const known = value != null && Number.isFinite(Number(value));
  const v = known ? Math.max(0, Math.min(1, Number(value))) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs">
        <span className="text-subtle">{label}</span>
        <span className="font-semibold tabular-nums text-ink">{suffix ?? (known ? `${Math.round(v * 100)}%` : '—')}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-sm bg-line-light">
        {known && <div className="h-full" style={{ width: `${v * 100}%`, background: color }} />}
      </div>
    </div>
  );
}

/** Inline status line. */
export function Notice({ tone = 'success', children }) {
  if (!children) return null;
  const cls = {
    success: 'border-l-success', danger: 'border-l-danger', info: 'border-l-primary', warning: 'border-l-warning',
  }[tone];
  return <p role="status" className={cx('rounded-sm border border-l-4 border-line bg-white px-3 py-1.5 text-xs text-ink', cls)}>{children}</p>;
}

export const selectCls =
  'h-8 rounded-md border border-line bg-white px-2 text-sm text-ink focus:border-primary focus:shadow-focus focus:outline-none';

export const th = 'sticky top-0 z-10 border-b border-line bg-canvas px-3 py-1.5 text-left text-xs font-semibold text-subtle';
export const td = 'px-3 py-1.5 align-middle';
