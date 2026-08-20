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
  /** Who is on the counter, per the MAIN process. Null when nobody is. */
  staff: StaffSession | null;
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
  const [toasts, setToasts] = useState<Toast[]>([]);

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
      setReady(true);
    })();
  }, [refreshLicense, refreshSettings, refreshStaff]);

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
      staff,
      staffRequired,
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
      refreshStaff,
      signOut,
      refreshLicense,
      refreshSettings,
      toast,
    ],
  );

  return (
    <Ctx.Provider value={value}>
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
