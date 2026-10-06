import mongoose from 'mongoose';

/**
 * Campus-wide booking policy (single document, key = "default"), editable by
 * administrators. Resource-specific rules live on each Resource.
 */
const noShowTierSchema = new mongoose.Schema(
  {
    threshold: { type: Number, required: true, min: 1 }, // no-shows within the look-back window
    action: { type: String, enum: ['WARNING', 'RESTRICTION'], required: true },
    restrictionDays: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const systemPolicySchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    maxActiveBookingsByRole: {
      STUDENT: { type: Number, default: 5 },
      FACULTY: { type: Number, default: 10 },
      ADMIN: { type: Number, default: 50 },
    },
    noShow: {
      lookbackDays: { type: Number, default: 90 },
      tiers: {
        type: [noShowTierSchema],
        default: () => [
          { threshold: 1, action: 'WARNING', restrictionDays: 0 },
          { threshold: 2, action: 'RESTRICTION', restrictionDays: 3 },
          { threshold: 3, action: 'RESTRICTION', restrictionDays: 14 },
        ],
      },
    },
    waitlist: {
      offerMinutes: { type: Number, default: 15 },
      maxEntriesPerUser: { type: Number, default: 10 },
    },
    reminders: {
      enabled: { type: Boolean, default: true },
      leadMinutes: { type: Number, default: 24 * 60 },
      checkInLeadMinutes: { type: Number, default: 30 },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const SystemPolicy = mongoose.model('SystemPolicy', systemPolicySchema);
