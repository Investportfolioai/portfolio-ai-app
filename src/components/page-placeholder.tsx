/**
 * Consistent "coming soon" scaffold for dashboard sections that aren't built
 * yet, so every sidebar tab routes to a real, on-brand page instead of a 404.
 */
export function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-7xl px-8 py-8">
      <header className="mb-6">
        <h1 className="text-3xl tracking-tight text-primary">{title}</h1>
        <p className="mt-2 text-[15px] italic font-light text-muted-foreground">
          {description}
        </p>
      </header>

      <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card text-center">
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-accent">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 6v6l4 2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </span>
        <p className="text-sm font-medium text-primary">Coming soon</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          This section is on the roadmap. The pipeline is live today.
        </p>
      </div>
    </div>
  );
}
