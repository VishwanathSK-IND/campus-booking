import mongoose from 'mongoose';

const noShowRecordSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    resource: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
    occurredAt: { type: Date, required: true },
    // How many no-shows the user had in the policy look-back window, including this one.
    countInWindow: { type: Number, required: true },
    penaltyApplied: { type: String, enum: ['WARNING', 'RESTRICTION'], required: true },
    restriction: { type: mongoose.Schema.Types.ObjectId, ref: 'Restriction' },
    waived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One record per booking: duplicate job runs cannot double-penalise.
noShowRecordSchema.index({ booking: 1 }, { unique: true });
noShowRecordSchema.index({ user: 1, occurredAt: -1 });

export const NoShowRecord = mongoose.model('NoShowRecord', noShowRecordSchema);
