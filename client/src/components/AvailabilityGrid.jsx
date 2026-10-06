import { formatClock } from '../utils/format.js';
import { SLOT_STATUS, TONES } from '../utils/status.js';
import { cx } from './ui.jsx';

/**
 * Slot-by-slot availability returned by the API. Every slot shows a text
 * status and symbol (not just a colour). With `onSelect`, users pick a
 * contiguous range: first click sets the start, a later click extends it.
 */
export default function AvailabilityGrid({ availability, selection, onSelect }) {
  if (!availability.open) {
    return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Closed on this day — no bookable hours.</p>;
  }
  const { slots } = availability;

  const inSelection = (slot) => selection?.start && slot.startTime >= selection.start && slot.endTime <= selection.end;

  const handleClick = (slot) => {
    if (!onSelect) return;
    const selectable = slot.status !== 'PAST' && slot.status !== 'OUTSIDE_WINDOW';
    if (!selectable) return;
    if (selection?.start && slot.startTime >= selection.end && !selection.locked) {
      onSelect({ start: selection.start, end: slot.endTime, locked: true });
    } else if (selection?.start && slot.startTime === selection.start && !selection.locked) {
      onSelect({ start: slot.startTime, end: slot.endTime, locked: true });
    } else {
      onSelect({ start: slot.startTime, end: slot.endTime, locked: false });
    }
  };

  const used = [...new Set(slots.map((s) => s.status))];

  return (
    <div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Time slots">
        {slots.map((slot) => {
          const meta = SLOT_STATUS[slot.status];
          const selected = inSelection(slot);
          const interactive = onSelect && !['PAST', 'OUTSIDE_WINDOW'].includes(slot.status);
          return (
            <li key={slot.startTime}>
              <button
                type="button"
                disabled={!interactive}
                onClick={() => handleClick(slot)}
                aria-pressed={onSelect ? Boolean(selected) : undefined}
                title={slot.label}
                className={cx(
                  'flex w-full flex-col items-start rounded-lg px-3 py-2 text-left ring-1 ring-inset transition',
                  TONES[meta.tone],
                  interactive ? 'cursor-pointer hover:brightness-95' : 'cursor-default',
                  selected && 'outline-2 outline-offset-1 outline-brand-600 ring-brand-500',
                  slot.status === 'PAST' && 'opacity-60',
                )}
              >
                <span className="text-sm font-semibold">
                  {formatClock(slot.startTime)} – {formatClock(slot.endTime)}
                </span>
                <span className="text-xs">
                  <span aria-hidden="true">{meta.symbol} </span>
                  {slot.mine ? 'Your booking' : meta.label}
                  {slot.label ? ` · ${slot.label}` : ''}
                  {selected ? ' · selected' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500" aria-label="Legend">
        {used.map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <span className={cx('rounded px-1 ring-1 ring-inset', TONES[SLOT_STATUS[status].tone])} aria-hidden="true">
              {SLOT_STATUS[status].symbol}
            </span>
            {SLOT_STATUS[status].label}
          </span>
        ))}
      </div>
    </div>
  );
}
