interface Props {
  className?: string;
}

export function Spinner({ className = '' }: Props) {
  return (
    <span
      className={`inline-block w-5 h-5 border-2 border-on-surface-variant/30 border-t-primary rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <Spinner className="w-8 h-8" />
    </div>
  );
}
