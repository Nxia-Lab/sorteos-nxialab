export function formatDate(value) {
  if (!value) {
    return 'Pendiente';
  }

  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDateRange(startAt, endAt) {
  if (!startAt || !endAt) {
    return 'Sin definir';
  }

  return `${formatDate(startAt)} a ${formatDate(endAt)}`;
}

export function toDatetimeLocalValue(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function normalizeBranch(value) {
  if (!value) {
    return '';
  }

  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

const WEEKDAY_WINDOWS = {
  1: [
    { key: 'morning', startMinutes: 8 * 60, endMinutes: 13 * 60 },
    { key: 'evening', startMinutes: 16 * 60 + 30, endMinutes: 20 * 60 + 30 },
  ],
  2: [
    { key: 'morning', startMinutes: 8 * 60, endMinutes: 13 * 60 },
    { key: 'evening', startMinutes: 16 * 60 + 30, endMinutes: 20 * 60 + 30 },
  ],
  3: [
    { key: 'morning', startMinutes: 8 * 60, endMinutes: 13 * 60 },
    { key: 'evening', startMinutes: 16 * 60 + 30, endMinutes: 20 * 60 + 30 },
  ],
  4: [
    { key: 'morning', startMinutes: 8 * 60, endMinutes: 13 * 60 },
    { key: 'evening', startMinutes: 16 * 60 + 30, endMinutes: 20 * 60 + 30 },
  ],
  5: [
    { key: 'morning', startMinutes: 8 * 60, endMinutes: 13 * 60 },
    { key: 'evening', startMinutes: 16 * 60 + 30, endMinutes: 20 * 60 + 30 },
  ],
  6: [{ key: 'morning', startMinutes: 8 * 60 + 30, endMinutes: 13 * 60 }],
};

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatClock(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${pad2(hours)}:${pad2(mins)}`;
}

function buildDateWithMinutes(baseDate, minutes) {
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    Math.floor(minutes / 60),
    minutes % 60,
    0,
    0,
  );
}

function getWindowLabel(date, window) {
  return `${DAY_LABELS[date.getDay()]} ${formatClock(window.startMinutes)} - ${formatClock(window.endMinutes)}`;
}

function getWindowDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getJornadaSchedule(date = new Date()) {
  return WEEKDAY_WINDOWS[date.getDay()] ?? [];
}

export function getCurrentJornada(date = new Date()) {
  const windows = getJornadaSchedule(date);
  const currentTime = date.getHours() * 60 + date.getMinutes();
  const activeWindow = windows.find((window) => currentTime >= window.startMinutes && currentTime < window.endMinutes);

  if (!activeWindow) {
    return null;
  }

  const startAt = buildDateWithMinutes(date, activeWindow.startMinutes);
  const endAt = buildDateWithMinutes(date, activeWindow.endMinutes);
  const dateKey = getWindowDateKey(date);
  const jornadaKey = `${dateKey}-${activeWindow.key}`;

  return {
    key: jornadaKey,
    label: getWindowLabel(date, activeWindow),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    dateKey,
    slotKey: activeWindow.key,
  };
}

export function getJornadaStatus(date = new Date()) {
  const current = getCurrentJornada(date);
  if (current) {
    return current;
  }

  const daySchedule = getJornadaSchedule(date);
  if (daySchedule.length === 0) {
    return {
      key: '',
      label: 'Cerrado hoy',
      startAt: null,
      endAt: null,
      dateKey: getWindowDateKey(date),
      slotKey: '',
    };
  }

  const nextWindow = daySchedule[0];
  return {
    key: `${getWindowDateKey(date)}-${nextWindow.key}`,
    label: `Próxima jornada ${formatClock(nextWindow.startMinutes)} - ${formatClock(nextWindow.endMinutes)}`,
    startAt: buildDateWithMinutes(date, nextWindow.startMinutes).toISOString(),
    endAt: buildDateWithMinutes(date, nextWindow.endMinutes).toISOString(),
    dateKey: getWindowDateKey(date),
    slotKey: nextWindow.key,
  };
}
