import { checkStaffPin, getStaff } from '../db/repositories/staff';
import { anyActiveStaff } from '../db/repositories/staff';
import type { StaffSession } from '../../shared/types';

/**
 * Who is signed in at the counter, held in the MAIN PROCESS.
 *
 * This is the load-bearing decision of the whole accountability feature. The
 * renderer never tells the backend who cancelled something — it cannot, there
 * is no parameter for it. The backend stamps the cancellation with whoever is
 * signed in here, and the only way to change that is to sign in as someone
 * else, which needs their PIN.
 *
 * If the renderer supplied the staff id instead, the entire per-staff report
 * would rest on the honesty of the screen the dishonest person is looking at.
 *
 * Deliberately in memory only, not persisted: a restart signs everyone out.
 * That costs a cashier three seconds at the start of a shift and means a
 * machine left running overnight cannot be used under yesterday's name.
 */

let current: StaffSession | null = null;

export function signIn(staffId: number, pin: unknown): StaffSession {
  const staff = getStaff(staffId);
  if (!staff || staff.is_active !== 1) {
    throw new Error('That staff member is no longer on the list.');
  }
  if (!checkStaffPin(staffId, pin)) {
    throw new Error("That PIN doesn't match.");
  }

  current = { id: staff.id, name: staff.name };
  return current;
}

export function signOut(): void {
  current = null;
}

export function currentStaff(): StaffSession | null {
  return current;
}

/**
 * The staff id to stamp on a cancellation.
 *
 * Returns null — rather than throwing — when the owner has not set up any
 * staff yet. An existing customer updating to this version must be able to
 * keep taking and cancelling orders on the morning of the update; the record
 * simply reads "Not recorded" until a roster exists. The moment the owner
 * adds one person, signing in becomes required and every cancellation from
 * then on carries a name.
 */
export function requireStaffForAudit(): number | null {
  if (!anyActiveStaff()) return null;
  if (!current) {
    throw new Error('Sign in first — a cancellation has to be recorded against a staff member.');
  }
  return current.id;
}

/**
 * Signing out is not allowed to strand the app: if the person who signed in
 * was deactivated by the owner mid-shift, drop the stale session rather than
 * stamping cancellations with a name that is no longer on the roster.
 */
export function revalidate(): void {
  if (!current) return;
  const staff = getStaff(current.id);
  if (!staff || staff.is_active !== 1) current = null;
}
