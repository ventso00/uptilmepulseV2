export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl bg-ink/10 motion-reduce:animate-none ${className}`}
    />
  );
}
