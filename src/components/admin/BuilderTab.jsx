import Card from '../Card';
import { formatDateRange, toDatetimeLocalValue } from '../../lib/format';

function badgeClasses(tone) {
  if (tone === 'cyan') {
    return 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--accent-strong)]';
  }
  if (tone === 'blue') {
    return 'border-[var(--accent-blue)] bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]';
  }
  return 'border-[var(--border-soft)] bg-[var(--panel-muted)] text-[var(--text-secondary)]';
}

function SectionHeader({ title, description, aside }) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-[var(--border-soft)] pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] sm:text-lg">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
      </div>
      {aside}
    </div>
  );
}

export default function BuilderTab({
  selectedRaffle,
  selectedPhase,
  raffleForm,
  enabledBranches,
  branches,
  updateRaffleForm,
  updateRaffleDate,
  toggleBranch,
  persistRaffle,
  startNewRaffle,
  overlapWarnings,
  omittedBranches,
}) {
  return (
    <Card>
      <SectionHeader
        title={selectedRaffle ? 'Editar sorteo seleccionado' : 'Crear nuevo sorteo'}
        description="Definí nombre, fechas y sucursales. La hora se completa sola: 00:00 al inicio y 23:59 al cierre."
        aside={
          selectedRaffle ? (
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] ${badgeClasses(selectedPhase.tone)}`}>
                {selectedPhase.label}
              </span>
            </div>
          ) : null
        }
      />

      {overlapWarnings.length > 0 ? (
        <div className="mb-5 rounded-[20px] border border-rose-400/30 bg-rose-400/10 px-4 py-4 text-sm text-rose-500">
          <p className="font-medium">Hay sorteos que se superponen en fecha y sucursal.</p>
          <div className="mt-2 space-y-1">
            {overlapWarnings.map((raffle) => (
              <p key={raffle.id}>
                {raffle.name} · {formatDateRange(raffle.startAt, raffle.endAt)} · {(raffle.enabledBranches ?? []).join(', ')}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {omittedBranches.length > 0 ? (
        <div className="mb-5 rounded-[20px] border border-amber-400/30 bg-amber-400/10 px-4 py-4 text-sm text-amber-500">
          <p className="font-medium">Atención: hay sucursales fuera de este sorteo.</p>
          <p className="mt-2">{omittedBranches.join(', ')}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 lg:col-span-2">
          <span className="text-sm text-[var(--text-secondary)]">Nombre del sorteo</span>
          <input
            className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
            name="name"
            onChange={updateRaffleForm}
            placeholder="Ej: Promoción Pinturas de Invierno"
            value={raffleForm.name}
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm text-[var(--text-secondary)]">Fecha de inicio</span>
          <input
            className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
            name="startAt"
            onChange={(event) => updateRaffleDate('startAt', event.target.value ? new Date(`${event.target.value}T00:00:00`) : null)}
            type="date"
            value={raffleForm.startAt ? toDatetimeLocalValue(raffleForm.startAt).slice(0, 10) : ''}
          />
          <p className="text-xs text-[var(--text-secondary)]">Inicio automático: 00:00 hs.</p>
        </label>

        <label className="space-y-2">
          <span className="text-sm text-[var(--text-secondary)]">Fecha de cierre</span>
          <input
            className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
            name="endAt"
            onChange={(event) => updateRaffleDate('endAt', event.target.value ? new Date(`${event.target.value}T00:00:00`) : null)}
            type="date"
            value={raffleForm.endAt ? toDatetimeLocalValue(raffleForm.endAt).slice(0, 10) : ''}
          />
          <p className="text-xs text-[var(--text-secondary)]">Cierre automático: 23:59 hs.</p>
        </label>
      </div>

      <div className="mt-6 rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <p className="text-sm font-medium text-[var(--text-primary)]">Sucursales participantes</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Marcá sólo las sucursales incluidas en este sorteo. Esto define quién puede participar y qué QR quedan habilitados.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {branches.map((branch) => {
            const enabled = enabledBranches.includes(branch);
            return (
              <button
                className={`rounded-[18px] border px-4 py-4 text-left transition ${
                  enabled
                    ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--text-primary)]'
                    : 'border-[var(--border-soft)] bg-[var(--panel-muted)] text-[var(--text-secondary)] hover:border-[var(--accent-strong)]/40'
                }`}
                key={branch}
                onClick={() => toggleBranch(branch)}
                type="button"
              >
                <p className="font-medium">{branch}</p>
                <p className="mt-2 text-xs uppercase tracking-[0.24em]">{enabled ? 'Incluida' : 'Excluida'}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-strong)] px-6 py-3 text-sm font-semibold text-white transition hover:scale-[1.01]"
          onClick={persistRaffle}
          type="button"
        >
          {selectedRaffle ? 'Guardar cambios' : 'Crear y activar sorteo'}
        </button>
        <button
          className="inline-flex items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-6 py-3 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
          onClick={startNewRaffle}
          type="button"
        >
          Limpiar formulario
        </button>
      </div>
    </Card>
  );
}
