import mongoose from 'mongoose';

/**
 * Concurrency guard for resource time. Every booking, admin block and pending
 * waitlist offer owns one lock document per slot it occupies. The unique
 * (resource, slotStart) index makes overlapping reservations physically
 * impossible to commit: whichever writer inserts a slot first wins, every
 * other writer receives a duplicate-key error and is rejected with 409.
 */
export const LOCK_OWNER_TYPES = ['BOOKING', 'BLOCK', 'OFFER'];

const slotLockSchema = new mongoose.Schema({
  resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  slotStart: { type: Date, required: true },
  ownerType: { type: String, enum: LOCK_OWNER_TYPES, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now },
});

slotLockSchema.index({ resource: 1, slotStart: 1 }, { unique: true });
slotLockSchema.index({ ownerId: 1 });

export const SlotLock = mongoose.model('SlotLock', slotLockSchema);
