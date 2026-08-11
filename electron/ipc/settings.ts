import { app, clipboard } from 'electron';
import { handle, asString } from './util';
import { getAllSettings, saveSettings } from '../db/repositories/settings';
import { listPrinters, testPrint } from '../services/printing';
import { isPinSet, setPin } from '../services/managerPin';
import { DEFAULT_SETTINGS, SETTING_KEYS, type SettingsMap } from '../../shared/types';

/** Only keys the app knows about may be written — this is not a free key/value store. */
const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

export function registerSettingsHandlers(): void {
  handle('settings:all', () => {
    const all = getAllSettings();
    // The stored PIN hash must never reach the renderer. The UI only needs to
    // know whether a PIN exists, so it can label the button "Change" or "Set".
    const { [SETTING_KEYS.managerPin]: _hash, ...safe } = all;
    return { ...safe, manager_pin_set: isPinSet() ? '1' : '0' };
  });

  handle('settings:save', (_e, values) => {
    const raw = (values ?? {}) as Record<string, unknown>;
    const clean: SettingsMap = {};

    for (const [key, value] of Object.entries(raw)) {
      // The PIN has its own channel — it is hashed, not stored as typed.
      if (key === SETTING_KEYS.managerPin) continue;
      if (!ALLOWED_KEYS.has(key)) continue;
      clean[key] = asString(value ?? '', key, { required: false, max: 300 });
    }

    if (!Object.keys(clean).length) throw new Error('There was nothing to save.');
    saveSettings(clean);

    const { [SETTING_KEYS.managerPin]: _hash, ...safe } = getAllSettings();
    return { ...safe, manager_pin_set: isPinSet() ? '1' : '0' };
  });

  /** Set, change, or clear the manager PIN. An empty string turns the gate off. */
  handle('settings:setManagerPin', (_e, pin) => {
    setPin(asString(pin ?? '', 'PIN', { required: false, max: 8 }));
    return { manager_pin_set: isPinSet() };
  });

  handle('printing:listPrinters', () => listPrinters());

  handle('printing:testPrint', async () => {
    await testPrint();
    return { printed: true };
  });

  handle('app:version', () => app.getVersion());

  handle('system:copyToClipboard', (_e, text) => {
    clipboard.writeText(asString(text, 'Text', { max: 5000 }));
    return null;
  });
}
