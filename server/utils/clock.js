/**
 * Single source of "now" for business rules. Tests replace it to exercise
 * time-dependent workflows (check-in windows, no-shows) deterministically.
 */
let override = null;

export const clock = {
  now: () => (override ? new Date(override.getTime()) : new Date()),
  set: (date) => {
    override = date ? new Date(date) : null;
  },
  reset: () => {
    override = null;
  },
};
