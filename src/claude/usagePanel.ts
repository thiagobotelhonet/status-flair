// Draws the usage part of the Claude tooltip as an SVG image. Markdown hovers cannot
// align text or draw real progress bars, but they can show an image.

export interface Palette {
  text: string;
  muted: string;
  track: string;
  ok: string;
  warn: string;
  danger: string;
  bannerBg: string;
  bannerText: string;
  rule: string;
}

export const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    text: '#e7e7e7',
    muted: '#9d9d9d',
    track: 'rgba(255,255,255,0.12)',
    ok: '#4daafc',
    warn: '#e2b93d',
    danger: '#f4675f',
    bannerBg: 'rgba(244,103,95,0.16)',
    bannerText: '#ff8a80',
    rule: 'rgba(255,255,255,0.08)',
  },
  light: {
    text: '#1f1f1f',
    muted: '#6e6e6e',
    track: 'rgba(0,0,0,0.09)',
    ok: '#0067c0',
    warn: '#a86f00',
    danger: '#c42b1c',
    bannerBg: 'rgba(196,43,28,0.1)',
    bannerText: '#b3261e',
    rule: 'rgba(0,0,0,0.08)',
  },
};

export interface PanelRow {
  title: string;
  /** Muted text after the title, like "5 hours". */
  detail?: string;
  /** Muted text on the right, like "Resets 1:20 PM". */
  right?: string;
  /** Draws a bar when set. */
  percent?: number;
  /** Text after the bar; defaults to the rounded percentage. */
  value?: string;
  /** Percentage at which the bar turns red; defaults to the panel's. */
  warnAt?: number;
  /** A muted line under the bar. */
  note?: string;
  /** Draws the note in the danger color. */
  noteAlert?: boolean;
}

export interface PanelModel {
  banner?: string;
  rows: PanelRow[];
  footer: string[];
}

const WIDTH = 320;
const FONT = "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Ubuntu', 'Helvetica Neue', sans-serif";
const VALUE_COLUMN = 46;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function severity(percent: number, p: Palette, warnAt = 80): string {
  if (percent >= warnAt) {
    return p.danger;
  }
  return percent >= warnAt * 0.625 ? p.warn : p.ok;
}

export function renderPanelSvg(model: PanelModel, p: Palette, warnAt = 80): string {
  const out: string[] = [];
  let y = 4;

  if (model.banner) {
    out.push(
      `<rect x="0" y="${y}" width="${WIDTH}" height="30" rx="6" fill="${p.bannerBg}"/>`,
      `<circle cx="16" cy="${y + 15}" r="6.5" fill="none" stroke="${p.bannerText}" stroke-width="1.5"/>`,
      `<path d="M16 ${y + 11.5}v4" stroke="${p.bannerText}" stroke-width="1.5" stroke-linecap="round"/>`,
      `<circle cx="16" cy="${y + 18.3}" r="0.9" fill="${p.bannerText}"/>`,
      `<text x="30" y="${y + 19.5}" font-size="12.5" font-weight="600" fill="${p.bannerText}">${esc(model.banner)}</text>`,
    );
    y += 30 + 14;
  }

  model.rows.forEach((row, i) => {
    if (i > 0) {
      y += 12;
    }
    const detail = row.detail ? `<tspan font-weight="400" fill="${p.muted}">  ${esc(row.detail)}</tspan>` : '';
    out.push(`<text x="0" y="${y + 13}" font-size="13" font-weight="600" fill="${p.text}">${esc(row.title)}${detail}</text>`);
    if (row.right) {
      out.push(`<text x="${WIDTH}" y="${y + 13}" font-size="12" text-anchor="end" fill="${p.muted}">${esc(row.right)}</text>`);
    }
    if (row.percent === undefined) {
      y += 18;
      return;
    }
    const pct = Math.max(0, Math.min(100, row.percent));
    const barWidth = WIDTH - VALUE_COLUMN;
    const barY = y + 23;
    out.push(`<rect x="0" y="${barY}" width="${barWidth}" height="6" rx="3" fill="${p.track}"/>`);
    if (pct > 0) {
      const fill = Math.max(6, (barWidth * pct) / 100);
      out.push(`<rect x="0" y="${barY}" width="${fill.toFixed(1)}" height="6" rx="3" fill="${severity(pct, p, row.warnAt ?? warnAt)}"/>`);
    }
    out.push(
      `<text x="${WIDTH}" y="${barY + 3}" dominant-baseline="central" font-size="12.5" font-weight="600" text-anchor="end" fill="${p.text}">${esc(row.value ?? `${Math.round(pct)}%`)}</text>`,
    );
    y = barY + 6;
    if (row.note) {
      y += 16;
      out.push(`<text x="0" y="${y}" font-size="11.5" fill="${row.noteAlert ? p.danger : p.muted}">${esc(row.note)}</text>`);
    }
  });

  if (model.footer.length) {
    y += 14;
    out.push(`<rect x="0" y="${y}" width="${WIDTH}" height="1" fill="${p.rule}"/>`);
    y += 4;
    for (const line of model.footer) {
      y += 17;
      out.push(`<text x="0" y="${y}" font-size="12" fill="${p.muted}">${esc(line)}</text>`);
    }
  }

  const height = Math.ceil(y + 6);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" ` +
    `font-family="${FONT.replace(/"/g, "'")}">${out.join('')}</svg>`
  );
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/** Plain-text version of the panel, used as the image's alt text. */
export function panelAltText(model: PanelModel): string {
  const rows = model.rows.map((r) =>
    [r.title, r.detail, r.percent !== undefined ? r.value ?? `${Math.round(r.percent)}%` : undefined, r.right, r.note].filter(Boolean).join(' '),
  );
  return [model.banner, ...rows, ...model.footer].filter(Boolean).join('; ').replace(/[[\]]/g, '');
}
