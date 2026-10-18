export type ColorMap = Record<string, string>;

export interface ColorSettings {
  background: string;
  foreground: string;
  noFolderBackground: string;
  debuggingBackground: string;
  debuggingForeground: string;
  remoteBackground: string;
  remoteForeground: string;
}

export interface Preset {
  name: string;
  hex: string;
}

export const PRESETS: Preset[] = [
  { name: 'Flair Purple', hex: '#9f00a6' },
  { name: 'Indigo', hex: '#3949ab' },
  { name: 'Ocean', hex: '#0b5394' },
  { name: 'Teal', hex: '#00796b' },
  { name: 'Forest', hex: '#2e7d32' },
  { name: 'Gold', hex: '#b8860b' },
  { name: 'Sunset', hex: '#e65100' },
  { name: 'Ember', hex: '#c62828' },
  { name: 'Rose', hex: '#ad1457' },
  { name: 'Graphite', hex: '#37474f' },
];

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#1e1e1e';

/** Accepts `#rgb`, `#rrggbb` or `#rrggbbaa` (with or without `#`) and returns lowercase `#rrggbb[aa]`. */
export function normalizeHex(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  const s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) {
    return '#' + [...s].map((c) => c + c).join('');
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) {
    return '#' + s;
  }
  return undefined;
}

function channels(hex: string): [number, number, number] {
  const n = hex.slice(1, 7);
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function toHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** Darkens a color by mixing it with black; `amount` goes from 0 (unchanged) to 1 (black). Alpha is dropped. */
export function darken(hex: string, amount: number): string {
  return toHex(channels(hex).map((c) => c * (1 - amount)));
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on `background`. */
export function readableText(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0), f(8), f(4)].map((v) => v * 255));
}

/** A saturated, mid-dark color with at least 4.5:1 contrast against white text. */
export function randomColor(random: () => number = Math.random): string {
  const h = random() * 360;
  const s = 0.55 + random() * 0.25;
  let l = 0.32 + random() * 0.12;
  let hex = hslToHex(h, s, l);
  // Greens and yellows look much lighter at the same HSL lightness.
  while (contrastRatio(hex, LIGHT_TEXT) < 4.5 && l > 0.1) {
    l -= 0.02;
    hex = hslToHex(h, s, l);
  }
  return hex;
}

/** A stable color for a name: the same worktree always gets the same color. */
export function colorForName(name: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
  }
  // mulberry32, seeded by the FNV-1a hash.
  let seed = hash >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return randomColor(random);
}

/**
 * Turns Status Flair color settings into `workbench.colorCustomizations` keys.
 * Explicit values win; empty ones are derived from the background.
 */
export function buildColorCustomizations(s: ColorSettings): ColorMap {
  const out: ColorMap = {};
  const bg = normalizeHex(s.background);
  const fg = normalizeHex(s.foreground);

  const pair = (bgKey: string, fgKey: string, explicitBg: string | undefined, shade: number, explicitFg?: string) => {
    const b = normalizeHex(explicitBg) ?? (bg && shade > 0 ? darken(bg, shade) : bg);
    if (b) {
      out[bgKey] = b;
    }
    const f = normalizeHex(explicitFg) ?? fg ?? (b ? readableText(b) : undefined);
    if (f) {
      out[fgKey] = f;
    }
  };

  pair('statusBar.background', 'statusBar.foreground', s.background, 0);
  pair('statusBar.noFolderBackground', 'statusBar.noFolderForeground', s.noFolderBackground, 0.12);
  pair('statusBar.debuggingBackground', 'statusBar.debuggingForeground', s.debuggingBackground, 0.25, s.debuggingForeground);
  pair('statusBarItem.remoteBackground', 'statusBarItem.remoteForeground', s.remoteBackground, 0.35, s.remoteForeground);
  return out;
}

/** Colors that replace the normal background while Claude is in a highlighted state. */
export function stateOverride(color: string | undefined): ColorMap {
  const c = normalizeHex(color);
  if (!c) {
    return {};
  }
  const text = readableText(c);
  return {
    'statusBar.background': c,
    'statusBar.foreground': text,
    'statusBar.noFolderBackground': c,
    'statusBar.noFolderForeground': text,
  };
}

export interface OwnedEntry {
  /** What the key held before Status Flair took it over; `null` means it was unset. */
  backup: string | null;
  /** The value Status Flair last wrote. */
  written: string;
}

export type Owned = Record<string, OwnedEntry>;

/**
 * Applies `desired` on top of the user's `current` customizations.
 * Keys Status Flair no longer wants are restored to their backup, unless the
 * user changed them by hand in the meantime.
 */
export function mergeOwned(current: ColorMap, owned: Owned, desired: ColorMap): { next: ColorMap; owned: Owned } {
  const next: ColorMap = { ...current };
  const nextOwned: Owned = {};

  for (const [key, entry] of Object.entries(owned)) {
    if (key in desired || next[key] !== entry.written) {
      continue;
    }
    if (entry.backup === null) {
      delete next[key];
    } else {
      next[key] = entry.backup;
    }
  }

  for (const [key, value] of Object.entries(desired)) {
    const prev = owned[key];
    const backup = prev && current[key] === prev.written ? prev.backup : current[key] ?? null;
    nextOwned[key] = { backup, written: value };
    next[key] = value;
  }

  return { next, owned: nextOwned };
}

export function mapsEqual(a: ColorMap, b: ColorMap): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
