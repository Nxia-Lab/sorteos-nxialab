import { useTheme } from '../context/ThemeContext';

export default function Shell({
  eyebrow,
  title,
  description,
  children,
  aside,
  actions,
  quickAccess,
  topLabel = 'Panel de sorteos',
  topSubtitle = '',
  topLabelClassName = '',
  showThemeToggle = true,
}) {
  const { theme, toggleTheme } = useTheme();
  const hasAside = Boolean(aside);

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--text-primary)] transition-colors duration-300">
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-5 flex flex-col gap-4 rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-4 text-center shadow-[var(--shell-shadow)] backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:text-left xl:px-10">
          <div className={`min-w-0 ${topSubtitle ? 'sm:text-center xl:flex-1' : ''}`}>
            <p className={`break-words text-lg font-semibold uppercase tracking-[0.24em] text-[var(--accent-strong)] sm:text-xl ${topLabelClassName}`}>{topLabel}</p>
            {topSubtitle ? (
              <p className="mt-1 break-words text-sm font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)] sm:text-base">
                {topSubtitle}
              </p>
            ) : null}
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            {quickAccess}
            {actions}
            {showThemeToggle ? (
              <button
                aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--panel)] text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)] sm:h-auto sm:w-auto sm:px-4 sm:py-2 sm:text-lg"
                onClick={toggleTheme}
                type="button"
              >
                <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className={`grid min-h-screen gap-6 ${hasAside ? 'lg:grid-cols-[1.6fr_0.4fr]' : 'lg:grid-cols-1'}`}>
          <section className="relative overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[var(--panel)] p-5 shadow-[var(--shell-shadow)] backdrop-blur sm:p-6 xl:p-10">
            <div className="absolute inset-0 -z-10 bg-grid bg-[size:32px_32px] opacity-[var(--grid-opacity)]" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent-strong)] to-transparent" />
            {eyebrow ? <p className="text-left text-base font-semibold uppercase tracking-[0.24em] text-[var(--accent-strong)] sm:text-lg">{eyebrow}</p> : null}
            <h1 className="max-w-3xl text-left text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl">
              {title}
            </h1>
            {description ? <p className="mt-4 max-w-2xl text-left text-sm leading-6 text-[var(--text-secondary)] sm:text-base">{description}</p> : null}
            <div className="mt-6 sm:mt-8">{children}</div>
          </section>

          {hasAside ? <aside className="flex flex-col gap-6">{aside}</aside> : null}
        </div>
      </div>
    </div>
  );
}
