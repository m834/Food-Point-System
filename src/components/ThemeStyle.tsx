'use client';

import { useMemo } from 'react';
import { BRANDING_ENABLED } from '@/lib/branding';
import { imageUrl } from '@/lib/api';
import {
  DEFAULT_ART,
  sanitizeColors,
  sanitizeArt,
  themeToCss,
  type AppTheme,
} from '../../shared/theme';
import { SETTING_KEYS, type SettingsMap } from '../../shared/types';

/**
 * The client's brand, applied to the whole app.
 *
 * This is the entire mechanism, and it is deliberately this small. globals.css
 * derives every screen from nine custom properties with color-mix(), so
 * overriding those nine on :root reskins the sidebar, the order screen, every
 * badge, the chart bars, the dashboard and the print styles at once. There is
 * nothing per-screen to keep in step, and no component reads a colour.
 *
 * A <style> tag rather than inline styles on <html> because the artwork needs
 * a url() and a color-mix() expression, and because one element carrying the
 * whole theme is far easier to reason about — and to switch off — than eleven
 * properties written imperatively onto the document.
 *
 * WHY IT RENDERS NOTHING IN A SIMPLE BUILD
 *
 * BRANDING_ENABLED is inlined as a literal at build time, so the simple build
 * short-circuits here and keeps the stock palette compiled into globals.css.
 * The settings may still exist in its database (a restored backup from a
 * branded shop); they are simply never read.
 */
export function ThemeStyle({ settings }: { settings: SettingsMap }) {
  const css = useMemo(() => {
    if (!BRANDING_ENABLED) return null;

    const stored = settings[SETTING_KEYS.themeColors];
    // No palette saved yet is the normal case, not an error: a branded build
    // starts on the stock look until the client chooses otherwise.
    if (!stored && !settings[SETTING_KEYS.themeArt]) return null;

    let parsed: unknown = null;
    if (stored) {
      try {
        parsed = JSON.parse(stored);
      } catch {
        // A corrupt value falls back to the stock palette rather than leaving
        // the app half-styled. sanitizeColors handles the rest.
        parsed = null;
      }
    }

    const art = sanitizeArt({
      file: settings[SETTING_KEYS.themeArt] ?? '',
      opacity: settings[SETTING_KEYS.themeArtOpacity] ?? DEFAULT_ART.opacity,
      veil: settings[SETTING_KEYS.themeArtVeil] ?? DEFAULT_ART.veil,
    });

    const theme: AppTheme = { colors: sanitizeColors(parsed), art };

    return themeToCss(theme, art.file ? imageUrl('theme', art.file) : null);
  }, [settings]);

  if (!css) return null;

  // The values were parsed to plain numbers and a validated filename before
  // reaching here, so there is nothing user-typed being interpolated raw.
  return <style id="app-theme" dangerouslySetInnerHTML={{ __html: css }} />;
}
