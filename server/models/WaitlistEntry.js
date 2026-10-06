import mongoose from 'mongoose';

export const WAITLIST_STATUSES = ['WAITING', 'OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'];

const waitlistEntrySchema = new mongoose.Schema(
  {
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    purpose: { type: String, required: true, trim: true, maxlength: 500 },
    // Higher first; ties broken by createdAt then _id (deterministic, never random).
    priority: { type: Number, default: 0 },
    status: { type: String, enum: WAITLIST_STATUSES, default: 'WAITING' },
    // Unique per offer attempt; the slot locks held for the offer are owned by this id.
    offerId: mongoose.Schema.Types.ObjectId,
    offeredAt: Date,
    offerExpiresAt: Date,
    respondedAt: Date,
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    resourceSnapshot: { name: String, location: String },
  },
  { timestamps: true },
);

// A user can hold only one live entry for the same resource and interval.
waitlistEntrySchema.index(
  { user: 1, resource: 1, startAt: 1, endAt: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['WAITING', 'OFFERED'] } } },
);
waitlistEntrySchema.index({ resource: 1, status: 1, priority: -1, createdAt: 1, _id: 1 });
waitlistEntrySchema.index({ status: 1, offerExpiresAt: 1 });
waitlistEntrySchema.index({ user: 1, createdAt: -1 });

export const WaitlistEntry = mongoose.model('WaitlistEntry', waitlistEntrySchema);
