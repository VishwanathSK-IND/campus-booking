import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'BOOKING_CREATED',
  'BOOKING_PENDING',
  'APPROVAL_REQUESTED',
  'BOOKING_APPROVED',
  'BOOKING_REJECTED',
  'BOOKING_CANCELLED',
  'BOOKING_EXPIRED',
  'BOOKING_REMINDER',
  'CHECK_IN_REMINDER',
  'CHECKED_IN',
  'NO_SHOW',
  'RESTRICTION',
  'WAITLIST_JOINED',
  'WAITLIST_OFFER',
  'WAITLIST_OFFER_EXPIRED',
  'RESOURCE_STATUS',
];

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource' },
    waitlistEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'WaitlistEntry' },
    isRead: { type: Boolean, default: false },
    readAt: Date,
    // Set by background jobs so a job running twice never notifies twice.
    dedupeKey: String,
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });

export const Notification = mongoose.model('Notification', notificationSchema);
