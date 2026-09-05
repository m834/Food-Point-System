/**
 * The theme contract — shared by the main process and the renderer.
 *
 * WHY THIS FILE EXISTS
 *
 * The design system in globals.css derives every screen, badge, chart bar and
 * button from nine brand colours using color-mix(). That was already a
 * white-label contract; it was just a contract honoured by editing CSS and
 * rebuilding. This file turns those same nine values into DATA, so a client
 * can set them from Settings and the whole app follows — no rebuild, no colour
 * literal anywhere in a component.
 *
 * The rule from globals.css still holds and is now enforced rather than
 * documented: these nine are the only colours anyone may set. Everything else
 * is derived. A client cannot restyle one button, because there is no channel
 * to do so — which is what stops a shop from slowly turning the app into a
 * ransom note.
 *
 * The artwork follows the same shape: a filename in the shop's own upload
 * folder, never a URL, so the app stays offline by construction.
 */

/** A colour as space-separated sRGB channels, e.g. "9 20 36". */
export type Rgb = string;

export const BRAND_TOKENS = [
  {
    key: 'brand-deep',
    label: 'Brand — deep',
    hint: 'The darkest brand colour. Sidebar and dashboard base.',
  },
  {
    key: 'brand-mid',
    label: 'Brand — mid',
    hint: 'Gradient partner for the deep brand colour.',
  },
  {
    key: 'brand-soft',
    label: 'Brand — soft',
    hint: 'Lifted brand colour. Borders and hover states inside dark areas.',
  },
  {
    key: 'accent',
    label: 'Primary action',
    hint: 'Charge, Send to kitchen — the button staff reach for most.',
  },
  {
    key: 'accent-2',
    label: 'Primary action — partner',
    hint: 'Gradient partner for the primary action.',
  },
  {
    key: 'success',
    label: 'Money / paid',
    hint: 'Takings, paid badges, profit. Green nearly always.',
  },
  { key: 'warning', label: 'Attention', hint: 'Unpaid, low stock, needs a look.' },
  {
    key: 'danger',
    label: 'Void / delete',
    hint: 'Stop. Must stay clearly apart from the primary action.',
  },
  { key: 'canvas', label: 'Workspace paper', hint: 'The light background staff work on all day.' },
] as const;

export type BrandToken = (typeof BRAND_TOKENS)[number]['key'];

export type ThemeColors = Record<BrandToken, Rgb>;

/**
 * The stock palette: deep navy with a tomato accent.
 *
 * This is what the app looks like with no branding applied, and what "Reset"
 * returns to. It is also the SIMPLE build's only palette.
 */
export const DEFAULT_COLORS: ThemeColors = {
  'brand-deep': '9 20 36',
  'brand-mid': '18 40 71',
  'brand-soft': '32 66 110',
  accent: '232 92 54',
  'accent-2': '245 165 36',
  success: '34 168 106',
  warning: '214 152 12',
  danger: '202 46 58',
  canvas: '244 246 249',
};

export interface ThemePreset {
  id: string;
  name: string;
  note: string;
  colors: ThemeColors;
}

/**
 * Ready-made palettes.
 *
 * The Squid Game theme was hard-coded into globals.css for one client; it now
 * lives here as data, which is the whole point of this feature — a second
 * client asking for their own look costs an entry in this list, not a branch.
 */
export const PRESETS: ThemePreset[] = [
  {
    id: 'default',
    name: 'Classic navy',
    note: 'The stock look — deep navy with a tomato accent.',
    colors: DEFAULT_COLORS,
  },
  {
    id: 'squid',
    name: 'Squid Game',
    note: "Near-black bled with magenta, the guards' hot pink, the players' green.",
    colors: {
      'brand-deep': '10 6 12',
      'brand-mid': '48 8 34',
      'brand-soft': '99 18 66',
      accent: '224 16 112',
      'accent-2': '255 92 168',
      success: '26 158 118',
      warning: '224 160 24',
      danger: '214 44 30',
      canvas: '248 244 247',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    note: 'Deep green with a warm amber action.',
    colors: {
      'brand-deep': '10 30 22',
      'brand-mid': '18 58 42',
      'brand-soft': '34 96 70',
      // Deeper than it first looked: a brighter amber put white button text
      // at 2.7:1, under the floor checkColors() enforces on everyone else.
      accent: '190 100 20',
      'accent-2': '246 190 62',
      success: '32 164 104',
      warning: '212 150 14',
      danger: '206 52 44',
      canvas: '244 248 245',
    },
  },
  {
    id: 'plum',
    name: 'Plum',
    note: 'Aubergine with a teal action — calm, and easy on a bright counter.',
    colors: {
      'brand-deep': '28 14 38',
      'brand-mid': '54 26 72',
      'brand-soft': '92 52 118',
      accent: '20 150 152',
      'accent-2': '64 200 190',
      success: '34 164 108',
      warning: '218 154 18',
      danger: '208 50 56',
      canvas: '247 244 250',
    },
  },
];

/** How strongly the artwork reads. Percentages, because a slider is the UI. */
export interface ThemeArt {
  /** Filename inside <userData>/upload/theme/. Empty means no artwork. */
  file: string;
  /** Dashboard strength, 0–100. The dashboard is looked AT. */
  opacity: number;
  /**
   * How much page colour is painted back OVER the art on the working screens,
   * 0–100. Those screens are looked THROUGH for eight hours and their small
   * dense figures have to win, so this runs high by default.
   */
  veil: number;
}

export const DEFAULT_ART: ThemeArt = { file: '', opacity: 30, veil: 90 };

export interface AppTheme {
  colors: ThemeColors;
  art: ThemeArt;
}

export const DEFAULT_THEME: AppTheme = { colors: DEFAULT_COLORS, art: DEFAULT_ART };

/* ------------------------------------------------------------------ *
   Parsing and validation

   Theme values reach the main process from the renderer and come back out
   of a database that a RESTORE can write from a file the shop was handed.
   Neither is trusted: a value that is not three plain numbers never reaches
   a stylesheet, or it would be a CSS injection through a backup file.
 * ------------------------------------------------------------------ */

/** Strictly "r g b", each 0–255. Returns null for anything else. */
export function parseRgb(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums.join(' ');
}

/** Coerce whatever was stored into a complete, safe palette. */
export function sanitizeColors(input: unknown): ThemeColors {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out = {} as ThemeColors;
  for (const token of BRAND_TOKENS) {
    out[token.key] = parseRgb(raw[token.key]) ?? DEFAULT_COLORS[token.key];
  }
  return out;
}

function clampPercent(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function sanitizeArt(input: unknown): ThemeArt {
  const raw = (input ?? {}) as Record<string, unknown>;
  // A filename only — never a path and never a URL, so it cannot point out of
  // the upload folder or at the network.
  const file =
    typeof raw.file === 'string' && /^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/i.test(raw.file)
      ? raw.file
      : '';
  return {
    file,
    opacity: clampPercent(raw.opacity, DEFAULT_ART.opacity),
    veil: clampPercent(raw.veil, DEFAULT_ART.veil),
  };
}

export function sanitizeTheme(input: unknown): AppTheme {
  const raw = (input ?? {}) as Record<string, unknown>;
  return { colors: sanitizeColors(raw.colors), art: sanitizeArt(raw.art) };
}

/* ------------------------------------------------------------------ *
   Colour maths — for the guards in Settings.

   A client picking nine colours freely can produce a palette that is
   unusable at a counter, and the two ways that happens are worth catching
   before the shop is living in it. Both checks below exist because the
   design system's own notes call them out.
 * ------------------------------------------------------------------ */

export function rgbToHex(rgb: Rgb): string {
  const [r, g, b] = rgb.split(/\s+/).map(Number);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const clean = hex.trim().replace(/^#/, '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function channels(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.split(/\s+/).map(Number);
  return [r, g, b];
}

/** WCAG relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = channels(rgb).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB → CIE Lab (D65), for a perceptual difference rather than an RGB one. */
function toLab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = channels(rgb).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });

  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual distance between two colours (CIE76). */
export function deltaE(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

export interface ThemeWarning {
  token: BrandToken;
  message: string;
}

/**
 * The palette checks worth blocking a shop's day over — reported as warnings,
 * not errors, because the owner is allowed to overrule taste. Only two things
 * are actually dangerous, and both come straight from the design system notes.
 */
export function checkColors(colors: ThemeColors): ThemeWarning[] {
  const warnings: ThemeWarning[] = [];

  /**
   * The one that matters. "Charge" and "Void" sit near each other on the order
   * screen, and a cashier under pressure must never confuse them. The stock
   * navy palette manages a separation of about 22; below roughly 20 the two
   * buttons start reading as two shades of one colour.
   */
  const separation = deltaE(colors.accent, colors.danger);
  if (separation < 20) {
    warnings.push({
      token: 'danger',
      message:
        `The primary action and Void are too close to the same colour ` +
        `(separation ${separation.toFixed(0)}, below the safe 20). A cashier could ` +
        `confuse Charge with Void. Move one of them further apart in hue.`,
    });
  }

  /**
   * White sits on the primary button, so a pale accent puts white text on a
   * pale ground. 3:1 is the large-text floor; the button label is bold 15px,
   * which counts as large.
   */
  const onAccent = contrastRatio(colors.accent, '255 255 255');
  if (onAccent < 3) {
    warnings.push({
      token: 'accent',
      message:
        `White button text would only reach ${onAccent.toFixed(1)}:1 against this ` +
        `primary colour, under the 3:1 floor. Choose a deeper shade.`,
    });
  }

  /** Body text is near-black on the workspace paper; a dark canvas breaks it. */
  if (luminance(colors.canvas) < 0.5) {
    warnings.push({
      token: 'canvas',
      message:
        'The workspace paper is too dark for the black text that sits on it. ' +
        'Keep this one close to white.',
    });
  }

  /** The sidebar carries white text on the deep brand colour. */
  const onBrand = contrastRatio(colors['brand-deep'], '255 255 255');
  if (onBrand < 4.5) {
    warnings.push({
      token: 'brand-deep',
      message:
        `Sidebar text would only reach ${onBrand.toFixed(1)}:1 against this brand ` +
        `colour, under the 4.5:1 floor. Choose a darker shade.`,
    });
  }

  return warnings;
}

/**
 * The stylesheet that reskins the app.
 *
 * Nine custom properties plus the two artwork values, written onto :root.
 * Everything else in globals.css derives from these with color-mix(), so this
 * short string is the entire mechanism — there is nothing per-screen to keep
 * in step, which is exactly why the nine-token contract was worth keeping.
 *
 * Every value has been through parseRgb/clampPercent before arriving here, so
 * nothing user-typed is interpolated raw into CSS.
 */
export function themeToCss(theme: AppTheme, artUrl: string | null): string {
  const lines = BRAND_TOKENS.map((token) => `  --${token.key}-rgb: ${theme.colors[token.key]};`);

  if (artUrl) {
    lines.push(`  --dashboard-art: url("${artUrl}");`);
    lines.push(`  --dashboard-art-opacity: ${theme.art.opacity / 100};`);
    // A bare number, not a finished colour. globals.css builds the light and
    // dark veils from it, so one slider means something in both themes —
    // writing the finished color-mix() here lost to the light theme's own
    // rule at higher specificity, and the slider did nothing on paper.
    lines.push(`  --workspace-art-veil-pct: ${theme.art.veil};`);
  } else {
    lines.push('  --dashboard-art: none;');
  }

  return `:root {\n${lines.join('\n')}\n}`;
}
