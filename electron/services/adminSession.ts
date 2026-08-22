import { isPinSet, requirePin, setPin } from './managerPin';

/**
 * The owner's admin session.
 *
 * Held in the MAIN PROCESS, exactly like the staff session and for the same
 * reason: the renderer never gets to assert that it is allowed in. It asks,
 * the main process decides, and every gated channel re-checks here rather
 * than trusting a flag the UI is holding.
 *
 * Deliberately in memory only. Closing the app returns the machine to the
 * counter view, so a till left running overnight cannot be found sitting in
 * the reports.
 */

let unlocked = false;
let unlockedAt = 0;

/**
 * How long an idle admin session survives, in milliseconds.
 *
 * Long enough that an owner reading through reports is not re-typing a PIN
 * every few clicks, short enough that walking away from the counter does not
 * leave the takings on screen for whoever sits down next. Any admin activity
 * pushes it out again.
 */
const IDLE_TIMEOUT = 15 * 60 * 1000;

/**
 * The one difference from the cancellation gate: an unset PIN must NOT mean
 * "open".
 *
 * `requirePin()` returns quietly when no PIN is configured, because a shop
 * that has not set one has chosen to leave voids unguarded. Applying that
 * same rule here would leave the whole admin portal — takings, profit, the
 * cancellation log — open to anyone on a shop that simply never set a PIN.
 * So admin refuses instead, and the UI offers to set one.
 */
export function adminPinRequired(): boolean {
  return !isPinSet();
}

export function unlockAdmin(pin: unknown): { unlocked: true } {
  if (!isPinSet()) {
    throw new Error('Set a manager PIN first — the admin area cannot be left unlocked.');
  }
  // Throws with a message the owner can act on when the PIN is wrong.
  requirePin(pin);

  unlocked = true;
  unlockedAt = Date.now();
  return { unlocked: true };
}

/**
 * Set the very first PIN and unlock in one step.
 *
 * The chicken-and-egg case: the PIN lives in Settings, Settings lives inside
 * admin, and admin needs the PIN. A shop upgrading into this version with no
 * PIN set would otherwise be locked out of its own settings.
 */
export function initialiseAdminPin(pin: string): { unlocked: true } {
  if (isPinSet()) {
    throw new Error('A manager PIN is already set. Enter it to continue.');
  }
  setPin(pin);
  unlocked = true;
  unlockedAt = Date.now();
  return { unlocked: true };
}

export function lockAdmin(): void {
  unlocked = false;
  unlockedAt = 0;
}

/** True while the session is live and has not gone idle. */
export function isAdmin(): boolean {
  if (!unlocked) return false;
  if (Date.now() - unlockedAt > IDLE_TIMEOUT) {
    lockAdmin();
    return false;
  }
  return true;
}

/** Called by every admin read, so activity keeps the session alive. */
export function touchAdmin(): void {
  if (unlocked) unlockedAt = Date.now();
}

/**
 * The guard every owner-only IPC channel runs first.
 *
 * Route guarding in the renderer is what makes the UI coherent; this is what
 * makes it enforcement. Without it, the reports channel is still answerable to
 * anyone who can reach the bridge.
 */
export function requireAdmin(): void {
  if (!isAdmin()) {
    throw new Error('The admin area is locked. Enter the manager PIN to continue.');
  }
  touchAdmin();
}

export function adminStatus(): { unlocked: boolean; pinSet: boolean } {
  return { unlocked: isAdmin(), pinSet: isPinSet() };
}
