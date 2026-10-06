/** Visual + text metadata for statuses. Colour is never the only signal: every state has a label and a symbol. */
export const BOOKING_STATUS = {
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'amber', symbol: '◔' },
  CONFIRMED: { label: 'Confirmed', tone: 'green', symbol: '✓' },
  CHECKED_IN: { label: 'Checked in', tone: 'blue', symbol: '⦿' },
  COMPLETED: { label: 'Completed', tone: 'slate', symbol: '✔' },
  CANCELLED: { label: 'Cancelled', tone: 'gray', symbol: '✕' },
  REJECTED: { label: 'Rejected', tone: 'red', symbol: '✕' },
  NO_SHOW: { label: 'No-show', tone: 'red', symbol: '!' },
  EXPIRED: { label: 'Expired', tone: 'gray', symbol: '⌛' },
};

export const SLOT_STATUS = {
  AVAILABLE: { label: 'Available', tone: 'green', symbol: '○' },
  BOOKED: { label: 'Booked', tone: 'red', symbol: '●' },
  PENDING: { label: 'Pending approval', tone: 'amber', symbol: '◔' },
  HELD: { label: 'Held for waitlist', tone: 'violet', symbol: '◑' },
  BLOCKED: { label: 'Blocked', tone: 'slate', symbol: '▨' },
  MAINTENANCE: { label: 'Maintenance', tone: 'orange', symbol: '⚠' },
  UNAVAILABLE: { label: 'Unavailable', tone: 'gray', symbol: '–' },
  PAST: { label: 'Past', tone: 'gray', symbol: '–' },
  OUTSIDE_WINDOW: { label: 'Not yet bookable', tone: 'gray', symbol: '…' },
};

export const RESOURCE_STATUS = {
  ACTIVE: { label: 'Active', tone: 'green', symbol: '●' },
  MAINTENANCE: { label: 'Maintenance', tone: 'orange', symbol: '⚠' },
  INACTIVE: { label: 'Inactive', tone: 'gray', symbol: '○' },
};

export const WAITLIST_STATUS = {
  WAITING: { label: 'Waiting', tone: 'amber', symbol: '◔' },
  OFFERED: { label: 'Offer — action needed', tone: 'violet', symbol: '★' },
  ACCEPTED: { label: 'Accepted', tone: 'green', symbol: '✓' },
  DECLINED: { label: 'Declined', tone: 'gray', symbol: '✕' },
  EXPIRED: { label: 'Expired', tone: 'gray', symbol: '⌛' },
  CANCELLED: { label: 'Left waitlist', tone: 'gray', symbol: '✕' },
};

export const TONES = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  red: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  blue: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  violet: 'bg-violet-50 text-violet-800 ring-violet-600/20',
  orange: 'bg-orange-50 text-orange-800 ring-orange-600/25',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  gray: 'bg-gray-50 text-gray-500 ring-gray-400/20',
};
