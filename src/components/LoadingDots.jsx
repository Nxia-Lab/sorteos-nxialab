export default function LoadingDots({ label = 'Procesando' }) {
  return (
    <div className="inline-flex items-center gap-3 text-sm text-[var(--text-primary)]">
      <span>{label}</span>
      <span className="flex gap-1">
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent-strong)] [animation-delay:-0.2s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent-strong)] [animation-delay:-0.1s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent-strong)]" />
      </span>
    </div>
  );
}
