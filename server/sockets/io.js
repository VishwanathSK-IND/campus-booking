/**
 * Thin emitter facade so services can publish events without depending on
 * Socket.IO directly. Before the server is initialised (tests, scripts) all
 * emits are no-ops. Events are only ever emitted after a successful write;
 * clients must treat them as "something changed, refetch" hints because the
 * database — not the event stream — is the source of truth.
 */
let io = null;

export function setIo(instance) {
  io = instance;
}

export const rooms = {
  user: (id) => `user:${id}`,
  resource: (id) => `resource:${id}`,
  staff: 'staff', // faculty + admins (approval queue updates)
};

export function emitToUser(userId, event, payload) {
  io?.to(rooms.user(String(userId))).emit(event, payload);
}

export function emitToResource(resourceId, event, payload) {
  io?.to(rooms.resource(String(resourceId))).emit(event, payload);
}

export function emitToStaff(event, payload) {
  io?.to(rooms.staff).emit(event, payload);
}

export function broadcast(event, payload) {
  io?.emit(event, payload);
}

/** Standard set of events after a booking changes state. */
export function emitBookingChange(event, booking) {
  const payload = {
    bookingId: String(booking._id),
    resourceId: String(booking.resource?._id || booking.resource),
    userId: String(booking.user?._id || booking.user),
    date: booking.date,
    status: booking.status,
  };
  emitToUser(payload.userId, event, payload);
  emitToResource(payload.resourceId, 'availability.updated', { resourceId: payload.resourceId, date: booking.date });
  emitToStaff('booking.updated', payload);
}
