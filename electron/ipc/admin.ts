import { handle, asString } from './util';
import {
  adminStatus,
  initialiseAdminPin,
  lockAdmin,
  unlockAdmin,
} from '../services/adminSession';

/**
 * Unlocking the owner's admin portal.
 *
 * Note what is absent: there is no channel that sets the admin flag without a
 * PIN check, and none that reads the stored PIN. The session lives in the main
 * process so that "am I admin?" is answered by the backend, not asserted by
 * the screen the person is looking at.
 */
export function registerAdminHandlers(): void {
  handle('admin:status', () => adminStatus());

  handle('admin:unlock', (_e, pin) =>
    unlockAdmin(asString(pin ?? '', 'PIN', { required: false, max: 8 })),
  );

  /** First run only: no PIN exists yet, so set one and go straight in. */
  handle('admin:initialise', (_e, pin) =>
    initialiseAdminPin(asString(pin, 'PIN', { max: 8 })),
  );

  handle('admin:lock', () => {
    lockAdmin();
    return null;
  });
}
