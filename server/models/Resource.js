import mongoose from 'mongoose';
import { ROLES } from './User.js';

export const RESOURCE_CATEGORIES = ['LAB', 'HALL', 'CLASSROOM', 'SPORTS', 'EQUIPMENT', 'ROOM', 'OTHER'];
export const RESOURCE_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'];

const operatingHoursSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    open: { type: String, required: true }, // HH:mm, campus timezone
    close: { type: String, required: true }, // HH:mm (24:00 allowed)
  },
  { _id: false },
);

/**
 * Booking policy stored as data on each resource so administrators can tune
 * it without code changes. Values are snapshotted onto bookings where they
 * affect an already-made booking (check-in window, cancellation deadline).
 */
const bookingRulesSchema = new mongoose.Schema(
  {
    slotMinutes: { type: Number, enum: [15, 30, 60], default: 30 },
    minDurationMinutes: { type: Number, default: 30 },
    maxDurationMinutes: { type: Number, default: 120 },
    maxAdvanceDays: { type: Number, default: 14 },
    maxActiveBookingsPerUser: { type: Number, default: 2 },
    allowedRoles: { type: [String], enum: ROLES, default: ['STUDENT', 'FACULTY', 'ADMIN'] },
    approvalRequired: { type: Boolean, default: false },
    approvalExemptRoles: { type: [String], enum: ROLES, default: ['ADMIN'] },
    facultyPriority: { type: Boolean, default: false },
    cancellationDeadlineMinutes: { type: Number, default: 60 },
    checkInOpensBeforeMinutes: { type: Number, default: 15 },
    checkInGraceMinutes: { type: Number, default: 15 },
  },
  { _id: false },
);

const blockedPeriodSchema = new mongoose.Schema({
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 200 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});

const resourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    category: { type: String, enum: RESOURCE_CATEGORIES, required: true },
    location: { type: String, required: true, trim: true, maxlength: 120 },
    capacity: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: RESOURCE_STATUSES, default: 'ACTIVE' },
    statusReason: { type: String, trim: true, maxlength: 300 },
    facilities: { type: [String], default: [] },
    operatingHours: { type: [operatingHoursSchema], default: [] },
    bookingRules: { type: bookingRulesSchema, default: () => ({}) },
    // Faculty members assigned to review approval-required bookings.
    approvers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    blockedPeriods: { type: [blockedPeriodSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

resourceSchema.index({ status: 1, category: 1, name: 1 });
resourceSchema.index({ location: 1 });
resourceSchema.index({ approvers: 1 });

export const Resource = mongoose.model('Resource', resourceSchema);
