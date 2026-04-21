import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { browserLocalPersistence, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import Card from '../components/Card';
import LoadingDots from '../components/LoadingDots';
import Shell from '../components/Shell';
import { BRANCHES } from '../lib/branches';
import { formatDate, formatDateRange, getCurrentJornada } from '../lib/format';
import { auth } from '../lib/firebase';
import { getAdminEmail, isAllowedAdminEmail } from '../lib/adminAccess';
import {
  completeRaffle,
  fetchParticipants,
  grantJornadaOverride,
  saveRaffle,
  subscribeCustomers,
  subscribeParticipants,
  subscribeRaffles,
  updateParticipantRecord,
  updateRaffleStatus,
} from '../lib/adminData';
import { subscribeAppConfig, setRegistrationsEnabled } from '../lib/appConfig';
import { runRaffle } from '../lib/raffle';

const BuilderTab = lazy(() => import('../components/admin/BuilderTab'));
const QrTab = lazy(() => import('../components/admin/QrTab'));

const TABS = [
  { id: 'active', label: 'Activos' },
  { id: 'builder', label: 'Crear / Editar' },
  { id: 'participants', label: 'Participantes' },
  { id: 'customers', label: 'Clientes' },
  { id: 'history', label: 'Historial' },
  { id: 'qr', label: 'QR' },
];

const OPEN_STATUSES = ['active', 'paused'];
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

function groupByBranch(participants) {
  return participants.reduce((accumulator, participant) => {
    const key = participant.sucursal || 'Sin sucursal';
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

function clampInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function getSessionKey() {
  return 'raffle-admin-session';
}

function getEmptyRaffleForm() {
  return {
    name: '',
    startAt: null,
    endAt: null,
  };
}

function buildResultText(result) {
  const drawModeLine =
    result?.drawMode === 'branch'
      ? `Modalidad: por sucursal (${result.winnersPerGroup ?? 0} titulares y ${result.alternatesPerGroup ?? 0} suplentes por sucursal)`
      : 'Modalidad: todas las sucursales juntas';
  const heading = result?.name ? [`Sorteo: ${result.name}`, `Ventana: ${formatDateRange(result.startAt, result.endAt)}`, drawModeLine, ''] : [];
  const winnerLines = (result?.winners ?? []).map(
    (item, index) => `Ganador ${index + 1}: ${item.nombre} - DNI ${item.dni} - ${item.telefono} - ${item.sucursal}`,
  );
  const alternateLines = (result?.alternates ?? []).map(
    (item, index) => `Suplente ${index + 1}: ${item.nombre} - DNI ${item.dni} - ${item.telefono} - ${item.sucursal}`,
  );

  return [...heading, ...winnerLines, ...alternateLines].join('\n');
}

function getRafflePhase(raffle) {
  if (!raffle) {
    return {
      label: 'Sin seleccionar',
      tone: 'neutral',
    };
  }

  if (raffle.status === 'paused') {
    return {
      label: 'Pausado',
      tone: 'blue',
    };
  }

  if (raffle.status === 'manual_closed') {
    return {
      label: 'Cerrado manual',
      tone: 'neutral',
    };
  }

  if (raffle.status === 'expired') {
    return {
      label: 'Cerrado automático',
      tone: 'neutral',
    };
  }

  if (raffle.status === 'completed') {
    return {
      label: 'Cerrado',
      tone: 'neutral',
    };
  }

  const now = Date.now();
  const start = new Date(raffle.startAt).getTime();
  const end = new Date(raffle.endAt).getTime();

  if (now < start) {
    return {
      label: 'Por empezar',
      tone: 'blue',
    };
  }

  if (now > end) {
    return {
      label: 'Fuera de fecha',
      tone: 'neutral',
    };
  }

  return {
    label: 'Vigente',
    tone: 'cyan',
  };
}

function getBannerTone(message) {
  if (!message) {
    return 'neutral';
  }

  const content = message.toLowerCase();
  if (content.includes('no se pudo') || content.includes('incorrecta') || content.includes('completá') || content.includes('elegí')) {
    return 'danger';
  }
  if (content.includes('guard') || content.includes('cread') || content.includes('copiad') || content.includes('movido') || content.includes('actualiz')) {
    return 'success';
  }
  return 'neutral';
}

function badgeClasses(tone) {
  if (tone === 'cyan') {
    return 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--accent-strong)]';
  }
  if (tone === 'blue') {
    return 'border-[var(--accent-blue)] bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]';
  }
  if (tone === 'danger') {
    return 'border-rose-400/40 bg-rose-400/10 text-rose-500';
  }
  if (tone === 'success') {
    return 'border-emerald-400/40 bg-emerald-400/10 text-emerald-500';
  }
  return 'border-[var(--border-soft)] bg-[var(--panel-muted)] text-[var(--text-secondary)]';
}

function hasOverlap(first, second) {
  const firstStart = new Date(first.startAt).getTime();
  const firstEnd = new Date(first.endAt).getTime();
  const secondStart = new Date(second.startAt).getTime();
  const secondEnd = new Date(second.endAt).getTime();

  return firstStart <= secondEnd && secondStart <= firstEnd;
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

function downloadTextFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function toCsvValue(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function compareByBranchAndName(first, second) {
  return (
    String(first?.sucursal ?? '').localeCompare(String(second?.sucursal ?? ''), 'es') ||
    String(first?.nombre ?? '').localeCompare(String(second?.nombre ?? ''), 'es') ||
    String(first?.dni ?? '').localeCompare(String(second?.dni ?? ''), 'es')
  );
}

function compareDrawExportRows(first, second) {
  const branchComparison = String(first?.sucursal ?? '').localeCompare(String(second?.sucursal ?? ''), 'es');
  if (branchComparison !== 0) {
    return branchComparison;
  }

  const typeRank = {
    Titular: 0,
    Suplente: 1,
  };
  const typeComparison = (typeRank[first?.tipo] ?? 99) - (typeRank[second?.tipo] ?? 99);
  if (typeComparison !== 0) {
    return typeComparison;
  }

  return Number(first?.orden ?? 0) - Number(second?.orden ?? 0);
}

function buildDrawSummary(config, selectedRaffle) {
  const branchesCount = selectedRaffle?.enabledBranches?.length ?? 0;
  if (config.drawMode === 'branch') {
    return `Se van a sortear ${config.winners * branchesCount} titulares y ${config.alternates * branchesCount} suplentes en total: ${config.winners} titular(es) y ${config.alternates} suplente(s) por cada una de las ${branchesCount} sucursales habilitadas.`;
  }

  return `Se van a sortear ${config.winners} titulares y ${config.alternates} suplentes en una sola bolsa con todas las sucursales habilitadas.`;
}

export default function AdminPage() {
  const [participants, setParticipants] = useState([]);
  const [raffles, setRaffles] = useState([]);
  const [selectedRaffleId, setSelectedRaffleId] = useState(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  const [adminEmailInput, setAdminEmailInput] = useState(getAdminEmail());
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [enabledBranches, setEnabledBranches] = useState([]);
  const [manualRegisterBranch, setManualRegisterBranch] = useState('');
  const [raffleForm, setRaffleForm] = useState(getEmptyRaffleForm());
  const [allParticipants, setAllParticipants] = useState([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantScope, setParticipantScope] = useState('selected');
  const [participantBranchFilter, setParticipantBranchFilter] = useState('all');
  const [participantDateFrom, setParticipantDateFrom] = useState('');
  const [participantDateTo, setParticipantDateTo] = useState('');
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);
  const [participantForm, setParticipantForm] = useState({
    nombre: '',
    telefono: '',
    sucursal: '',
  });
  const [participantSaving, setParticipantSaving] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerBranchFilter, setCustomerBranchFilter] = useState('all');
  const [customerParticipationLevel, setCustomerParticipationLevel] = useState('all');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [historyExpandedId, setHistoryExpandedId] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [config, setConfig] = useState({
    winners: 1,
    alternates: 2,
    drawMode: 'global',
  });
  const [drawState, setDrawState] = useState({
    loading: true,
    running: false,
    message: '',
    lastResult: null,
    animationResult: null,
    rollingEntry: null,
    rollingLabel: '',
    revealStep: 0,
  });
  const [dismissedDrawMessage, setDismissedDrawMessage] = useState(false);
  const [dismissedExpiringReminder, setDismissedExpiringReminder] = useState(false);
  const [publicAccess, setPublicAccess] = useState({
    registrationsEnabled: true,
  });
  const [publicAccessSaving, setPublicAccessSaving] = useState(false);
  const [publicAccessError, setPublicAccessError] = useState('');

  useEffect(() => {
    let active = true;

    setPersistence(auth, browserLocalPersistence).catch(() => {
      if (active) {
        setAuthError('No pudimos preparar la sesión persistente del admin.');
      }
    });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active) {
        return;
      }

      const allowed = isAllowedAdminEmail(user?.email);
      setIsUnlocked(allowed);
      setAuthReady(true);

      if (!user) {
        setAuthError('');
        return;
      }

      if (!allowed) {
        setAuthError('Esa cuenta no tiene permiso de administrador.');
        signOut(auth).catch(() => {});
        return;
      }

      setAuthError('');
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubscribeRaffles = subscribeRaffles((items) => {
      setRaffles(items);
      setDrawState((current) => ({
        ...current,
        loading: false,
      }));
    });

    return unsubscribeRaffles;
  }, []);

  useEffect(() => {
    const unsubscribeAppConfig = subscribeAppConfig((config) => {
      setPublicAccess(config);
    });

    return unsubscribeAppConfig;
  }, []);

  useEffect(() => {
    const unsubscribeCustomers = subscribeCustomers((items) => {
      setCustomers(items);
    });

    return unsubscribeCustomers;
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const openRaffles = useMemo(() => raffles.filter((item) => OPEN_STATUSES.includes(item.status)), [raffles]);
  const activeRaffles = useMemo(() => raffles.filter((item) => item.status === 'active'), [raffles]);
  const completedRaffles = useMemo(
    () => raffles.filter((item) => ['completed', 'manual_closed', 'expired'].includes(item.status)),
    [raffles],
  );
  const selectedRaffle = useMemo(
    () => openRaffles.find((item) => item.id === selectedRaffleId) ?? null,
    [openRaffles, selectedRaffleId],
  );
  const expiringSoonRaffles = useMemo(
    () =>
      activeRaffles.filter((raffle) => {
        const endAt = new Date(raffle.endAt).getTime();
        const now = Date.now();
        return endAt > now && endAt - now <= REMINDER_WINDOW_MS;
      }),
    [activeRaffles],
  );
  const currentJornada = useMemo(() => getCurrentJornada(new Date(nowTick)), [nowTick]);

  useEffect(() => {
    setDismissedDrawMessage(false);
  }, [drawState.message]);

  useEffect(() => {
    setDismissedExpiringReminder(false);
  }, [expiringSoonRaffles]);

  useEffect(() => {
    if (isCreatingNew) {
      return;
    }

    if (!selectedRaffleId && openRaffles.length > 0) {
      setSelectedRaffleId(openRaffles[0].id);
      return;
    }

    if (selectedRaffleId && !openRaffles.some((item) => item.id === selectedRaffleId)) {
      setSelectedRaffleId(openRaffles[0]?.id ?? null);
    }
  }, [isCreatingNew, openRaffles, selectedRaffleId]);

  useEffect(() => {
    if (!selectedRaffle) {
      setRaffleForm(getEmptyRaffleForm());
      setEnabledBranches([]);
      setManualRegisterBranch('');
      return;
    }

    setRaffleForm({
      name: selectedRaffle.name || '',
      startAt: selectedRaffle.startAt ? new Date(selectedRaffle.startAt) : null,
      endAt: selectedRaffle.endAt ? new Date(selectedRaffle.endAt) : null,
    });
    setEnabledBranches(selectedRaffle.enabledBranches ?? []);
    setManualRegisterBranch(selectedRaffle.enabledBranches?.[0] ?? '');
    setIsCreatingNew(false);
  }, [selectedRaffle]);

  useEffect(() => {
    const unsubscribeParticipants = subscribeParticipants((items) => {
      setParticipants(items);
    }, selectedRaffle?.id);

    return unsubscribeParticipants;
  }, [selectedRaffle?.id]);

  useEffect(() => {
    const unsubscribeAllParticipants = subscribeParticipants((items) => {
      setAllParticipants(items);
    });

    return unsubscribeAllParticipants;
  }, []);

  useEffect(() => {
    const expiredRaffles = raffles.filter(
      (raffle) => raffle.status === 'active' && raffle.endAt && new Date(raffle.endAt).getTime() < Date.now(),
    );

    if (expiredRaffles.length === 0) {
      return;
    }

    expiredRaffles.forEach((raffle) => {
      updateRaffleStatus(raffle.id, 'expired', {
        autoClosedAt: new Date().toISOString(),
      }).catch(() => null);
    });
  }, [raffles]);

  const branchCounts = useMemo(() => groupByBranch(participants), [participants]);
  const activeUniquePeople = useMemo(() => new Set(participants.map((item) => item.dni)).size, [participants]);
  const totalCompletedParticipants = useMemo(
    () => completedRaffles.reduce((accumulator, raffle) => accumulator + (raffle.participantsCount ?? 0), 0),
    [completedRaffles],
  );
  const participantSource = participantScope === 'all' ? allParticipants : participants;
  const filteredParticipants = useMemo(() => {
    const term = participantSearch.trim().toLowerCase();
    return participantSource.filter((participant) => {
      const matchesText =
        !term ||
        [participant.nombre, participant.dni, participant.telefono, participant.sucursal, participant.raffleName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));

      const matchesBranch =
        participantBranchFilter === 'all' || participant.sucursal === participantBranchFilter;

      const participantTime = participant.timestamp?.toDate ? participant.timestamp.toDate().getTime() : new Date(participant.timestamp ?? 0).getTime();
      const matchesFrom = !participantDateFrom || participantTime >= new Date(`${participantDateFrom}T00:00:00`).getTime();
      const matchesTo = !participantDateTo || participantTime <= new Date(`${participantDateTo}T23:59:59`).getTime();

      return matchesText && matchesBranch && matchesFrom && matchesTo;
    });
  }, [participantBranchFilter, participantDateFrom, participantDateTo, participantScope, participantSearch, participantSource]);
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesText =
        !term ||
        [customer.nombre, customer.dni, customer.telefono, ...(customer.sucursales ?? [])]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));

      const matchesBranch =
        customerBranchFilter === 'all' || (customer.sucursales ?? []).includes(customerBranchFilter);
      const matchesLevel =
        customerParticipationLevel === 'all' ||
        (customerParticipationLevel === '2+' && (customer.totalParticipations ?? 0) >= 2) ||
        (customerParticipationLevel === '5+' && (customer.totalParticipations ?? 0) >= 5);

      return matchesText && matchesBranch && matchesLevel;
    });
  }, [customerBranchFilter, customerParticipationLevel, customerSearch, customers]);
  const selectedCustomer = useMemo(
    () => filteredCustomers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [filteredCustomers, selectedCustomerId],
  );
  const selectedParticipant = useMemo(
    () => filteredParticipants.find((participant) => participant.id === selectedParticipantId) ?? null,
    [filteredParticipants, selectedParticipantId],
  );
  useEffect(() => {
    if (!selectedParticipant) {
      setParticipantForm({
        nombre: '',
        telefono: '',
        sucursal: '',
      });
      return;
    }

    setParticipantForm({
      nombre: selectedParticipant.nombre ?? '',
      telefono: selectedParticipant.telefono ?? '',
      sucursal: selectedParticipant.sucursal ?? '',
    });
  }, [selectedParticipant]);
  const branchLinks = useMemo(
    () =>
      BRANCHES.map((branch) => ({
        branch,
        url: `${window.location.origin}/?suc=${encodeURIComponent(branch)}`,
      })),
    [],
  );
  const selectedPhase = getRafflePhase(selectedRaffle);
  const bannerTone = getBannerTone(drawState.message);
  const inconsistentParticipants = useMemo(() => {
    const byDni = new Map();

    allParticipants.forEach((participant) => {
      if (!participant.dni) {
        return;
      }
      const current = byDni.get(participant.dni) ?? {
        nombres: new Set(),
        telefonos: new Set(),
      };
      if (participant.nombre) {
        current.nombres.add(String(participant.nombre).trim().toLowerCase());
      }
      if (participant.telefono) {
        current.telefonos.add(String(participant.telefono).trim());
      }
      byDni.set(participant.dni, current);
    });

    return [...byDni.entries()]
      .filter(([, value]) => value.nombres.size > 1 || value.telefonos.size > 1)
      .map(([dni, value]) => ({
        dni,
        nombres: [...value.nombres],
        telefonos: [...value.telefonos],
      }));
  }, [allParticipants]);
  const omittedBranches = useMemo(
    () => BRANCHES.filter((branch) => !enabledBranches.includes(branch)),
    [enabledBranches],
  );
  const overlapWarnings = useMemo(() => {
    if (!raffleForm.startAt || !raffleForm.endAt || enabledBranches.length === 0) {
      return [];
    }

    const draft = {
      id: selectedRaffle?.id,
      startAt: new Date(
        raffleForm.startAt.getFullYear(),
        raffleForm.startAt.getMonth(),
        raffleForm.startAt.getDate(),
        0,
        0,
        0,
        0,
      ).toISOString(),
      endAt: new Date(
        raffleForm.endAt.getFullYear(),
        raffleForm.endAt.getMonth(),
        raffleForm.endAt.getDate(),
        23,
        59,
        0,
        0,
      ).toISOString(),
      enabledBranches,
    };

    return raffles.filter((raffle) => {
      if (!OPEN_STATUSES.includes(raffle.status)) {
        return false;
      }
      if (raffle.id === draft.id) {
        return false;
      }

      const sharesBranch = (raffle.enabledBranches ?? []).some((branch) => draft.enabledBranches.includes(branch));
      return sharesBranch && hasOverlap(raffle, draft);
    });
  }, [enabledBranches, raffleForm.endAt, raffleForm.startAt, raffles, selectedRaffle?.id]);

  async function handleUnlock(event) {
    event.preventDefault();

    const email = adminEmailInput.trim().toLowerCase();

    if (!isAllowedAdminEmail(email)) {
      setAuthError(`Usa la cuenta ${getAdminEmail()} para entrar al panel.`);
      return;
    }

    try {
      setAuthenticating(true);
      setAuthError('');
      await signInWithEmailAndPassword(auth, email, adminPasswordInput);
    } catch (error) {
      const code = error?.code;
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setAuthError('Email o contraseña incorrectos.');
      } else if (code === 'auth/too-many-requests') {
        setAuthError('Demasiados intentos. Probá de nuevo en unos minutos.');
      } else {
        setAuthError(error?.message || 'No pudimos iniciar sesión.');
      }
    } finally {
      setAuthenticating(false);
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setIsUnlocked(false);
    setAdminPasswordInput('');
  }

  async function handleTogglePublicAccess() {
    const nextValue = !publicAccess.registrationsEnabled;

    try {
      setPublicAccessSaving(true);
      setPublicAccessError('');
      await setRegistrationsEnabled(nextValue);
    } catch (error) {
      setPublicAccessError(error?.message || 'No pudimos actualizar el estado público.');
    } finally {
      setPublicAccessSaving(false);
    }
  }

  function openManualRegister() {
    const targetBranch = manualRegisterBranch || selectedRaffle?.enabledBranches?.[0];

    if (!targetBranch) {
      setDrawState((current) => ({
        ...current,
        message: 'Elegí un sorteo con sucursales habilitadas para abrir el registro manual.',
      }));
      return;
    }

    const url = `${window.location.origin}/?suc=${encodeURIComponent(targetBranch)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function finishDrawSession() {
    setDrawState((current) => ({
      ...current,
      lastResult: null,
      animationResult: null,
      rollingEntry: null,
      rollingLabel: '',
      revealStep: 0,
      message: 'Sesión del sorteo finalizada. El panel quedó listo para seguir trabajando.',
    }));
    setSelectedRaffleId(null);
    setActiveTab('active');
  }

  function startNewRaffle() {
    setIsCreatingNew(true);
    setSelectedRaffleId(null);
    setParticipants([]);
    setEnabledBranches([]);
    setRaffleForm(getEmptyRaffleForm());
    setActiveTab('builder');
    setDrawState((current) => ({
      ...current,
      message: 'Estás creando un sorteo nuevo. Definí nombre, fechas y sucursales para publicarlo.',
    }));
  }

  async function pauseSelectedRaffle() {
    if (!selectedRaffle) {
      return;
    }

    try {
      await updateRaffleStatus(selectedRaffle.id, 'paused');
      setDrawState((current) => ({
        ...current,
        message: 'Sorteo pausado correctamente.',
      }));
    } catch {
      setDrawState((current) => ({
        ...current,
        message: 'No se pudo pausar el sorteo.',
      }));
    }
  }

  async function reactivateSelectedRaffle() {
    if (!selectedRaffle) {
      return;
    }

    try {
      await updateRaffleStatus(selectedRaffle.id, 'active');
      setDrawState((current) => ({
        ...current,
        message: 'Sorteo reactivado correctamente.',
      }));
    } catch {
      setDrawState((current) => ({
        ...current,
        message: 'No se pudo reactivar el sorteo.',
      }));
    }
  }

  async function closeSelectedRaffleManually() {
    if (!selectedRaffle) {
      return;
    }

    try {
      await updateRaffleStatus(selectedRaffle.id, 'manual_closed', {
        manuallyClosedAt: new Date().toISOString(),
      });
      setActiveTab('history');
      setDrawState((current) => ({
        ...current,
        message: 'Sorteo cerrado manualmente sin ejecutar el sorteo.',
      }));
    } catch {
      setDrawState((current) => ({
        ...current,
        message: 'No se pudo cerrar manualmente el sorteo.',
      }));
    }
  }

  function updateConfig(event) {
    const { name, value } = event.target;
    setConfig((current) => ({
      ...current,
      [name]: name === 'drawMode' ? value : clampInteger(value),
    }));
  }

  function updateRaffleForm(event) {
    const { name, value } = event.target;
    setRaffleForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function updateRaffleDate(field, value) {
    setRaffleForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function toggleBranch(branch) {
    setEnabledBranches((current) =>
      current.includes(branch) ? current.filter((item) => item !== branch) : [...current, branch],
    );
  }

  async function persistRaffle() {
    const startAt = raffleForm.startAt
      ? new Date(raffleForm.startAt.getFullYear(), raffleForm.startAt.getMonth(), raffleForm.startAt.getDate(), 0, 0, 0, 0).toISOString()
      : '';
    const endAt = raffleForm.endAt
      ? new Date(raffleForm.endAt.getFullYear(), raffleForm.endAt.getMonth(), raffleForm.endAt.getDate(), 23, 59, 0, 0).toISOString()
      : '';

    if (!raffleForm.name.trim() || !startAt || !endAt) {
      setDrawState((current) => ({
        ...current,
        message: 'Completá nombre, fecha de inicio y fecha de finalización del sorteo.',
      }));
      return;
    }

    if (new Date(startAt).getTime() >= new Date(endAt).getTime()) {
      setDrawState((current) => ({
        ...current,
        message: 'La fecha de finalización debe ser posterior a la de inicio.',
      }));
      return;
    }

    if (enabledBranches.length === 0) {
      setDrawState((current) => ({
        ...current,
        message: 'Elegí al menos una sucursal habilitada para publicar el sorteo.',
      }));
      return;
    }

    if (overlapWarnings.length > 0) {
      setDrawState((current) => ({
        ...current,
        message: 'Hay sorteos activos o pausados que se superponen en fecha y sucursal. Revisá los avisos antes de guardar.',
      }));
      return;
    }

    try {
      const wasCreatingNew = !selectedRaffle?.id;
      const raffleId = await saveRaffle({
        raffleId: selectedRaffle?.id,
        name: raffleForm.name.trim(),
        startAt,
        endAt,
        enabledBranches,
      });

      setIsCreatingNew(false);
      if (wasCreatingNew) {
        setSelectedRaffleId(null);
        setRaffleForm(getEmptyRaffleForm());
        setEnabledBranches([]);
        setActiveTab('active');
      } else {
        setSelectedRaffleId(raffleId);
      }
      setDrawState((current) => ({
        ...current,
        message: wasCreatingNew ? 'Nuevo sorteo creado correctamente.' : 'Sorteo actualizado correctamente.',
      }));
    } catch (error) {
      setDrawState((current) => ({
        ...current,
        message: 'No se pudo guardar el sorteo.',
      }));
    }
  }

  async function handleDraw() {
    if (!drawState.animationResult || !selectedRaffle?.id) {
      setDrawState((current) => ({
        ...current,
        message: 'Primero generá una vista previa del sorteo antes de confirmarlo.',
      }));
      return;
    }

    setDrawState((current) => ({
      ...current,
      running: true,
      message: '',
    }));

    try {
      await completeRaffle({
        raffleId: selectedRaffle.id,
        ...drawState.animationResult,
      });

      setActiveTab('history');
      setDrawState({
        loading: false,
        running: false,
        message: 'Sorteo ejecutado y movido al historial.',
        lastResult: drawState.animationResult,
        animationResult: null,
      });
    } catch (error) {
      setDrawState((current) => ({
        ...current,
        running: false,
        message: 'No se pudo completar el sorteo. Revisa la conexion y la configuracion de Firestore.',
      }));
    }
  }

  async function runAnimatedDraw() {
    if (!selectedRaffle?.id) {
      setDrawState((current) => ({
        ...current,
        message: 'Elegí un sorteo activo antes de ejecutar el sorteo.',
      }));
      return;
    }

    if (selectedRaffle.status !== 'active') {
      setDrawState((current) => ({
        ...current,
        message: 'Solo podés sortear campañas que estén activas.',
      }));
      return;
    }

    if (config.winners + config.alternates === 0) {
      setDrawState((current) => ({
        ...current,
        message: 'Definí al menos un ganador o suplente para ejecutar el sorteo.',
      }));
      return;
    }

    setDrawState((current) => ({
      ...current,
      running: true,
      message: '',
      animationResult: null,
      rollingEntry: null,
      rollingLabel: 'Preparando bolillero',
      revealStep: 0,
    }));

    try {
      const eligibleEntries = await fetchParticipants(selectedRaffle.id);

      if (eligibleEntries.length === 0) {
        setDrawState((current) => ({
          ...current,
          running: false,
          rollingEntry: null,
          rollingLabel: '',
          message: 'Este sorteo todavía no tiene participantes cargados.',
        }));
        return;
      }

      const outcome = runRaffle(eligibleEntries, config.winners, config.alternates, {
        mode: config.drawMode,
        branches: selectedRaffle.enabledBranches ?? [],
      });
      const fullResult = {
        id: selectedRaffle.id,
        name: selectedRaffle.name,
        startAt: selectedRaffle.startAt,
        endAt: selectedRaffle.endAt,
        enabledBranches: selectedRaffle.enabledBranches,
        drawMode: config.drawMode,
        participantsCount: eligibleEntries.length,
        winnersCount: outcome.winners.length,
        alternatesCount: outcome.alternates.length,
        winnersPerGroup: config.winners,
        alternatesPerGroup: config.alternates,
        winners: outcome.winners,
        alternates: outcome.alternates,
      };

      setDrawState((current) => ({
        ...current,
        animationResult: {
          ...fullResult,
          winners: [],
          alternates: [],
        },
      }));

      const revealQueue = [
        ...outcome.winners.map((item, index) => ({ item, slotType: 'winner', slotNumber: index + 1 })),
        ...outcome.alternates.map((item, index) => ({ item, slotType: 'alternate', slotNumber: index + 1 })),
      ];

      for (let index = 0; index < revealQueue.length; index += 1) {
        const step = revealQueue[index];
        const label = step.slotType === 'winner' ? `Titular ${step.slotNumber}` : `Suplente ${step.slotNumber}`;

        for (let loop = 0; loop < 10; loop += 1) {
          const rollingEntry = eligibleEntries[Math.floor(Math.random() * eligibleEntries.length)];
          setDrawState((current) => ({
            ...current,
            rollingEntry,
            rollingLabel: `${label} en sorteo`,
            revealStep: index + 1,
          }));
          await sleep(70);
        }

        setDrawState((current) => ({
          ...current,
          rollingEntry: step.item,
          rollingLabel: `${label} confirmado`,
          animationResult: {
            ...(current.animationResult ?? {
              ...fullResult,
              winners: [],
              alternates: [],
            }),
            winners:
              step.slotType === 'winner'
                ? [...(current.animationResult?.winners ?? []), step.item]
                : current.animationResult?.winners ?? [],
            alternates:
              step.slotType === 'alternate'
                ? [...(current.animationResult?.alternates ?? []), step.item]
                : current.animationResult?.alternates ?? [],
          },
          revealStep: index + 1,
        }));

        await sleep(220);
      }

      await completeRaffle({
        raffleId: selectedRaffle.id,
        ...fullResult,
      });

      setDrawState((current) => ({
        ...current,
        running: false,
        message: 'Sorteo ejecutado con azar puro y guardado en el historial.',
        lastResult: fullResult,
        animationResult: fullResult,
        rollingEntry: null,
        rollingLabel: 'Sorteo finalizado',
      }));
    } catch {
      setDrawState((current) => ({
        ...current,
        running: false,
        message: 'No se pudo completar el sorteo. Revisá la conexión y la configuración de Firestore.',
        rollingEntry: null,
        rollingLabel: '',
      }));
    }
  }

  async function copyLatestResult() {
    const result = drawState.lastResult ?? completedRaffles[0];
    if (!result) {
      setDrawState((current) => ({
        ...current,
        message: 'Todavía no hay resultados para copiar.',
      }));
      return;
    }

    try {
      await navigator.clipboard.writeText(buildResultText(result));
      setDrawState((current) => ({
        ...current,
        message: 'Resultado copiado al portapapeles.',
      }));
    } catch (error) {
      setDrawState((current) => ({
        ...current,
        message: 'No se pudo copiar automáticamente el resultado.',
      }));
    }
  }

  function exportParticipantsCsv() {
    if (participantScope === 'selected' && !selectedRaffle) {
      setDrawState((current) => ({
        ...current,
        message: 'Elegí un sorteo para exportar sus participantes.',
      }));
      return;
    }

    if (filteredParticipants.length === 0) {
      setDrawState((current) => ({
        ...current,
        message: 'No hay participantes en la vista actual para exportar.',
      }));
      return;
    }

    const header = ['nombre', 'dni', 'telefono', 'sucursal', 'raffleName', 'timestamp'];
    const rows = [...filteredParticipants]
      .sort(compareByBranchAndName)
      .map((participant) =>
      [
        participant.nombre,
        participant.dni,
        participant.telefono,
        participant.sucursal,
        participant.raffleName,
        participant.timestamp?.toDate ? participant.timestamp.toDate().toISOString() : participant.timestamp ?? '',
      ]
        .map(toCsvValue)
        .join(','),
    );

    downloadTextFile(
      `${
        participantScope === 'selected'
          ? selectedRaffle?.name.replace(/[^\w.-]+/g, '_') || 'participantes'
          : 'participantes_global'
      }.csv`,
      [header.join(','), ...rows].join('\n'),
      'text/csv;charset=utf-8',
    );

    setDrawState((current) => ({
      ...current,
      message: 'CSV de participantes generado correctamente.',
    }));
  }

  function exportCustomersCsv() {
    if (filteredCustomers.length === 0) {
      setDrawState((current) => ({
        ...current,
        message: 'No hay clientes en la vista actual para exportar.',
      }));
      return;
    }

    const header = ['dni', 'nombre', 'telefono', 'sucursales', 'totalParticipations', 'lastRaffleName'];
    const rows = filteredCustomers.map((customer) =>
      [
        customer.dni,
        customer.nombre,
        customer.telefono,
        (customer.sucursales ?? []).join(' | '),
        customer.totalParticipations ?? 0,
        customer.lastRaffleName ?? '',
      ]
        .map(toCsvValue)
        .join(','),
    );

    const filename =
      customerBranchFilter === 'all'
        ? customerParticipationLevel === 'all'
          ? 'clientes_base.csv'
          : `clientes_${customerParticipationLevel.replace('+', 'mas')}.csv`
        : `clientes_${customerBranchFilter.replace(/[^\w.-]+/g, '_')}.csv`;
    downloadTextFile(filename, [header.join(','), ...rows].join('\n'), 'text/csv;charset=utf-8');

    setDrawState((current) => ({
      ...current,
      message: 'CSV de clientes generado correctamente.',
    }));
  }

  function updateParticipantForm(event) {
    const { name, value } = event.target;
    setParticipantForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function saveParticipantEdit() {
    if (!selectedParticipant) {
      return;
    }

    if (!participantForm.nombre.trim() || !participantForm.telefono.trim() || !participantForm.sucursal.trim()) {
      setDrawState((current) => ({
        ...current,
        message: 'Completá nombre, teléfono y sucursal para guardar la edición del participante.',
      }));
      return;
    }

    setParticipantSaving(true);

    try {
      await updateParticipantRecord({
        participantId: selectedParticipant.id,
        dni: selectedParticipant.dni,
        nombre: participantForm.nombre.trim(),
        telefono: participantForm.telefono.trim(),
        sucursal: participantForm.sucursal,
      });
      setDrawState((current) => ({
        ...current,
        message: 'Participante actualizado correctamente desde el panel admin.',
      }));
    } catch {
      setDrawState((current) => ({
        ...current,
        message: 'No se pudo actualizar el participante. Revisá las reglas de Firestore.',
      }));
    } finally {
      setParticipantSaving(false);
    }
  }

  async function allowOneMoreRegistration() {
    if (!selectedParticipant || !selectedRaffle || !currentJornada) {
      return;
    }

    try {
      await grantJornadaOverride({
        raffleId: selectedRaffle.id,
        dni: selectedParticipant.dni,
        jornadaKey: currentJornada.key,
        jornadaLabel: currentJornada.label,
      });
      setDrawState((current) => ({
        ...current,
        message: `Se registró otra chance para DNI ${selectedParticipant.dni}.`,
      }));
    } catch {
      setDrawState((current) => ({
        ...current,
        message: 'No se pudo registrar otra chance. Revisá las reglas de Firestore.',
      }));
    }
  }

  async function prepareDrawPreview() {
    if (!selectedRaffle?.id) {
      setDrawState((current) => ({
        ...current,
        message: 'Elegí un sorteo activo antes de preparar el sorteo.',
      }));
      return;
    }

    if (selectedRaffle.status !== 'active') {
      setDrawState((current) => ({
        ...current,
        message: 'Solo podes sortear campanas que esten activas.',
      }));
      return;
    }

    if (config.winners + config.alternates === 0) {
      setDrawState((current) => ({
        ...current,
        message: 'Definí al menos un ganador o suplente para preparar el sorteo.',
      }));
      return;
    }

    setDrawState((current) => ({
      ...current,
      running: true,
      message: '',
    }));

    try {
      const eligibleEntries = await fetchParticipants(selectedRaffle.id);

      if (eligibleEntries.length === 0) {
        setDrawState((current) => ({
          ...current,
          running: false,
          message: 'Este sorteo todavia no tiene participantes cargados.',
        }));
        return;
      }

      const outcome = runRaffle(eligibleEntries, config.winners, config.alternates);
      setDrawState((current) => ({
        ...current,
        running: false,
        animationResult: {
          id: selectedRaffle.id,
          name: selectedRaffle.name,
          startAt: selectedRaffle.startAt,
          endAt: selectedRaffle.endAt,
          enabledBranches: selectedRaffle.enabledBranches,
          participantsCount: eligibleEntries.length,
          winnersCount: config.winners,
          alternatesCount: config.alternates,
          winners: outcome.winners,
          alternates: outcome.alternates,
        },
        message: 'Vista previa generada. Revisá el resultado y confirmá para cerrarlo.',
      }));
    } catch {
      setDrawState((current) => ({
        ...current,
        running: false,
        message: 'No se pudo preparar la vista previa del sorteo.',
      }));
    }
  }

async function exportDrawReport(result, mode = 'xlsx') {
  if (!result) {
    setDrawState((current) => ({
      ...current,
      message: 'No hay resultado disponible para exportar.',
    }));
    return;
  }

  if (mode === 'xlsx') {
    const XLSX = await import('xlsx');
    const rows = [
      ...(result.winners ?? []).map((item, index) => ({ tipo: 'Titular', orden: index + 1, ...item })),
      ...(result.alternates ?? []).map((item, index) => ({ tipo: 'Suplente', orden: index + 1, ...item })),
    ]
      .sort(compareDrawExportRows)
      .map((row) => ({
        Sucursal: row.sucursal,
        Tipo: row.tipo,
        Orden: row.orden,
        Nombre: row.nombre,
        DNI: row.dni,
        Telefono: row.telefono,
        Sorteo: result.name,
        Modalidad: result.drawMode === 'branch' ? 'Por sucursal' : 'Global',
      }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 24 },
      { wch: 12 },
      { wch: 10 },
      { wch: 26 },
      { wch: 14 },
      { wch: 18 },
      { wch: 28 },
      { wch: 18 },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Resultados');
    XLSX.writeFile(workbook, `${result.name.replace(/[^\w.-]+/g, '_') || 'acta_sorteo'}.xlsx`);

    setDrawState((current) => ({
      ...current,
      message: 'Acta Excel generada correctamente.',
    }));
  }
}

  async function copyWhatsAppResult() {
    const result = drawState.animationResult ?? drawState.lastResult ?? completedRaffles[0];
    if (!result) {
      setDrawState((current) => ({
        ...current,
        message: 'No hay resultado disponible para copiar.',
      }));
      return;
    }

    const text = [
      `Resultado del sorteo: ${result.name}`,
      `Fecha: ${formatDateRange(result.startAt, result.endAt)}`,
      result.drawMode === 'branch'
        ? `Modalidad: por sucursal (${result.winnersPerGroup ?? 0} titulares y ${result.alternatesPerGroup ?? 0} suplentes por sucursal)`
        : 'Modalidad: todas las sucursales juntas',
      '',
      'Ganadores:',
      ...(result.winners ?? []).map((item, index) => `${index + 1}. ${item.nombre} - DNI ${item.dni} - ${item.sucursal}`),
      '',
      'Suplentes:',
      ...(result.alternates ?? []).map((item, index) => `${index + 1}. ${item.nombre} - DNI ${item.dni} - ${item.sucursal}`),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setDrawState((current) => ({
        ...current,
        message: 'Resultado copiado en formato WhatsApp.',
      }));
    } catch {
      setDrawState((current) => ({
        ...current,
        message: 'No se pudo copiar el texto para WhatsApp.',
      }));
    }
  }

  function renderActiveTab() {
    return (
      <Card>
        <SectionHeader
          title="Sorteos abiertos"
          description="Acá ves tanto los sorteos activos como los pausados. Elegí una tarjeta para administrarla sin perder el resto del contexto."
          aside={
            <button
              className="inline-flex items-center rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
              onClick={startNewRaffle}
              type="button"
            >
              Crear nuevo
            </button>
          }
        />

        <div className="grid gap-4 lg:grid-cols-2">
          {openRaffles.map((raffle) => {
            const selected = raffle.id === selectedRaffleId;
            const phase = getRafflePhase(raffle);

            return (
                <button
                  className={`rounded-[22px] border px-5 py-5 text-left transition ${
                    selected
                      ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] shadow-[var(--card-shadow)]'
                      : 'border-[var(--border-soft)] bg-[var(--panel)] hover:-translate-y-0.5 hover:border-[var(--accent-strong)]/50 hover:shadow-[var(--card-shadow)]'
                  }`}
                  key={raffle.id}
                  onClick={() => setSelectedRaffleId(raffle.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">{raffle.name}</p>
                    <p className="mt-2 text-sm text-[var(--text-secondary)]">{formatDateRange(raffle.startAt, raffle.endAt)}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] ${badgeClasses(phase.tone)}`}>
                    {phase.label}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {(raffle.enabledBranches ?? []).map((branch) => (
                    <span
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-muted)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                      key={branch}
                    >
                      {branch}
                    </span>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-[var(--border-soft)] pt-4 text-sm">
                  <span className="text-[var(--text-secondary)]">Participantes cargados</span>
                  <span className="font-medium text-[var(--text-primary)]">{raffle.participantsCount ?? 0}</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-[var(--border-soft)] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                    Click para abrir detalle
                  </span>
                </div>
              </button>
            );
          })}

          {openRaffles.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-[var(--border-soft)] bg-[var(--panel)] px-5 py-6 text-sm text-[var(--text-secondary)]">
              Todavía no hay sorteos abiertos. Creá uno nuevo para empezar.
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  function renderParticipantsTab() {
    return (
      <Card>
        <SectionHeader
          title="Participantes del sorteo seleccionado"
          description="Podés trabajar sobre el sorteo actual o revisar todas las inscripciones históricas con filtros por texto, sucursal y fecha."
          aside={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
              <select
                className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)] sm:w-auto"
                onChange={(event) => setParticipantScope(event.target.value)}
                value={participantScope}
              >
                <option value="selected">Sorteo seleccionado</option>
                <option value="all">Todos los sorteos</option>
              </select>
              <input
                className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                onChange={(event) => setParticipantSearch(event.target.value)}
                placeholder="Buscar participante..."
                value={participantSearch}
              />
              <select
                className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)] sm:w-auto"
                onChange={(event) => setParticipantBranchFilter(event.target.value)}
                value={participantBranchFilter}
              >
                <option value="all">Todas las sucursales</option>
                {BRANCHES.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
              <input
                className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)] sm:w-auto"
                onChange={(event) => setParticipantDateFrom(event.target.value)}
                type="date"
                value={participantDateFrom}
              />
              <input
                className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)] sm:w-auto"
                onChange={(event) => setParticipantDateTo(event.target.value)}
                type="date"
                value={participantDateTo}
              />
              <button
                className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)] sm:w-auto"
                onClick={exportParticipantsCsv}
                type="button"
              >
                Exportar CSV
              </button>
            </div>
          }
        />

        {inconsistentParticipants.length > 0 ? (
          <div className="mb-5 rounded-[20px] border border-amber-400/30 bg-amber-400/10 px-4 py-4 text-sm text-amber-500">
            <p className="font-medium">Se detectaron posibles inconsistencias por DNI.</p>
            <div className="mt-2 space-y-1">
              {inconsistentParticipants.slice(0, 5).map((item) => (
                <p key={item.dni}>
                  DNI {item.dni} · nombres: {item.nombres.join(' / ')} · teléfonos: {item.telefonos.join(' / ')}
                </p>
              ))}
              {inconsistentParticipants.length > 5 ? <p>Y {inconsistentParticipants.length - 5} casos más.</p> : null}
            </div>
          </div>
        ) : null}

        {participantScope === 'all' || selectedRaffle ? (
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="overflow-x-auto rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel)]">
              <div className="min-w-[760px] grid grid-cols-[1.1fr_0.7fr_0.9fr_0.9fr_1fr] gap-4 border-b border-[var(--border-soft)] px-4 py-3 text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                <span>Nombre</span>
                <span>DNI</span>
                <span>Teléfono</span>
                <span>Sucursal</span>
                <span>Sorteo</span>
              </div>
              <div className="max-h-[480px] overflow-auto">
                {filteredParticipants.map((participant) => (
                  <button
                    className={`min-w-[760px] grid w-full grid-cols-[1.1fr_0.7fr_0.9fr_0.9fr_1fr] gap-4 border-b border-[var(--border-soft)] px-4 py-3 text-left text-sm last:border-b-0 ${
                      selectedParticipantId === participant.id
                        ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
                        : 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--panel-muted)]'
                    }`}
                    key={participant.id}
                    onClick={() => setSelectedParticipantId(participant.id)}
                    type="button"
                  >
                    <span>{participant.nombre}</span>
                    <span>{participant.dni}</span>
                    <span>{participant.telefono}</span>
                    <span className="text-[var(--text-secondary)]">{participant.sucursal}</span>
                    <span className="text-[var(--text-secondary)]">{participant.raffleName ?? 'Sin datos'}</span>
                  </button>
                ))}
                {filteredParticipants.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-[var(--text-secondary)]">No hay participantes que coincidan con la búsqueda.</div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm uppercase tracking-[0.22em] text-[var(--accent-strong)]">Detalle de la inscripción</p>
                <div className="flex flex-wrap gap-2">
                  {selectedParticipant && currentJornada ? (
                    <button
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                      onClick={allowOneMoreRegistration}
                      type="button"
                    >
                      Registrar otra chance
                    </button>
                  ) : null}
                  {selectedParticipant ? (
                    <button
                      className="rounded-full border border-[var(--accent-strong)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent-strong)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={participantSaving}
                      onClick={saveParticipantEdit}
                      type="button"
                    >
                      {participantSaving ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                  ) : null}
                </div>
              </div>
              {selectedParticipant ? (
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Nombre</p>
                    <input
                      className="mt-2 w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                      name="nombre"
                      onChange={updateParticipantForm}
                      value={participantForm.nombre}
                    />
                  </label>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">DNI</p>
                    <p className="mt-2 rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--text-primary)]">{selectedParticipant.dni}</p>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">El DNI queda solo lectura para no romper el historial y la base de clientes.</p>
                  </div>
                  <label className="block">
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Teléfono</p>
                    <input
                      className="mt-2 w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                      name="telefono"
                      onChange={updateParticipantForm}
                      value={participantForm.telefono}
                    />
                  </label>
                  <label className="block">
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Sucursal</p>
                    <select
                      className="mt-2 w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                      name="sucursal"
                      onChange={updateParticipantForm}
                      value={participantForm.sucursal}
                    >
                      {BRANCHES.map((branch) => (
                        <option key={`participant-edit-${branch}`} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Sorteo</p>
                    <p className="mt-1 text-sm text-[var(--text-primary)]">{selectedParticipant.raffleName ?? 'Sin datos'}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Fecha de inscripción</p>
                    <p className="mt-1 text-sm text-[var(--text-primary)]">
                      {selectedParticipant.timestamp ? formatDate(selectedParticipant.timestamp) : 'Sin datos'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
                  Elegí una inscripción de la tabla para ver y editar sus datos desde el panel admin.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--border-soft)] bg-[var(--panel)] p-5 text-sm leading-6 text-[var(--text-secondary)]">
            Elegí un sorteo activo para ver su lista de participantes.
          </div>
        )}
      </Card>
    );
  }

  function renderHistoryTab() {
    return (
      <Card>
        <SectionHeader
          title="Historial de sorteos cerrados"
          description="La lista muestra un resumen limpio. Abrí sólo el que te interese para ver ganadores, suplentes y sucursales."
        />

        <div className="space-y-4">
          {completedRaffles.map((raffle) => {
            const expanded = historyExpandedId === raffle.id;

            return (
              <div className="rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel)] p-5" key={raffle.id}>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium text-[var(--text-primary)]">{raffle.name}</p>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">{formatDateRange(raffle.startAt, raffle.endAt)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-[var(--border-soft)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                        {raffle.drawMode === 'branch' ? 'Por sucursal' : 'Global'}
                      </span>
                      <span className="rounded-full border border-[var(--border-soft)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                        {raffle.drawMode === 'branch'
                          ? `${raffle.winnersPerGroup ?? 0} titulares x sucursal`
                          : `${raffle.winnersPerGroup ?? raffle.winnersCount ?? 0} titulares`}
                      </span>
                      <span className="rounded-full border border-[var(--border-soft)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                        {raffle.drawMode === 'branch'
                          ? `${raffle.alternatesPerGroup ?? 0} suplentes x sucursal`
                          : `${raffle.alternatesPerGroup ?? raffle.alternatesCount ?? 0} suplentes`}
                      </span>
                      <span className="rounded-full border border-[var(--border-soft)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                        {raffle.participantsCount ?? 0} participantes
                      </span>
                      <span className="rounded-full border border-[var(--border-soft)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                        {raffle.winnersCount ?? 0} ganadores
                      </span>
                      <span className="rounded-full border border-[var(--border-soft)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                        {raffle.alternatesCount ?? 0} suplentes
                      </span>
                    </div>
                  </div>

                  <div className="flex min-w-[220px] flex-col items-start gap-3 text-left md:items-end md:text-right">
                    <span className="text-xs uppercase tracking-[0.25em] text-[var(--accent-strong)] md:max-w-[220px]">
                      Cerrado {formatDate(raffle.completedAt)}
                    </span>
                    <button
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:-translate-y-0.5 hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                      onClick={() => exportDrawReport(raffle, 'xlsx')}
                      type="button"
                    >
                      Exportar Excel
                    </button>
                    <button
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:-translate-y-0.5 hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                      onClick={() => setHistoryExpandedId(expanded ? null : raffle.id)}
                      type="button"
                    >
                      {expanded ? 'Ocultar detalle' : 'Ver detalle'}
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <div className="mt-5 border-t border-[var(--border-soft)] pt-5">
                    <div className="mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-4 text-sm text-[var(--text-secondary)]">
                      {raffle.drawMode === 'branch'
                        ? `Configuración usada: ${raffle.winnersPerGroup ?? 0} titular(es) y ${raffle.alternatesPerGroup ?? 0} suplente(s) por cada sucursal habilitada.`
                        : `Configuración usada: ${raffle.winnersPerGroup ?? raffle.winnersCount ?? 0} titular(es) y ${raffle.alternatesPerGroup ?? raffle.alternatesCount ?? 0} suplente(s) en una sola bolsa global.`}
                    </div>
                    <div className="mb-4 flex flex-wrap gap-2">
                      {(raffle.enabledBranches ?? []).map((branch) => (
                        <span
                          className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-muted)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                          key={`${raffle.id}-${branch}`}
                        >
                          {branch}
                        </span>
                      ))}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[var(--accent-strong)]">Ganadores</p>
                        <div className="space-y-3">
                          {(raffle.winners ?? []).map((item, index) => (
                            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] p-4" key={`winner-${raffle.id}-${index}`}>
                              <p className="font-medium text-[var(--text-primary)]">{item.nombre}</p>
                              <p className="text-sm text-[var(--text-secondary)]">DNI {item.dni} · {item.telefono}</p>
                              <p className="text-xs uppercase tracking-[0.25em] text-[var(--accent-strong)]">{item.sucursal}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[var(--accent-strong)]">Suplentes</p>
                        <div className="space-y-3">
                          {(raffle.alternates ?? []).map((item, index) => (
                            <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] p-4" key={`alternate-${raffle.id}-${index}`}>
                              <p className="font-medium text-[var(--text-primary)]">{item.nombre}</p>
                              <p className="text-sm text-[var(--text-secondary)]">DNI {item.dni} · {item.telefono}</p>
                              <p className="text-xs uppercase tracking-[0.25em] text-[var(--accent-strong)]">{item.sucursal}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {completedRaffles.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Todavía no hay sorteos archivados.</p> : null}
        </div>
      </Card>
    );
  }

  function renderCustomersTab() {
    return (
      <Card>
        <SectionHeader
          title="Base de clientes"
          description="Acá queda consolidada la información de quienes participaron, agrupada por DNI para futuras campañas y acciones comerciales."
          aside={
            <div className="flex flex-wrap gap-2">
              <input
                className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)] md:w-72"
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Buscar cliente..."
                value={customerSearch}
              />
              <select
                className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                onChange={(event) => setCustomerBranchFilter(event.target.value)}
                value={customerBranchFilter}
              >
                <option value="all">Todas las sucursales</option>
                {BRANCHES.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
              <select
                className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                onChange={(event) => setCustomerParticipationLevel(event.target.value)}
                value={customerParticipationLevel}
              >
                <option value="all">Todas las participaciones</option>
                <option value="2+">2 o más</option>
                <option value="5+">5 o más</option>
              </select>
              <button
                className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                onClick={exportCustomersCsv}
                type="button"
              >
                Exportar clientes
              </button>
            </div>
          }
        />

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="overflow-hidden rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel)]">
            <div className="grid grid-cols-[0.8fr_1.1fr_1fr_1.2fr_0.7fr_1fr] gap-4 border-b border-[var(--border-soft)] px-4 py-3 text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">
              <span>DNI</span>
              <span>Nombre</span>
              <span>Teléfono</span>
              <span>Sucursales</span>
              <span>Chances</span>
              <span>Último sorteo</span>
            </div>
            <div className="max-h-[520px] overflow-auto">
              {filteredCustomers.map((customer) => (
                <button
                  className={`grid w-full grid-cols-[0.8fr_1.1fr_1fr_1.2fr_0.7fr_1fr] gap-4 border-b border-[var(--border-soft)] px-4 py-3 text-left text-sm last:border-b-0 ${
                    selectedCustomerId === customer.id
                      ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
                      : 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--panel-muted)]'
                  }`}
                  key={customer.id}
                  onClick={() => setSelectedCustomerId(customer.id)}
                  type="button"
                >
                  <span>{customer.dni}</span>
                  <span>{customer.nombre}</span>
                  <span>{customer.telefono}</span>
                  <span className="text-[var(--text-secondary)]">{(customer.sucursales ?? []).join(', ')}</span>
                  <span>{customer.totalParticipations ?? 0}</span>
                  <span className="text-[var(--text-secondary)]">{customer.lastRaffleName ?? 'Sin datos'}</span>
                </button>
              ))}
              {filteredCustomers.length === 0 ? (
                <div className="px-4 py-8 text-sm text-[var(--text-secondary)]">No hay clientes que coincidan con la búsqueda.</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[22px] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
            <p className="text-sm uppercase tracking-[0.22em] text-[var(--accent-strong)]">Detalle del cliente</p>
            {selectedCustomer ? (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Nombre</p>
                  <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{selectedCustomer.nombre}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">DNI</p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{selectedCustomer.dni}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Teléfono</p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{selectedCustomer.telefono}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Sucursales</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(selectedCustomer.sucursales ?? []).map((branch) => (
                      <span
                        className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-muted)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                        key={`${selectedCustomer.id}-${branch}`}
                      >
                        {branch}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Total de participaciones</p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{selectedCustomer.totalParticipations ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Último sorteo</p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{selectedCustomer.lastRaffleName ?? 'Sin datos'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">Última participación</p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{selectedCustomer.lastParticipationAt ? formatDate(selectedCustomer.lastParticipationAt) : 'Sin datos'}</p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
                Elegí un cliente de la tabla para ver su información consolidada.
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  function LazyTabFallback() {
    return (
      <Card>
        <div className="flex min-h-[220px] items-center justify-center">
          <LoadingDots label="Cargando sección" />
        </div>
      </Card>
    );
  }

  if (!isUnlocked) {
    return (
      <Shell
        eyebrow=""
        title="Acceso al panel administrativo"
        description="Ingresa con tu cuenta autorizada para abrir el tablero de operacion de sorteos."
      >
        {!authReady ? (
          <Card>
            <div className="flex min-h-[220px] items-center justify-center">
              <LoadingDots label="Preparando acceso" />
            </div>
          </Card>
        ) : (
          <form className="max-w-md space-y-5" onSubmit={handleUnlock}>
            <label className="space-y-2">
              <span className="text-sm text-[var(--text-secondary)]">Email admin</span>
              <input
                className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                onChange={(event) => setAdminEmailInput(event.target.value)}
                placeholder="nxialab@gmail.com"
                type="email"
                value={adminEmailInput}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-[var(--text-secondary)]">Contrasena</span>
              <input
                className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel-muted)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                onChange={(event) => setAdminPasswordInput(event.target.value)}
                placeholder="Ingresa la contrasena"
                type="password"
                value={adminPasswordInput}
              />
            </label>

            <button
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-strong)] px-6 py-3 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={authenticating}
              type="submit"
            >
              {authenticating ? "Ingresando..." : "Ingresar al admin"}
            </button>

            {authError ? (
              <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-500">
                {authError}
              </div>
            ) : null}
          </form>
        )}
      </Shell>
    );
  }

  return (
    <Shell
      eyebrow="Gestión operativa"
      title="Administración de sorteos"
      description=""
      quickAccess={
        <div className="flex flex-wrap items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2">
          <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-strong)]">
            Registro cliente
          </span>
          <select
            className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-muted)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)]"
            onChange={(event) => setManualRegisterBranch(event.target.value)}
            value={manualRegisterBranch}
          >
            {selectedRaffle?.enabledBranches?.length ? (
              selectedRaffle.enabledBranches.map((branch) => (
                <option key={`manual-register-${branch}`} value={branch}>
                  {branch}
                </option>
              ))
            ) : (
              <option value="">Sin sucursal activa</option>
            )}
          </select>
          <button
            className="inline-flex items-center rounded-full border border-[var(--accent-strong)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent-strong)] transition hover:-translate-y-0.5 hover:shadow-[var(--card-shadow)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!selectedRaffle?.enabledBranches?.length}
            onClick={openManualRegister}
            type="button"
          >
            Abrir registro
          </button>
          <button
            className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-[var(--card-shadow)] disabled:cursor-not-allowed disabled:opacity-60 ${
              publicAccess.registrationsEnabled
                ? 'border border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border border-rose-400/30 bg-rose-400/10 text-rose-300'
            }`}
            disabled={publicAccessSaving}
            onClick={handleTogglePublicAccess}
            type="button"
          >
            {publicAccessSaving
              ? 'Actualizando...'
              : publicAccess.registrationsEnabled
                ? 'Cerrar inscripciones'
                : 'Abrir inscripciones'}
          </button>
        </div>
      }
      actions={
        <button
          className="inline-flex items-center rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
          onClick={handleLogout}
          type="button"
        >
          Cerrar sesión
        </button>
      }
      aside={
        <>
          <Card title="Sorteos activos" value={String(activeRaffles.length)} subtitle="Campañas vigentes en paralelo." />
          <Card title="Sorteos por vencer" value={String(expiringSoonRaffles.length)} subtitle="Vencen en menos de 24 horas." accent="blue" />
          <Card title="Participantes visibles" value={String(participants.length)} subtitle={selectedRaffle ? selectedRaffle.name : 'Elegí un sorteo para inspeccionar.'} accent="blue" />
          <Card title="Clientes guardados" value={String(customers.length)} subtitle="Base consolidada reutilizable." accent="slate" />
          <Card title="Participantes históricos" value={String(totalCompletedParticipants)} subtitle="Total acumulado de campañas cerradas." accent="slate" />
        </>
      }
    >
      <div className="space-y-6">
        <div className="sticky top-4 z-20 rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel-muted)] p-4 shadow-[var(--card-shadow)] backdrop-blur sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">
                    {selectedRaffle ? selectedRaffle.name : 'Ningún sorteo seleccionado'}
                  </h2>
                  <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] ${badgeClasses(selectedPhase.tone)}`}>
                    {selectedPhase.label}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {selectedRaffle
                    ? `${formatDateRange(selectedRaffle.startAt, selectedRaffle.endAt)} · ${(selectedRaffle.enabledBranches ?? []).join(', ')}`
                    : 'Elegí un sorteo activo desde la pestaña Activos o creá uno nuevo.'}
                </p>
                {selectedRaffle ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedRaffle.status === 'active' ? (
                      <button
                        className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                        onClick={pauseSelectedRaffle}
                        type="button"
                      >
                        Pausar
                      </button>
                    ) : null}
                    {selectedRaffle.status === 'paused' ? (
                      <button
                        className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                        onClick={reactivateSelectedRaffle}
                        type="button"
                      >
                        Reactivar
                      </button>
                    ) : null}
                    <button
                      className="rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-500 transition hover:border-rose-400/50"
                      onClick={closeSelectedRaffleManually}
                      type="button"
                    >
                      Cerrar manualmente
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
              {TABS.map((tab) => (
                <button
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    activeTab === tab.id
                      ? 'border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                      : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--text-secondary)] hover:border-[var(--accent-strong)]/50 hover:text-[var(--text-primary)]'
                  }`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{ minWidth: 'fit-content' }}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {drawState.message && !dismissedDrawMessage ? (
          <div className={`flex items-start justify-between gap-4 rounded-[24px] border px-5 py-4 text-sm ${badgeClasses(bannerTone)}`}>
            <p>{drawState.message}</p>
            <button
              className="rounded-full border border-current/20 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] opacity-70 transition hover:opacity-100"
              onClick={() => setDismissedDrawMessage(true)}
              type="button"
            >
              Cerrar
            </button>
          </div>
        ) : null}

        {expiringSoonRaffles.length > 0 && !dismissedExpiringReminder ? (
          <div className="rounded-[24px] border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-sm text-amber-500">
            <div className="flex items-start justify-between gap-4">
              <p className="font-medium">Recordatorio: hay sorteos por vencer en menos de 24 horas.</p>
              <button
                className="rounded-full border border-current/20 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] opacity-70 transition hover:opacity-100"
                onClick={() => setDismissedExpiringReminder(true)}
                type="button"
              >
                Cerrar
              </button>
            </div>
            <div className="mt-2 space-y-1">
              {expiringSoonRaffles.map((raffle) => (
                <p key={raffle.id}>
                  {raffle.name} · cierra {formatDate(raffle.endAt)}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === 'active' ? renderActiveTab() : null}
        {activeTab === 'builder' ? (
          <Suspense fallback={<LazyTabFallback />}>
            <BuilderTab
              branches={BRANCHES}
              enabledBranches={enabledBranches}
              omittedBranches={omittedBranches}
              overlapWarnings={overlapWarnings}
              persistRaffle={persistRaffle}
              raffleForm={raffleForm}
              selectedPhase={selectedPhase}
              selectedRaffle={selectedRaffle}
              startNewRaffle={startNewRaffle}
              toggleBranch={toggleBranch}
              updateRaffleDate={updateRaffleDate}
              updateRaffleForm={updateRaffleForm}
            />
          </Suspense>
        ) : null}
        {activeTab === 'participants' ? renderParticipantsTab() : null}
        {activeTab === 'customers' ? renderCustomersTab() : null}
        {activeTab === 'history' ? renderHistoryTab() : null}
        {activeTab === 'qr' ? (
          <Suspense fallback={<LazyTabFallback />}>
            <QrTab branchLinks={branchLinks} currentJornada={currentJornada} />
          </Suspense>
        ) : null}

        {selectedRaffle ? (
          <Card>
            <SectionHeader
              title="Ejecución del sorteo"
              description="El sorteo se ejecuta en una sola corrida, con azar puro y revelación progresiva de titulares y suplentes."
              aside={
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                    onClick={runAnimatedDraw}
                    type="button"
                  >
                    {drawState.running ? 'Sorteando...' : 'Sortear ahora'}
                  </button>
                </div>
              }
            />

            <div className="grid gap-4 md:grid-cols-4">
              <label className="space-y-2">
                <span className="text-sm text-[var(--text-secondary)]">Modalidad</span>
                <select
                  className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                  name="drawMode"
                  onChange={updateConfig}
                  value={config.drawMode}
                >
                  <option value="global">Todas las sucursales juntas</option>
                  <option value="branch">Un ranking por sucursal</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm text-[var(--text-secondary)]">
                  {config.drawMode === 'branch' ? 'Titulares por sucursal' : 'Titulares'}
                </span>
                <input
                  className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                  min="0"
                  name="winners"
                  onChange={updateConfig}
                  type="number"
                  value={config.winners}
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-[var(--text-secondary)]">
                  {config.drawMode === 'branch' ? 'Suplentes por sucursal' : 'Suplentes'}
                </span>
                <input
                  className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-strong)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                  min="0"
                  name="alternates"
                  onChange={updateConfig}
                  type="number"
                  value={config.alternates}
                />
              </label>
              <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3">
                <p className="text-sm text-[var(--text-secondary)]">
                  {config.drawMode === 'branch' ? 'Sucursales en juego' : 'Participantes disponibles'}
                </p>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">
                  {config.drawMode === 'branch' ? selectedRaffle.enabledBranches?.length ?? 0 : participants.length}
                </p>
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  {config.drawMode === 'branch'
                    ? `${config.winners} titular(es) y ${config.alternates} suplente(s) por cada sucursal habilitada.`
                    : 'Se sortea una sola bolsa con todas las sucursales habilitadas.'}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-4 text-sm text-[var(--text-secondary)]">
              {buildDrawSummary(config, selectedRaffle)}
            </div>

            {drawState.animationResult ? (
              <div className="mt-5 rounded-[22px] border border-[var(--accent-strong)] bg-[var(--accent-soft)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm uppercase tracking-[0.22em] text-[var(--accent-strong)]">
                      {drawState.running ? 'Bolillero en marcha' : 'Resultado del sorteo'}
                    </p>
                    <p className="mt-1 text-sm text-[var(--text-primary)]">
                      {drawState.animationResult.participantsCount} participantes · {drawState.animationResult.winnersCount} ganadores · {drawState.animationResult.alternatesCount} suplentes
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                      {drawState.animationResult.drawMode === 'branch'
                        ? `${drawState.animationResult.winnersPerGroup} titular(es) y ${drawState.animationResult.alternatesPerGroup} suplente(s) por sucursal`
                        : `${drawState.animationResult.winnersPerGroup} titular(es) y ${drawState.animationResult.alternatesPerGroup} suplente(s) globales`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                      onClick={() => exportDrawReport(drawState.animationResult, 'csv')}
                      type="button"
                    >
                      Exportar Excel
                    </button>
                    <button
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                      onClick={copyWhatsAppResult}
                      type="button"
                    >
                      Copiar WhatsApp
                    </button>
                  </div>
                </div>

                <div className="mt-5 rounded-[24px] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-[var(--text-secondary)]">
                        {drawState.rollingLabel || 'Esperando inicio'}
                      </p>
                      <p className="mt-2 text-sm text-[var(--text-secondary)]">
                        Paso {drawState.revealStep || 0} de {drawState.animationResult.winnersCount + drawState.animationResult.alternatesCount}
                      </p>
                    </div>
                    <div className="raffle-drum">
                      <div className="raffle-drum__halo" />
                      <div className={`raffle-ball ${drawState.running ? 'raffle-ball--rolling' : ''}`}>
                        <span className="raffle-ball__label">
                          {drawState.rollingEntry ? drawState.rollingEntry.nombre : 'Listo'}
                        </span>
                        {drawState.rollingEntry ? (
                          <span className="raffle-ball__meta">
                            DNI {drawState.rollingEntry.dni} · {drawState.rollingEntry.sucursal}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[var(--accent-strong)]">Titulares</p>
                    <div className="space-y-3">
                      {drawState.animationResult.winners.map((item, index) => (
                        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-4" key={`preview-winner-${item.dni}-${index}`}>
                          <p className="font-medium text-[var(--text-primary)]">{index + 1}. {item.nombre}</p>
                          <p className="text-sm text-[var(--text-secondary)]">DNI {item.dni} · {item.telefono}</p>
                          <p className="text-xs uppercase tracking-[0.25em] text-[var(--accent-strong)]">{item.sucursal}</p>
                        </div>
                      ))}
                      {drawState.animationResult.winners.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-[var(--border-soft)] bg-[var(--panel)] p-4 text-sm text-[var(--text-secondary)]">
                          Acá se irá armando el ranking de titulares.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[var(--accent-strong)]">Suplentes</p>
                    <div className="space-y-3">
                      {drawState.animationResult.alternates.map((item, index) => (
                        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-4" key={`preview-alt-${item.dni}-${index}`}>
                          <p className="font-medium text-[var(--text-primary)]">{index + 1}. {item.nombre}</p>
                          <p className="text-sm text-[var(--text-secondary)]">DNI {item.dni} · {item.telefono}</p>
                          <p className="text-xs uppercase tracking-[0.25em] text-[var(--accent-strong)]">{item.sucursal}</p>
                        </div>
                      ))}
                      {drawState.animationResult.alternates.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-[var(--border-soft)] bg-[var(--panel)] p-4 text-sm text-[var(--text-secondary)]">
                          Los suplentes aparecerán cuando termine la ronda de titulares.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </Card>
        ) : null}

        {drawState.lastResult ? (
          <Card>
            <SectionHeader
              title="Último resultado ejecutado"
              description="Chequeo rápido para validar visualmente el sorteo antes de comunicarlo."
              aside={
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-full border border-[var(--accent-strong)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent-strong)] transition hover:opacity-90"
                    onClick={finishDrawSession}
                    type="button"
                  >
                    Terminar sorteo
                  </button>
                  <button
                    className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                    onClick={() => exportDrawReport(drawState.lastResult, 'csv')}
                    type="button"
                  >
                    Exportar Excel
                  </button>
                  <button
                    className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                    onClick={copyWhatsAppResult}
                    type="button"
                  >
                    Copiar WhatsApp
                  </button>
                  <button
                    className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-strong)] hover:text-[var(--accent-strong)]"
                    onClick={copyLatestResult}
                    type="button"
                  >
                    Copiar resultado
                  </button>
                </div>
              }
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[var(--accent-strong)]">Ganadores</p>
                <div className="space-y-3">
                  {drawState.lastResult.winners.map((item, index) => (
                    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-4" key={`${item.dni}-${index}`}>
                      <p className="font-medium text-[var(--text-primary)]">{item.nombre}</p>
                      <p className="text-sm text-[var(--text-secondary)]">DNI {item.dni} · {item.telefono}</p>
                      <p className="text-xs uppercase tracking-[0.25em] text-[var(--accent-strong)]">{item.sucursal}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm uppercase tracking-[0.3em] text-[var(--accent-strong)]">Suplentes</p>
                <div className="space-y-3">
                  {drawState.lastResult.alternates.map((item, index) => (
                    <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-4" key={`${item.dni}-${index}`}>
                      <p className="font-medium text-[var(--text-primary)]">{item.nombre}</p>
                      <p className="text-sm text-[var(--text-secondary)]">DNI {item.dni} · {item.telefono}</p>
                      <p className="text-xs uppercase tracking-[0.25em] text-[var(--accent-strong)]">{item.sucursal}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </Shell>
  );
}
