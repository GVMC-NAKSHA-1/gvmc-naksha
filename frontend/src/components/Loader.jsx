import { cx } from './ui';

const DOT = { sm: 'size-1', md: 'size-1.5', lg: 'size-2' };

export default function Loader({ size = 'md', label = 'Loading' }) {
  const dot = cx('rounded-full bg-primary animate-pulse-fade', DOT[size] ?? DOT.md);
  return (
    <span className={cx('inline-flex items-center', size === 'lg' ? 'gap-1.5' : 'gap-1')} role="status" aria-label={label}>
      <span className={dot} />
      <span className={dot} style={{ animationDelay: '0.15s' }} />
      <span className={dot} style={{ animationDelay: '0.3s' }} />
    </span>
  );
}
