import { registerAdminHandlers } from './admin';
import { registerBackupHandlers } from './backup';
import { registerDealHandlers } from './deals';
import { registerCustomerHandlers } from './customers';
import { registerDayHandlers } from './day';
import { registerExpenseHandlers } from './expenses';
import { registerExtraHandlers } from './extras';
import { registerImageHandlers } from './images';
import { registerLicenseHandlers } from './license';
import { registerMenuHandlers } from './menu';
import { registerOrderHandlers } from './orders';
import { registerRecurringExpenseHandlers } from './recurringExpenses';
import { registerReportHandlers } from './reports';
import { registerSettingsHandlers } from './settings';
import { registerStaffHandlers } from './staff';
import { registerTableHandlers } from './tables';
import { registerWaiterHandlers } from './waiters';

/** Every channel the renderer can reach, registered once at startup. */
export function registerIpcHandlers(): void {
  registerLicenseHandlers();
  registerAdminHandlers();
  registerSettingsHandlers();
  registerStaffHandlers();
  registerWaiterHandlers();
  registerMenuHandlers();
  registerDealHandlers();
  registerImageHandlers();
  registerExtraHandlers();
  registerCustomerHandlers();
  registerDayHandlers();
  registerTableHandlers();
  registerOrderHandlers();
  registerReportHandlers();
  registerExpenseHandlers();
  registerRecurringExpenseHandlers();
  registerBackupHandlers();
}
