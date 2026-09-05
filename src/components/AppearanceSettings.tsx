'use client';

import { useMemo } from 'react';
import { ImagePicker } from '@/components/ImagePicker';
import { Field, Notice } from '@/components/ui';
import { imageUrl } from '@/lib/api';
import { strings } from '@/lib/strings';
import {
  BRAND_TOKENS,
  DEFAULT_ART,
  DEFAULT_COLORS,
  PRESETS,
  checkColors,
  hexToRgb,
  rgbToHex,
  sanitizeArt,
  sanitizeColors,
  themeToCss,
  type BrandToken,
  type ThemeColors,
} from '../../shared/theme';
import { SETTING_KEYS, type SettingsMap } from '../../shared/types';

/**
 * The Appearance screen — where a client sets their own brand.
 *
 * Only rendered by a BRANDED build; see lib/branding.ts.
 *
 * Nine colours and one image, which is the same contract globals.css has
 * always had. The screen's real job is not the pickers — those are trivial —
 * but the two things around them:
 *
 *  - PRESETS, so the common case is one click rather than nine decisions. A
 *    client who just wants "the Squid Game one" never opens a colour picker.
 *  - GUARDS, because nine free colours can produce an app that is genuinely
 *    unsafe to work on. The warnings below are not style advice; each one is a
 *    counter failure that has a cost. They warn rather than block: the owner
 *    is allowed to overrule taste, but not to do it unknowingly.
 */
export function AppearanceSettings({
  values,
  set,
}: {
  values: SettingsMap;
  set: (key: string, value: string) => void;
}) {
  const colors = useMemo<ThemeColors>(() => {
    const raw = values[SETTING_KEYS.themeColors];
    if (!raw) return DEFAULT_COLORS;
    try {
      return sanitizeColors(JSON.parse(raw));
    } catch {
      return DEFAULT_COLORS;
    }
  }, [values]);

  const art = useMemo(
    () =>
      sanitizeArt({
        file: values[SETTING_KEYS.themeArt] ?? '',
        opacity: values[SETTING_KEYS.themeArtOpacity] ?? DEFAULT_ART.opacity,
        veil: values[SETTING_KEYS.themeArtVeil] ?? DEFAULT_ART.veil,
      }),
    [values],
  );

  const warnings = useMemo(() => checkColors(colors), [colors]);
  const presetId = values[SETTING_KEYS.themePreset] || 'default';

  const writeColors = (next: ThemeColors, preset: string) => {
    set(SETTING_KEYS.themeColors, JSON.stringify(next));
    set(SETTING_KEYS.themePreset, preset);
  };

  const setColor = (token: BrandToken, hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    // Touching any single colour makes the palette the client's own, so the
    // preset list stops claiming they are still on "Squid Game".
    writeColors({ ...colors, [token]: rgb }, 'custom');
  };

  /**
   * Live preview across the WHOLE app, not a swatch in a box.
   *
   * This <style> sits later in the document than the one AppProvider renders,
   * so at equal specificity it wins and the sidebar, buttons and badges all
   * follow the draft as it is edited. Leaving the page without saving unmounts
   * it and the saved theme comes straight back — which is the cheapest
   * possible "cancel", and means a client can try a colour on the real app
   * rather than on a rectangle.
   */
  const previewCss = useMemo(
    () => themeToCss({ colors, art }, art.file ? imageUrl('theme', art.file) : null),
    [colors, art],
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: previewCss }} />

      <p className="tiny muted" style={{ marginBottom: 14 }}>
        {strings.appearance.hint}
      </p>

      {/* --- presets: the one-click path --- */}
      <Field label={strings.appearance.preset} hint={strings.appearance.presetHint}>
        <div className="preset-row">
          {PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={`preset-chip${presetId === preset.id ? ' active' : ''}`}
              onClick={() => writeColors(preset.colors, preset.id)}
              title={preset.note}
            >
              <span className="preset-swatches">
                {(['brand-deep', 'accent', 'success', 'danger'] as BrandToken[]).map((token) => (
                  <span key={token} style={{ background: `rgb(${preset.colors[token]})` }} />
                ))}
              </span>
              {preset.name}
            </button>
          ))}
          {presetId === 'custom' ? (
            <span className="preset-chip active" aria-current="true">
              <span className="preset-swatches">
                {(['brand-deep', 'accent', 'success', 'danger'] as BrandToken[]).map((token) => (
                  <span key={token} style={{ background: `rgb(${colors[token]})` }} />
                ))}
              </span>
              {strings.appearance.custom}
            </span>
          ) : null}
        </div>
      </Field>

      {/* --- the nine --- */}
      <Field label={strings.appearance.colours} hint={strings.appearance.coloursHint}>
        <div className="colour-grid">
          {BRAND_TOKENS.map((token) => {
            const warned = warnings.some((w) => w.token === token.key);
            return (
              <label key={token.key} className={`colour-row${warned ? ' warned' : ''}`}>
                <input
                  type="color"
                  className="colour-dot"
                  value={rgbToHex(colors[token.key])}
                  onChange={(event) => setColor(token.key, event.target.value)}
                  aria-label={token.label}
                />
                <span className="colour-meta">
                  <span className="colour-label">{token.label}</span>
                  <span className="tiny muted">{token.hint}</span>
                </span>
                <input
                  className="input colour-hex"
                  value={rgbToHex(colors[token.key])}
                  onChange={(event) => setColor(token.key, event.target.value)}
                  spellCheck={false}
                  aria-label={`${token.label} hex`}
                />
              </label>
            );
          })}
        </div>
      </Field>

      {/* Each warning is a counter failure with a cost, not a matter of taste. */}
      {warnings.length ? (
        <Notice>
          <strong>{strings.appearance.warningTitle}</strong>
          <ul className="theme-warnings">
            {warnings.map((warning) => (
              <li key={warning.token}>{warning.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {/* --- the artwork --- */}
      <div className="field-row" style={{ marginTop: 4 }}>
        <Field label={strings.appearance.artwork} hint={strings.appearance.artworkHint}>
          <ImagePicker
            kind="theme"
            value={art.file || null}
            onChange={(file) => set(SETTING_KEYS.themeArt, file ?? '')}
          />
        </Field>

        <div>
          <Field label={strings.appearance.artOpacity} hint={strings.appearance.artOpacityHint}>
            <div className="slider-row">
              <input
                type="range"
                min={0}
                max={100}
                value={art.opacity}
                disabled={!art.file}
                onChange={(event) => set(SETTING_KEYS.themeArtOpacity, event.target.value)}
              />
              <span className="slider-value">{art.opacity}%</span>
            </div>
          </Field>

          <Field label={strings.appearance.artVeil} hint={strings.appearance.artVeilHint}>
            <div className="slider-row">
              <input
                type="range"
                min={0}
                max={100}
                value={art.veil}
                disabled={!art.file}
                onChange={(event) => set(SETTING_KEYS.themeArtVeil, event.target.value)}
              />
              <span className="slider-value">{art.veil}%</span>
            </div>
          </Field>
        </div>
      </div>

      <div className="row-between" style={{ marginTop: 14 }}>
        <span className="tiny muted">{strings.appearance.liveHint}</span>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            writeColors(DEFAULT_COLORS, 'default');
            set(SETTING_KEYS.themeArt, '');
            set(SETTING_KEYS.themeArtOpacity, String(DEFAULT_ART.opacity));
            set(SETTING_KEYS.themeArtVeil, String(DEFAULT_ART.veil));
          }}
        >
          {strings.appearance.reset}
        </button>
      </div>
    </>
  );
}
