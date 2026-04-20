export default function Card({ title, value, subtitle, accent = 'cyan', children }) {
  const accentClasses =
    accent === 'blue' ? 'var(--accent-blue-soft)' : accent === 'slate' ? 'var(--border-soft)' : 'var(--accent-soft)';

  return (
    <div className="relative overflow-hidden rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel-muted)] p-4 shadow-[var(--card-shadow)] transition-colors duration-300 sm:p-5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent" style={{ backgroundImage: `linear-gradient(to right, transparent, ${accentClasses}, transparent)` }} />
      {title ? <p className="text-sm text-[var(--text-secondary)] sm:text-base">{title}</p> : null}
      {value ? <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">{value}</p> : null}
      {subtitle ? <p className="mt-2 text-sm text-[var(--text-secondary)]">{subtitle}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
