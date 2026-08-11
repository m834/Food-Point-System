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
import { SETTING_KEYS, type LicenseStatus, type SettingsMap } from '../../shared/types';

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
      setReady(true);
    })();
  }, [refreshLicense, refreshSettings]);

  // Settings only become readable once the app is unlocked, so pick them up
  // the moment activation succeeds.
  useEffect(() => {
    if (license?.licensed) void refreshSettings();
  }, [license?.licensed, refreshSettings]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      license,
      settings,
      tablesEnabled: settings[SETTING_KEYS.enableTables] !== '0',
      refreshLicense,
      refreshSettings,
      toast,
    }),
    [ready, license, settings, refreshLicense, refreshSettings, toast],
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
