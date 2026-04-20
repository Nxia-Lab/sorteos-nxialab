import { useEffect, useMemo, useState } from 'react';
import LoadingDots from '../components/LoadingDots';
import Shell from '../components/Shell';
import { useTheme } from '../context/ThemeContext';
import { BRANCHES } from '../lib/branches';
import { getCurrentJornada, normalizeBranch } from '../lib/format';
import { createParticipant, subscribeRaffles } from '../lib/publicData';

const COOLDOWN_MS = 30_000;

function getCooldownKey(dni) {
  return `raffle-cooldown:${dni}`;
}

function getBranchFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeBranch(params.get('suc'));
}

function isBlockedByCooldown(dni) {
  const raw = window.localStorage.getItem(getCooldownKey(dni));
  if (!raw) {
    return false;
  }

  const expiresAt = Number(raw);
  if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
    window.localStorage.removeItem(getCooldownKey(dni));
    return false;
  }

  return true;
}

function startCooldown(dni) {
  window.localStorage.setItem(getCooldownKey(dni), String(Date.now() + COOLDOWN_MS));
}

function isWithinWindow(startAt, endAt) {
  if (!startAt || !endAt) {
    return false;
  }

  const now = Date.now();
  return now >= new Date(startAt).getTime() && now <= new Date(endAt).getTime();
}

function getMatchingRaffles(raffles, branch) {
  return raffles.filter(
    (raffle) =>
      raffle.status === 'active' &&
      raffle.enabledBranches?.includes(branch) &&
      isWithinWindow(raffle.startAt, raffle.endAt),
  );
}

export default function RegisterPage() {
  const { theme, setTheme } = useTheme();
  const branch = useMemo(() => getBranchFromUrl(), []);
  const [nowTick, setNowTick] = useState(Date.now());
  const [form, setForm] = useState({
    nombre: '',
    dni: '',
    telefono: '',
  });
  const [status, setStatus] = useState({
    type: 'idle',
    message: '',
  });
  const [raffles, setRaffles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeRaffles((items) => {
      setRaffles(items);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const previousTheme = theme;
    setTheme('light');

    return () => {
      setTheme(previousTheme);
    };
  }, []);

  const matchingRaffles = useMemo(() => getMatchingRaffles(raffles, branch), [raffles, branch]);
  const currentJornada = useMemo(() => getCurrentJornada(new Date(nowTick)), [nowTick]);
  const activeRaffle = matchingRaffles[0] ?? null;
  const hasConflict = matchingRaffles.length > 1;
  const branchExists = BRANCHES.includes(branch);
  const isReady = Boolean(branch) && Boolean(activeRaffle?.id) && !hasConflict && Boolean(currentJornada);
  const showStatusModal = status.type !== 'idle' && status.type !== 'loading';
  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const payload = {
      nombre: form.nombre.trim(),
      dni: form.dni.replace(/\D+/g, ''),
      telefono: form.telefono.trim(),
      sucursal: branch,
      raffleId: activeRaffle?.id,
      raffleName: activeRaffle?.name,
      jornadaKey: currentJornada?.key,
      jornadaLabel: currentJornada?.label,
      jornadaStartAt: currentJornada?.startAt,
      jornadaEndAt: currentJornada?.endAt,
    };

    if (!payload.sucursal) {
      setStatus({
        type: 'error',
        message: 'Falta la sucursal en la URL. Usá un enlace con ?suc=nombre_sucursal.',
      });
      return;
    }

    if (!branchExists) {
      setStatus({
        type: 'error',
        message: 'La sucursal indicada en la URL no existe en la configuración conocida.',
      });
      return;
    }

    if (hasConflict) {
      setStatus({
        type: 'error',
        message: 'Hay más de un sorteo activo para esta sucursal y fecha. Revisalo desde el admin.',
      });
      return;
    }

    if (!payload.raffleId) {
      setStatus({
        type: 'error',
        message: 'No hay un sorteo activo disponible para esta sucursal en este momento.',
      });
      return;
    }

    if (!currentJornada) {
      setStatus({
        type: 'error',
        message: 'La jornada está cerrada. Volvé a escanear el QR cuando vuelva a abrirse.',
      });
      return;
    }

    if (!payload.nombre || !payload.dni || !payload.telefono) {
      setStatus({
        type: 'error',
        message: 'Completá nombre, DNI y teléfono antes de continuar.',
      });
      return;
    }

    if (isBlockedByCooldown(payload.dni)) {
      setStatus({
        type: 'error',
        message: 'Ese DNI acaba de enviarse. Esperá unos segundos para evitar duplicados accidentales.',
      });
      return;
    }

    try {
      setIsSubmitting(true);
      setStatus({ type: 'loading', message: '' });

      await createParticipant(payload);
      startCooldown(payload.dni);

      setForm({
        nombre: '',
        dni: '',
        telefono: '',
      });
      setStatus({
        type: 'success',
        message: `Tu chance para ${activeRaffle.name} quedó registrada correctamente.`,
      });
    } catch (error) {
      const detail =
        error?.code === 'permission-denied'
          ? 'Firestore rechazó el guardado. Revisá las reglas de seguridad y que estén habilitadas las colecciones nuevas.'
          : error?.message || 'Verificá la configuración de Firebase e intentá otra vez.';
      setStatus({
        type: 'error',
        message: `No pudimos guardar la inscripción. ${detail}`,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function closeStatusModal() {
    setStatus({
      type: 'idle',
      message: '',
    });
  }

  return (
    <Shell
      topLabel={activeRaffle?.name || 'Sorteo vigente'}
      topSubtitle={branch || 'Sucursal'}
      topLabelClassName="font-extrabold tracking-[0.16em]"
      showThemeToggle={false}
      title="Registrate y entrá al sorteo"
    >
      {showStatusModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-[30px] border p-6 shadow-[0_30px_100px_rgba(0,0,0,0.45)] ${
              status.type === 'success'
                ? 'border-emerald-400/30 bg-[var(--panel)] text-emerald-400'
                : 'border-rose-400/30 bg-[var(--panel)] text-rose-400'
            }`}
          >
            <div className="flex flex-col items-center text-center">
              <div
                className={`flex h-16 w-16 items-center justify-center rounded-full border text-3xl ${
                  status.type === 'success'
                    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                    : 'border-rose-400/30 bg-rose-400/10 text-rose-400'
                }`}
              >
                {status.type === 'success' ? '✓' : '!'}
              </div>

              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.3em] opacity-80">
                {status.type === 'success' ? 'Registro correcto' : 'Atención'}
              </p>
              <h3 className="mt-3 text-2xl font-semibold leading-tight text-[var(--text-primary)]">
                {status.type === 'success' ? 'Chance registrada' : 'No se pudo registrar'}
              </h3>
              <p className="mt-3 text-base leading-7 text-[var(--text-secondary)]">{status.message}</p>

              <div className="mt-6 flex w-full justify-center">
                <button
                  className={`inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                    status.type === 'success'
                      ? 'bg-emerald-400 text-black hover:opacity-90'
                      : 'bg-rose-500 text-white hover:opacity-90'
                  }`}
                  onClick={closeStatusModal}
                  type="button"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-[var(--panel-muted)] shadow-[var(--card-shadow)]">
          <img
            alt="Alentemos a la Selección - Sorteo de camiseta"
            className="h-auto w-full object-cover"
            src="/sorteo-banner.jpeg"
          />
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="participant-form-shell">
            <div className="participant-form-shell__header">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[var(--accent-strong)]">Datos del cliente</p>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">Completá los datos y registramos la chance en el sorteo vigente.</p>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm text-[var(--text-secondary)]">Nombre</span>
                <input
                  className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                  disabled={!isReady || isSubmitting}
                  name="nombre"
                  onChange={updateField}
                  placeholder="Nombre y apellido"
                  value={form.nombre}
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm text-[var(--text-secondary)]">DNI</span>
                <input
                  className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                  disabled={!isReady || isSubmitting}
                  inputMode="numeric"
                  name="dni"
                  onChange={updateField}
                  placeholder="Solo números"
                  value={form.dni}
                />
              </label>
            </div>

            <label className="mt-5 block space-y-2">
              <span className="text-sm text-[var(--text-secondary)]">Teléfono</span>
              <input
                className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                disabled={!isReady || isSubmitting}
                name="telefono"
                onChange={updateField}
                placeholder="Ej: 11 5555 5555"
                value={form.telefono}
              />
            </label>

            <div className="mt-5 flex flex-col gap-4 border-t border-[var(--border-soft)] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-strong)] px-6 py-3 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!isReady || isSubmitting}
                type="submit"
              >
                {isSubmitting ? 'Enviando...' : 'Registrar chance'}
              </button>

              {status.type === 'loading' ? <LoadingDots label="Guardando inscripción" /> : null}
            </div>
          </div>
        </form>
      </div>
    </Shell>
  );
}
