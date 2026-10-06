import mongoose from 'mongoose';

export const ROLES = ['STUDENT', 'FACULTY', 'ADMIN'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'STUDENT' },
    department: { type: String, trim: true, maxlength: 100 },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    // Touched inside every booking unit of work so concurrent bookings by the
    // same user conflict on this document (serialises per-user limit checks
    // when transactions are available).
    lastBookingAttemptAt: Date,
  },
  { timestamps: true },
);

userSchema.index({ role: 1, name: 1 });

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.__v;
    delete ret.lastBookingAttemptAt;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);

export function publicUser(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}
