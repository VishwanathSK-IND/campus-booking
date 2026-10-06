import { localDate } from './helpers.js';

export const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '00:00', close: '24:00' }));

export function resourcePayload(overrides = {}) {
  const { bookingRules, ...rest } = overrides;
  return {
    name: 'Computer Lab 1',
    description: '40 workstations with MATLAB and Python',
    category: 'LAB',
    location: 'Block A',
    capacity: 40,
    facilities: ['Projector', 'AC'],
    operatingHours: ALL_DAY,
    bookingRules: {
      slotMinutes: 30,
      minDurationMinutes: 30,
      maxDurationMinutes: 120,
      maxAdvanceDays: 14,
      maxActiveBookingsPerUser: 3,
      ...bookingRules,
    },
    ...rest,
  };
}

export async function createResource(adminAgent, overrides) {
  const res = await adminAgent.post('/api/resources').send(resourcePayload(overrides));
  if (res.status !== 201) throw new Error(`create resource failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function bookingPayload(resourceId, overrides = {}) {
  return {
    resourceId,
    date: overrides.date || (await localDate(1)),
    startTime: '10:00',
    endTime: '11:00',
    purpose: 'Project work',
    ...overrides,
  };
}
