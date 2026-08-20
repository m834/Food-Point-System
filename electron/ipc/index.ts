import { registerBackupHandlers } from './backup';
import { registerDealHandlers } from './deals';
import { registerLicenseHandlers } from './license';
import { registerMenuHandlers } from './menu';
import { registerOrderHandlers } from './orders';
import { registerReportHandlers } from './reports';
import { registerSettingsHandlers } from './settings';
import { registerStaffHandlers } from './staff';
import { registerTableHandlers } from './tables';

/** Every channel the renderer can reach, registered once at startup. */
export function registerIpcHandlers(): void {
  registerLicenseHandlers();
  registerSettingsHandlers();
  registerStaffHandlers();
  registerMenuHandlers();
  registerDealHandlers();
  registerTableHandlers();
  registerOrderHandlers();
  registerReportHandlers();
  registerBackupHandlers();
}
