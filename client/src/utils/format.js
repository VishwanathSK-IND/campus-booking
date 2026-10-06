export const TIMEZONE = import.meta.env.VITE_APP_TIMEZONE || 'Asia/Kolkata';

/** YYYY-MM-DD for "today" (+ offset days) in the campus timezone. */
export function campusDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
  return parts; // en-CA formats as YYYY-MM-DD
}

export function formatDate(date, options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!date) return '';
  // A plain YYYY-MM-DD is a campus calendar date; format it without timezone shifting.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date(date);
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: /^\d{4}-\d{2}-\d{2}$/.test(date) ? 'UTC' : TIMEZONE }).format(value);
}

export function formatDateTime(instant) {
  if (!instant) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIMEZONE,
  }).format(new Date(instant));
}

export function formatTime(instant) {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE }).format(new Date(instant));
}

/** "14:30" → "2:30 PM" */
export function formatClock(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (h === 24) return '12:00 AM';
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const timeRange = (b) => `${formatClock(b.startTime)} – ${formatClock(b.endTime)}`;

export function relativeTime(instant) {
  const diff = (new Date(instant).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

export const CATEGORY_LABELS = {
  LAB: 'Laboratory',
  HALL: 'Seminar hall',
  CLASSROOM: 'Classroom',
  SPORTS: 'Sports',
  EQUIPMENT: 'Equipment',
  ROOM: 'Room',
  OTHER: 'Other',
};

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
