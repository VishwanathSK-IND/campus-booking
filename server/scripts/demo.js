/**
 * Prepares live-demo bookings in Project Room 101 (open 24×7) through the real
 * booking service, using the application clock to place the booking time.
 *
 *   npm run demo -- check-in [email]  booking starting at the next quarter hour
 *                                      → check-in window is open right away
 *   npm run demo -- no-show [email]   booking that started 20 minutes ago and was
 *                                      never checked in → the scheduler (or
 *                                      Admin ▸ Run jobs now) marks it NO_SHOW
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/db.js';
import { Resource } from '../models/Resource.js';
import { User } from '../models/User.js';
import { createBooking } from '../services/bookingService.js';
import { clock } from '../utils/clock.js';
import { addMinutes, toLocalParts } from '../utils/time.js';

const [scenario, email = 'asha@campus.edu'] = process.argv.slice(2);

function quarter(date, direction) {
  const ms = 15 * 60 * 1000;
  return new Date((direction > 0 ? Math.ceil : Math.floor)(date.getTime() / ms) * ms);
}

async function main() {
  if (!['check-in', 'no-show'].includes(scenario)) {
    throw new Error('Usage: npm run demo -- <check-in|no-show> [email]');
  }
  await connectDatabase();
  const user = await User.findOne({ email });
  if (!user) throw new Error(`No user ${email}. Run npm run seed first.`);
  const room = await Resource.findOne({ name: 'Project Room 101' });
  if (!room) throw new Error('Project Room 101 not found. Run npm run seed first.');

  const now = new Date();
  // check-in: the current quarter hour if it began ≤10 min ago (window still open), else the next one.
  // no-show: the quarter hour ~20 min ago, so the 15-minute grace period has already passed.
  let startAt;
  if (scenario === 'check-in') {
    const current = quarter(now, -1);
    startAt = now - current <= 10 * 60 * 1000 ? current : quarter(now, 1);
  } else {
    startAt = quarter(addMinutes(now, -20), -1);
  }
  const start = toLocalParts(startAt);
  const end = toLocalParts(addMinutes(startAt, 60));
  const endTime = end.date !== start.date ? '24:00' : end.time; // never cross midnight

  // Book "an hour earlier" via the application clock so the start time is still in the future for validation.
  clock.set(addMinutes(startAt, -60));
  const { result } = await createBooking(user, {
    resourceId: room._id,
    date: start.date,
    startTime: start.time,
    endTime,
    purpose: scenario === 'check-in' ? 'Demo: QR check-in' : 'Demo: missed booking (no-show)',
  });
  clock.reset();

  console.log(`${result.code}  ${room.name}  ${result.date} ${result.startTime}–${result.endTime}  ${result.status}  (${user.email})`);
  if (scenario === 'check-in') {
    console.log('Open the booking as the student, show the kiosk (Admin ▸ Resources ▸ Kiosk QR) and scan/paste the code.');
  } else {
    console.log('The check-in window has closed. Within a minute the scheduler marks it NO_SHOW (or use Admin ▸ Run jobs now).');
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
