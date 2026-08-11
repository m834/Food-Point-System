import { handle, asString } from './util';
import { activate, status } from '../services/license';
import { getMachineId } from '../services/machineId';

export function registerLicenseHandlers(): void {
  handle('license:status', () => status());

  handle('license:machineId', () => getMachineId());

  handle('license:activate', (_e, key) =>
    // Keys are long; the field is generous but not unbounded.
    activate(asString(key, 'License key', { max: 2000 })),
  );
}
