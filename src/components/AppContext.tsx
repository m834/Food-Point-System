'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, hasBridge } from '@/lib/api';
import { ThemeStyle } from './ThemeStyle';
import { setCurrency } from '@/lib/format';
import {
  SETTING_KEYS,
  type LicenseStatus,
  type SettingsMap,
  type StaffSession,
} from '../../shared/types';

/**
 * App-wide state that nearly every screen needs: the license gate, settings
 * (which decide whether Tables exists at all), and a toast channel.
 *
 * SQLite is the source of truth, so this holds no cached order data — screens
 * fetch what they need and refetch after they change something.
 */

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'ok' | 'error';
}

interface AppState {
  ready: boolean;
  license: LicenseStatus | null;
  settings: SettingsMap;
  tablesEnabled: boolean;
  waitersEnabled: boolean;
  weightItemsEnabled: boolean;
  partialPaymentsEnabled: boolean;
  dailyExpensesEnabled: boolean;
  waiterWagesEnabled: boolean;
  /** Who is on the counter, per the MAIN process. Null when nobody is. */
  staff: StaffSession | null;
  /** 'dark' or 'light'. Applied to <html data-theme>. */
  theme: 'dark' | 'light';
  toggleTheme: () => Promise<void>;
  /** True while the owner's admin session is live, per the MAIN process. */
  isAdmin: boolean;
  /** False when no manager PIN exists yet — admin offers to set one. */
  adminPinSet: boolean;
  refreshAdmin: () => Promise<void>;
  exitAdmin: () => Promise<void>;
  /** True once the owner has added anyone — then signing in is required. */
  staffRequired: boolean;
  refreshStaff: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshLicense: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  toast: (message: string, kind?: Toast['kind']) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [staff, setStaff] = useState<StaffSession | null>(null);
  const [staffRequired, setStaffRequired] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPinSet, setAdminPinSet] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const theme: 'dark' | 'light' =
    settings[SETTING_KEYS.theme] === 'light' ? 'light' : 'dark';

  /**
   * The theme is an attribute on <html>, not a class on a component, because
   * the CSS variables it swaps live on :root. Applied in an effect so a
   * statically exported page cannot ship the wrong one baked into its HTML.
   */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const refreshLicense = useCallback(async () => {
    try {
      setLicense(await api.license.status());
    } catch {
      setLicense(null);
    }
  }, []);

  /**
   * Ask the main process who is signed in.
   *
   * Deliberately never cached from a local sign-in call: the session lives in
   * the main process precisely so the renderer cannot decide who it is, and
   * reading it back is what keeps that true. It also picks up a staff member
   * the owner deactivated mid-shift.
   */
  const refreshStaff = useCallback(async () => {
    try {
      const [current, roster] = await Promise.all([api.staff.current(), api.staff.list(true)]);
      setStaff(current);
      setStaffRequired(roster.length > 0);
    } catch {
      /* Before activation the staff channel is closed — that is expected. */
    }
  }, []);

  /**
   * Saved to the database, not localStorage: it is a counter-wide preference
   * that should survive a reinstall and travel in the shop's backup, like
   * every other setting.
   */
  const toggleTheme = useCallback(async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    // Paint immediately; the save is confirmation, not the mechanism.
    document.documentElement.dataset.theme = next;
    setSettings((current) => ({ ...current, [SETTING_KEYS.theme]: next }));
    try {
      await api.settings.save({ [SETTING_KEYS.theme]: next });
    } catch {
      /* An unsaved preference is not worth interrupting service for. */
    }
  }, [theme]);

  /**
   * Ask the main process whether admin is unlocked.
   *
   * Never cached from a successful unlock: the session can expire on idle, and
   * the only honest answer comes from the side that owns it.
   */
  const refreshAdmin = useCallback(async () => {
    try {
      const status = await api.admin.status();
      setIsAdmin(status.unlocked);
      setAdminPinSet(status.pinSet);
    } catch {
      setIsAdmin(false);
    }
  }, []);

  const exitAdmin = useCallback(async () => {
    try {
      await api.admin.lock();
    } finally {
      setIsAdmin(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.staff.signOut();
    } finally {
      await refreshStaff();
    }
  }, [refreshStaff]);

  const refreshSettings = useCallback(async () => {
    try {
      const values = await api.settings.all();
      setSettings(values);
      // One place decides how money is rendered everywhere.
      setCurrency(values[SETTING_KEYS.currencySymbol]);
    } catch {
      /* Before activation the settings channel is closed — that is expected. */
    }
  }, []);

  useEffect(() => {
    (async () => {
      if (!hasBridge()) {
        setReady(true);
        return;
      }
      await refreshLicense();
      await refreshSettings();
      await refreshStaff();
      await refreshAdmin();
      setReady(true);
    })();
  }, [refreshLicense, refreshSettings, refreshStaff, refreshAdmin]);

  // Settings only become readable once the app is unlocked, so pick them up
  // the moment activation succeeds.
  useEffect(() => {
    if (license?.licensed) {
      void refreshSettings();
      void refreshStaff();
    }
  }, [license?.licensed, refreshSettings, refreshStaff]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      license,
      settings,
      tablesEnabled: settings[SETTING_KEYS.enableTables] !== '0',
      waitersEnabled: settings[SETTING_KEYS.enableWaiters] === '1',
      weightItemsEnabled: settings[SETTING_KEYS.enableWeightItems] === '1',
      partialPaymentsEnabled: settings[SETTING_KEYS.enablePartialPayments] === '1',
      dailyExpensesEnabled: settings[SETTING_KEYS.enableDailyExpenses] === '1',
      waiterWagesEnabled: settings[SETTING_KEYS.enableWaiterWages] === '1',
      staff,
      staffRequired,
      theme,
      toggleTheme,
      isAdmin,
      adminPinSet,
      refreshAdmin,
      exitAdmin,
      refreshStaff,
      signOut,
      refreshLicense,
      refreshSettings,
      toast,
    }),
    [
      ready,
      license,
      settings,
      staff,
      staffRequired,
      theme,
      toggleTheme,
      isAdmin,
      adminPinSet,
      refreshAdmin,
      exitAdmin,
      refreshStaff,
      signOut,
      refreshLicense,
      refreshSettings,
      toast,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {/* Mounted above everything, so the client's brand reaches every screen
          — including the activation gate, which renders before the app does. */}
      <ThemeStyle settings={settings} />
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'info' ? '' : ` ${t.kind}`}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
