import mongoose from 'mongoose';
import { BOOKING_STATUSES } from '../utils/bookingStateMachine.js';

const statusHistorySchema = new mongoose.Schema(
  {
    from: String,
    to: String,
    at: Date,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
  },
  { _id: false },
);

const bookingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Campus-local wall-clock values (for display/history) plus UTC instants (for queries).
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true },
    purpose: { type: String, required: true, trim: true, maxlength: 500 },

    status: { type: String, enum: BOOKING_STATUSES, required: true },
    approvalStatus: {
      type: String,
      enum: ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'],
      default: 'NOT_REQUIRED',
    },
    priority: { type: Number, default: 0 },
    checkInStatus: { type: String, enum: ['NOT_CHECKED_IN', 'CHECKED_IN', 'MISSED'], default: 'NOT_CHECKED_IN' },
    source: { type: String, enum: ['DIRECT', 'WAITLIST'], default: 'DIRECT' },
    waitlistEntry: { type: mongoose.Schema.Types.ObjectId, ref: 'WaitlistEntry' },

    // Historical snapshots: bookings stay understandable if the resource or user changes later.
    resourceSnapshot: {
      name: String,
      location: String,
      category: String,
    },
    userSnapshot: {
      name: String,
      email: String,
      role: String,
    },

    // Policy snapshot: the rules in force when the booking was made.
    checkInOpensAt: { type: Date, required: true },
    checkInClosesAt: { type: Date, required: true },
    cancellationDeadlineAt: { type: Date, required: true },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    reviewNote: { type: String, trim: true, maxlength: 500 },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancellationReason: { type: String, trim: true, maxlength: 500 },
    checkedInAt: Date,
    completedAt: Date,
    noShowAt: Date,
    expiredAt: Date,

    reminderSentAt: Date,
    checkInReminderSentAt: Date,

    statusHistory: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true },
);

bookingSchema.index({ resource: 1, startAt: 1 });
bookingSchema.index({ user: 1, startAt: -1 });
bookingSchema.index({ user: 1, status: 1, endAt: 1 });
bookingSchema.index({ status: 1, startAt: 1 });
bookingSchema.index({ status: 1, checkInClosesAt: 1 });
bookingSchema.index({ status: 1, endAt: 1 });
bookingSchema.index({ date: 1 });

export const Booking = mongoose.model('Booking', bookingSchema);
