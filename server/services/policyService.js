import { SystemPolicy } from '../models/SystemPolicy.js';
import { audit } from './auditService.js';

export async function getPolicy() {
  return SystemPolicy.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function updatePolicy(changes, admin) {
  const policy = await getPolicy();
  const before = policy.toObject();
  if (changes.maxActiveBookingsByRole) Object.assign(policy.maxActiveBookingsByRole, changes.maxActiveBookingsByRole);
  if (changes.noShow?.lookbackDays !== undefined) policy.noShow.lookbackDays = changes.noShow.lookbackDays;
  if (changes.noShow?.tiers) policy.noShow.tiers = [...changes.noShow.tiers].sort((a, b) => a.threshold - b.threshold);
  if (changes.waitlist) Object.assign(policy.waitlist, changes.waitlist);
  if (changes.reminders) Object.assign(policy.reminders, changes.reminders);
  policy.updatedBy = admin._id;
  await policy.save();
  await audit({
    actor: admin,
    action: 'POLICY_UPDATED',
    entityType: 'SystemPolicy',
    entityId: policy._id,
    summary: 'Updated campus booking policy',
    details: {
      before: {
        maxActiveBookingsByRole: before.maxActiveBookingsByRole,
        noShow: before.noShow,
        waitlist: before.waitlist,
        reminders: before.reminders,
      },
      after: changes,
    },
  });
  return policy;
}

/** Picks the escalation tier for the Nth no-show in the window (beyond the last tier, the last tier applies). */
export function noShowTierFor(policy, count) {
  const tiers = [...policy.noShow.tiers].sort((a, b) => a.threshold - b.threshold);
  let chosen = null;
  for (const tier of tiers) if (count >= tier.threshold) chosen = tier;
  return chosen || { threshold: count, action: 'WARNING', restrictionDays: 0 };
}
