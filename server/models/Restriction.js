import mongoose from 'mongoose';

const restrictionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, enum: ['NO_SHOW', 'ADMIN'], required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    noShowRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'NoShowRecord' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    liftedAt: Date,
    liftedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    liftReason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

restrictionSchema.index({ user: 1, endsAt: -1 });

/** Active = not lifted and the current time is inside [startsAt, endsAt). */
export function activeRestrictionFilter(now) {
  return { liftedAt: null, startsAt: { $lte: now }, endsAt: { $gt: now } };
}

export const Restriction = mongoose.model('Restriction', restrictionSchema);
