import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PALETTES, panelAltText, PanelModel, renderPanelSvg, severity, svgDataUri } from '../claude/usagePanel';

const model: PanelModel = {
  rows: [
    { title: 'Session', detail: '5 hours', right: 'Resets 1:20 PM', percent: 41 },
    { title: 'Context', right: '238k tokens' },
  ],
  footer: ['This session · $4.12'],
};

describe('renderPanelSvg', () => {
  it('produces a sized SVG with bars only where there is a percentage', () => {
    const svg = renderPanelSvg(model, PALETTES.dark);
    assert.match(svg, /^<svg [^>]*width="320" height="\d+"/);
    assert.equal((svg.match(/rx="3"/g) ?? []).length, 2, 'one track and one fill');
    assert.ok(svg.includes('41%'));
    assert.ok(svg.includes('Resets 1:20 PM'));
  });

  it('escapes text', () => {
    const svg = renderPanelSvg({ rows: [{ title: '<b>&"x"' }], footer: [] }, PALETTES.light);
    assert.ok(svg.includes('&lt;b&gt;&amp;&quot;x&quot;'));
  });

  it('draws the banner when a limit is hit', () => {
    assert.ok(renderPanelSvg({ ...model, banner: '5-hour limit reached' }, PALETTES.dark).includes(PALETTES.dark.bannerBg));
  });
});

describe('helpers', () => {
  it('colors by severity', () => {
    const p = PALETTES.dark;
    assert.equal(severity(10, p), p.ok);
    assert.equal(severity(60, p), p.warn);
    assert.equal(severity(85, p), p.danger);
  });

  it('encodes as a data URI', () => {
    assert.match(svgDataUri('<svg/>'), /^data:image\/svg\+xml;base64,/);
  });

  it('describes the panel in plain text for the alt attribute', () => {
    assert.equal(panelAltText(model), 'Session 5 hours 41% Resets 1:20 PM; Context 238k tokens; This session · $4.12');
  });
});
