import { handle, asBool, asId, asString } from './util';
import { listStaff, removeStaff, saveStaff } from '../db/repositories/staff';
import { currentStaff, revalidate, signIn, signOut } from '../services/session';

/**
 * Staff roster and the counter sign-in.
 *
 * Note what is deliberately absent: there is no channel that sets who is
 * signed in without a PIN check, and none that reads a PIN hash. The session
 * lives in the main process precisely so the renderer cannot name the person a
 * cancellation gets recorded against.
 */
export function registerStaffHandlers(): void {
  handle('staff:list', (_e, activeOnly) => listStaff(asBool(activeOnly)));

  handle('staff:save', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return saveStaff({
      id: raw.id === undefined || raw.id === null ? undefined : asId(raw.id, 'Staff member'),
      name: asString(raw.name, 'Name', { max: 60 }),
      is_active: raw.is_active === undefined ? true : asBool(raw.is_active),
      // Undefined leaves any existing PIN alone; '' clears it.
      pin:
        raw.pin === undefined
          ? undefined
          : asString(raw.pin ?? '', 'PIN', { required: false, max: 8 }),
    });
  });

  handle('staff:remove', (_e, id) => removeStaff(asId(id, 'Staff member')));

  /* ---- The counter session ---- */

  handle('staff:signIn', (_e, id, pin) =>
    signIn(asId(id, 'Staff member'), asString(pin ?? '', 'PIN', { required: false, max: 8 })),
  );

  handle('staff:signOut', () => {
    signOut();
    return null;
  });

  /**
   * Who is signed in. Revalidated on every read so a person the owner
   * deactivated mid-shift stops being stamped on cancellations immediately,
   * rather than at the next restart.
   */
  handle('staff:current', () => {
    revalidate();
    return currentStaff();
  });
}
