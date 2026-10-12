/**
 * Demo data seeder. WIPES the configured database, then builds data through the
 * real services (not raw inserts): resources via resourceService, bookings via
 * bookingService (validation, slot locks, approvals, cancellations), check-ins
 * and the real background jobs for no-shows/completion.
 *
 * History is produced by moving the application clock back day by day and
 * replaying realistic activity, so analytics, no-show records and restrictions
 * are genuine outputs of the business logic.
 *
 * Usage: npm run seed            (refuses to run when NODE_ENV=production)
 *        npm run seed -- --force (allow in production)
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { runAllJobs } from '../jobs/scheduler.js';
import { Booking } from '../models/Booking.js';
import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { hashPassword } from '../services/authService.js';
import { approveBooking, cancelBooking, checkIn, createBooking, rejectBooking } from '../services/bookingService.js';
import { changeResourceStatus, createResource } from '../services/resourceService.js';
import { getActiveRestriction } from '../services/restrictionService.js';
import { joinWaitlist } from '../services/waitlistService.js';
import { clock } from '../utils/clock.js';
import { addDays, addMinutes, localToDate, todayLocal } from '../utils/time.js';

export const DEMO_PASSWORD = 'Campus@123';

const WEEKDAYS = (open, close) => [1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));
const EVERY_DAY = (open, close) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open, close }));

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261006);
const pick = (list) => list[Math.floor(random() * list.length)];

async function makeUser(name, email, role, department) {
  return User.create({ name, email, role, department, password: await hashPassword(DEMO_PASSWORD) });
}

const PURPOSES = ['DBMS lab practice', 'Mini-project build', 'Club meeting', 'Exam revision', 'Robotics team practice', 'Guest lecture prep', 'Hackathon practice', 'Lab record completion'];

async function main() {
  if (env.isProd && !process.argv.includes('--force')) {
    throw new Error('Refusing to wipe a production database without --force');
  }
  await connectDatabase();
  console.log(`Seeding ${mongoose.connection.name} — existing data will be removed`);
  await mongoose.connection.db.dropDatabase();
  await mongoose.connection.syncIndexes();

  // ── Users ────────────────────────────────────────────────────────────────
  const admin = await makeUser('Campus Admin', 'admin@campus.edu', 'ADMIN', 'Administration');
  const mehta = await makeUser('Dr. Kavita Mehta', 'mehta@campus.edu', 'FACULTY', 'Computer Science');
  const iyer = await makeUser('Dr. Arjun Iyer', 'iyer@campus.edu', 'FACULTY', 'Electronics');
  const asha = await makeUser('Asha Rao', 'asha@campus.edu', 'STUDENT', 'Computer Science');
  const ravi = await makeUser('Ravi Kumar', 'ravi@campus.edu', 'STUDENT', 'Electronics');
  const extraNames = ['Neha Shah', 'Vikram Singh', 'Priya Nair', 'Rahul Verma', 'Sneha Pillai', 'Arun Das', 'Meera Joshi', 'Karthik Reddy'];
  const others = [];
  for (const name of extraNames) {
    const email = `${name.split(' ')[0].toLowerCase()}@campus.edu`;
    others.push(await makeUser(name, email, 'STUDENT', pick(['Computer Science', 'Electronics', 'Mechanical', 'Civil'])));
  }

  // ── Resources (through the real service, so audit logs are produced) ────
  const r = {};
  r.lab1 = await createResource(
    {
      name: 'Computer Lab 1',
      description: '40 workstations (i7, 16 GB) with Python, MATLAB, Oracle and VS Code. Ideal for lab practice and project work.',
      category: 'LAB',
      location: 'Block A, 2nd Floor',
      capacity: 40,
      facilities: ['Projector', 'Air conditioning', 'Whiteboard', 'Wi-Fi'],
      operatingHours: WEEKDAYS('08:00', '20:00'),
      bookingRules: { slotMinutes: 30, minDurationMinutes: 30, maxDurationMinutes: 120, maxAdvanceDays: 14, maxActiveBookingsPerUser: 2 },
    },
    admin,
  );
  r.lab2 = await createResource(
    {
      name: 'Computer Lab 2',
      description: '30 workstations with Linux dual-boot and networking kits.',
      category: 'LAB',
      location: 'Block A, 3rd Floor',
      capacity: 30,
      facilities: ['Projector', 'Air conditioning', 'Network rack'],
      operatingHours: WEEKDAYS('08:00', '20:00'),
      bookingRules: { slotMinutes: 30, maxDurationMinutes: 120, maxAdvanceDays: 14, maxActiveBookingsPerUser: 2 },
    },
    admin,
  );
  r.elab = await createResource(
    {
      name: 'Electronics Lab',
      description: 'Oscilloscopes, signal generators, soldering stations and microcontroller kits. Requires faculty approval.',
      category: 'LAB',
      location: 'Block B, Ground Floor',
      capacity: 24,
      facilities: ['Oscilloscopes', 'Soldering stations', 'Arduino/ESP32 kits'],
      operatingHours: WEEKDAYS('09:00', '17:00'),
      approvers: [iyer._id],
      bookingRules: { slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 180, maxAdvanceDays: 14, approvalRequired: true, approvalExemptRoles: ['FACULTY', 'ADMIN'] },
    },
    admin,
  );
  r.hallA = await createResource(
    {
      name: 'Seminar Hall A',
      description: '200-seat auditorium with stage, PA system and recording. Bookings require approval; faculty requests are prioritised.',
      category: 'HALL',
      location: 'Main Building',
      capacity: 200,
      facilities: ['Stage', 'PA system', 'Dual projectors', 'Recording'],
      operatingHours: WEEKDAYS('08:00', '21:00'),
      approvers: [mehta._id],
      bookingRules: { slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 240, maxAdvanceDays: 30, approvalRequired: true, approvalExemptRoles: ['ADMIN'], facultyPriority: true, cancellationDeadlineMinutes: 24 * 60 },
    },
    admin,
  );
  r.hallB = await createResource(
    {
      name: 'Seminar Hall B',
      description: '120-seat hall for department talks and club events.',
      category: 'HALL',
      location: 'Main Building',
      capacity: 120,
      facilities: ['Projector', 'PA system'],
      operatingHours: WEEKDAYS('08:00', '21:00'),
      approvers: [mehta._id],
      bookingRules: { slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 240, maxAdvanceDays: 30, approvalRequired: true, approvalExemptRoles: ['FACULTY', 'ADMIN'], facultyPriority: true },
    },
    admin,
  );
  r.court = await createResource(
    {
      name: 'Basketball Court',
      description: 'Outdoor floodlit court. One-hour slots.',
      category: 'SPORTS',
      location: 'Sports Complex',
      capacity: 20,
      facilities: ['Floodlights', 'Scoreboard'],
      operatingHours: EVERY_DAY('06:00', '21:00'),
      bookingRules: { slotMinutes: 60, minDurationMinutes: 60, maxDurationMinutes: 120, maxAdvanceDays: 7, maxActiveBookingsPerUser: 2, cancellationDeadlineMinutes: 30 },
    },
    admin,
  );
  r.proj1 = await createResource(
    {
      name: 'Projector 01',
      description: 'Portable Epson projector with HDMI/VGA cables and a carry case. Collect from the Media Centre desk.',
      category: 'EQUIPMENT',
      location: 'Media Centre',
      capacity: 0,
      facilities: ['HDMI', 'VGA', 'Remote'],
      operatingHours: WEEKDAYS('08:00', '18:00'),
      bookingRules: { slotMinutes: 30, maxDurationMinutes: 240, maxAdvanceDays: 14, maxActiveBookingsPerUser: 1 },
    },
    admin,
  );
  r.proj2 = await createResource(
    {
      name: 'Projector 02',
      description: 'Portable BenQ projector. Collect from the Media Centre desk.',
      category: 'EQUIPMENT',
      location: 'Media Centre',
      capacity: 0,
      facilities: ['HDMI', 'Remote'],
      operatingHours: WEEKDAYS('08:00', '18:00'),
      bookingRules: { slotMinutes: 30, maxDurationMinutes: 240, maxAdvanceDays: 14, maxActiveBookingsPerUser: 1 },
    },
    admin,
  );
  r.room = await createResource(
    {
      name: 'Project Room 101',
      description: '8-seat discussion room with a TV screen, open 24×7 for project teams.',
      category: 'ROOM',
      location: 'Library, 1st Floor',
      capacity: 8,
      facilities: ['55" TV', 'Whiteboard', 'Wi-Fi'],
      operatingHours: EVERY_DAY('00:00', '24:00'),
      approvers: [mehta._id],
      bookingRules: { slotMinutes: 15, minDurationMinutes: 15, maxDurationMinutes: 180, maxAdvanceDays: 14, maxActiveBookingsPerUser: 2 },
    },
    admin,
  );
  console.log(`Created ${Object.keys(r).length} resources and ${5 + others.length} users`);

  // ── History: replay three weeks of real activity ────────────────────────
  const realNow = new Date();
  const today = todayLocal(realNow);
  const students = [asha, ravi, ...others];
  const reviewers = { [r.elab._id]: iyer, [r.hallA._id]: mehta, [r.hallB._id]: mehta, [r.room._id]: mehta };
  const historyResources = [r.lab1, r.lab1, r.lab2, r.lab2, r.court, r.court, r.proj1, r.proj2, r.elab, r.hallA, r.hallB, r.room];
  const hourWeights = [9, 10, 10, 11, 11, 12, 14, 14, 15, 15, 16, 17];
  let created = 0;
  let ashaNoShows = 0;

  for (let offset = -21; offset <= -1; offset += 1) {
    const date = addDays(today, offset);
    clock.set(localToDate(addDays(date, -2), '09:00'));
    const dayBookings = [];
    const count = 6 + Math.floor(random() * 6);
    for (let i = 0; i < count; i += 1) {
      const resource = pick(historyResources);
      const user = random() < 0.15 ? pick([mehta, iyer]) : pick(students);
      const startHour = pick(hourWeights);
      const duration = resource.bookingRules.slotMinutes === 60 ? 60 : pick([60, 60, 90, 120]);
      const startTime = `${String(startHour).padStart(2, '0')}:00`;
      const endMinutes = startHour * 60 + Math.min(duration, resource.bookingRules.maxDurationMinutes);
      const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
      try {
        const { result } = await createBooking(user, { resourceId: resource._id, date, startTime, endTime, purpose: pick(PURPOSES) });
        dayBookings.push(result);
        created += 1;
      } catch {
        // Closed day, conflict, limit or restriction: exactly what the real system would refuse.
      }
    }

    // Reviewers handle pending requests; a few are rejected.
    for (const booking of dayBookings.filter((b) => b.status === 'PENDING_APPROVAL')) {
      const reviewer = reviewers[booking.resource] || admin;
      try {
        if (random() < 0.8) await approveBooking(booking._id, String(reviewer._id) === String(booking.user) ? admin : reviewer, {});
        else await rejectBooking(booking._id, String(reviewer._id) === String(booking.user) ? admin : reviewer, { reason: 'Hall already committed to a department event' });
      } catch {
        /* reviewer is the requester etc. */
      }
    }

    // Some users cancel in advance.
    for (const booking of dayBookings) {
      if (random() < 0.12) await cancelBooking(booking._id, { _id: booking.user, role: 'STUDENT' }, { reason: 'Plans changed' }).catch(() => {});
    }

    // Most confirmed bookings are checked in; some are missed.
    const confirmed = await Booking.find({ _id: { $in: dayBookings.map((b) => b._id) }, status: 'CONFIRMED' }).sort({ startAt: 1 });
    for (const booking of confirmed) {
      const isAsha = String(booking.user) === String(asha._id);
      // Demo accounts are reliable (Asha has exactly one no-show → warning); other students miss ~12%.
      const reliable = [ravi, mehta, iyer].some((u) => String(u._id) === String(booking.user));
      const miss = isAsha ? ashaNoShows === 0 && offset > -10 : !reliable && random() < 0.12;
      if (miss) {
        if (isAsha) ashaNoShows += 1;
        continue;
      }
      clock.set(addMinutes(booking.startAt, Math.floor(random() * 10)));
      const user = await User.findById(booking.user);
      await checkIn(booking._id, user).catch(() => {});
    }

    // End of day: the real scheduler marks no-shows and completes sessions.
    clock.set(localToDate(date, '23:59'));
    await runAllJobs();
  }
  clock.reset();
  await runAllJobs();
  console.log(`Replayed ${created} historical bookings through the booking workflow`);

  // ── Current state for the live demo ─────────────────────────────────────
  const historyEnd = new Date();
  const nextWeekday = (from) => {
    let d = addDays(from, 1);
    while ([0].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
    return d;
  };
  const tomorrow = nextWeekday(today);
  const dayAfter = nextWeekday(tomorrow);

  const unrestricted = [];
  for (const u of others) if (!(await getActiveRestriction(u._id))) unrestricted.push(u);
  const [studentA = others[0], studentB = others[1]] = unrestricted;

  const safe = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      console.warn(`  skipped ${label}: ${error.message}`);
      return null;
    }
  };

  // Asha: an upcoming confirmed lab booking and a seminar hall request awaiting Dr. Mehta.
  await safe('asha lab', () => createBooking(asha, { resourceId: r.lab1._id, date: tomorrow, startTime: '14:00', endTime: '16:00', purpose: 'DBMS mini-project with team' }));
  await safe('asha hall', () => createBooking(asha, { resourceId: r.hallA._id, date: dayAfter, startTime: '15:00', endTime: '17:00', purpose: 'Coding club orientation for first-years' }));
  // Ravi holds Computer Lab 1 tomorrow morning (Asha can join the waitlist for it).
  await safe('ravi lab', () => createBooking(ravi, { resourceId: r.lab1._id, date: tomorrow, startTime: '10:00', endTime: '12:00', purpose: 'Embedded systems simulation' }));
  // Electronics lab request awaiting Dr. Iyer; another student waits for the court.
  await safe('ravi elab', () => createBooking(ravi, { resourceId: r.elab._id, date: dayAfter, startTime: '10:00', endTime: '12:00', purpose: 'Final-year project PCB testing' }));
  await safe('neha court', () => createBooking(studentA, { resourceId: r.court._id, date: tomorrow, startTime: '17:00', endTime: '18:00', purpose: 'Inter-department practice' }));
  await safe('vikram waitlist', () => joinWaitlist(studentB, { resourceId: r.court._id, date: tomorrow, startTime: '17:00', endTime: '18:00', purpose: 'Team practice' }));
  await safe('mehta hall', () => createBooking(mehta, { resourceId: r.hallB._id, date: dayAfter, startTime: '11:00', endTime: '13:00', purpose: 'Guest lecture: Cloud Computing' }));

  // One resource under maintenance (existing bookings kept, new bookings blocked).
  await changeResourceStatus(r.proj2._id, { status: 'MAINTENANCE', reason: 'Lamp replacement', cancelExistingBookings: false }, admin);

  // Historical notifications are marked read so the demo inbox shows only fresh items.
  await Notification.updateMany({ createdAt: { $lt: historyEnd } }, { isRead: true });
  await Notification.updateMany({ type: { $in: ['BOOKING_REMINDER', 'CHECK_IN_REMINDER'] } }, { isRead: true });

  console.log('\nDemo accounts (password for all: %s)', DEMO_PASSWORD);
  console.log('  Admin    admin@campus.edu');
  console.log('  Faculty  mehta@campus.edu  (approver: Seminar Halls, Project Room 101)');
  console.log('  Faculty  iyer@campus.edu   (approver: Electronics Lab)');
  console.log('  Student  asha@campus.edu   (main demo student)');
  console.log('  Student  ravi@campus.edu');
  console.log('\nFor the check-in / no-show demos run: npm run demo -- check-in | no-show');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
