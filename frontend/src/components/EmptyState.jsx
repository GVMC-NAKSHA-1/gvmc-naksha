export default function EmptyState({ icon: Icon, message, actionLabel, onAction }) {
  return (
    <div className="flex animate-fade-up flex-col items-center justify-center gap-2 px-4 py-7 text-center">
      {Icon && <Icon className="text-[1.75rem] text-faint" aria-hidden="true" />}
      <p className="max-w-[260px] text-sm text-subtle">{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 rounded-md border border-line px-3 py-1 text-xs text-ink transition-colors hover:border-primary hover:text-primary"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
