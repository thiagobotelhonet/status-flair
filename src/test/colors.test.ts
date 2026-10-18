import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildColorCustomizations,
  ColorSettings,
  contrastRatio,
  mergeOwned,
  normalizeHex,
  randomColor,
  readableText,
  stateOverride,
} from '../colors';

const empty: ColorSettings = {
  background: '',
  foreground: '',
  noFolderBackground: '',
  debuggingBackground: '',
  debuggingForeground: '',
  remoteBackground: '',
  remoteForeground: '',
};

describe('normalizeHex', () => {
  it('accepts short, long and alpha forms with or without #', () => {
    assert.equal(normalizeHex('#C33'), '#cc3333');
    assert.equal(normalizeHex('9f00a6'), '#9f00a6');
    assert.equal(normalizeHex(' #9F00A680 '), '#9f00a680');
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'red', '#12345', '#ggg', undefined]) {
      assert.equal(normalizeHex(bad), undefined);
    }
  });
});

describe('readableText', () => {
  it('uses white on dark colors and dark text on light ones', () => {
    assert.equal(readableText('#9f00a6'), '#ffffff');
    assert.equal(readableText('#ffe066'), '#1e1e1e');
  });
});

describe('randomColor', () => {
  it('always keeps white text readable', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const c = randomColor(random);
      assert.match(c, /^#[0-9a-f]{6}$/);
      assert.ok(contrastRatio(c, '#ffffff') >= 4.5, `${c} is too light`);
    }
  });
});

describe('buildColorCustomizations', () => {
  it('manages nothing when no color is set', () => {
    assert.deepEqual(buildColorCustomizations(empty), {});
  });

  it('derives every state from the background', () => {
    const out = buildColorCustomizations({ ...empty, background: '#9f00a6' });
    assert.equal(out['statusBar.background'], '#9f00a6');
    assert.equal(out['statusBar.foreground'], '#ffffff');
    for (const key of ['statusBar.noFolderBackground', 'statusBar.debuggingBackground', 'statusBarItem.remoteBackground']) {
      assert.ok(out[key] && out[key] !== '#9f00a6', key);
    }
  });

  it('lets explicit values win', () => {
    const out = buildColorCustomizations({
      ...empty,
      background: '#9f00a6',
      foreground: '#eeeeee',
      debuggingBackground: '#ff0000',
      debuggingForeground: '#000000',
    });
    assert.equal(out['statusBar.foreground'], '#eeeeee');
    assert.equal(out['statusBar.noFolderForeground'], '#eeeeee');
    assert.equal(out['statusBar.debuggingBackground'], '#ff0000');
    assert.equal(out['statusBar.debuggingForeground'], '#000000');
  });

  it('ignores invalid colors', () => {
    assert.deepEqual(buildColorCustomizations({ ...empty, background: 'purple' }), {});
  });
});

describe('stateOverride', () => {
  it('colors the bar and picks readable text', () => {
    assert.deepEqual(stateOverride('#2ea043')['statusBar.background'], '#2ea043');
    assert.deepEqual(stateOverride('nope'), {});
  });
});

describe('mergeOwned', () => {
  it('keeps unrelated keys and backs up the ones it takes over', () => {
    const current = { 'editor.background': '#000000', 'statusBar.background': '#111111' };
    const { next, owned } = mergeOwned(current, {}, { 'statusBar.background': '#9f00a6' });
    assert.deepEqual(next, { 'editor.background': '#000000', 'statusBar.background': '#9f00a6' });
    assert.deepEqual(owned['statusBar.background'], { backup: '#111111', written: '#9f00a6' });
  });

  it('restores the backup when a key is released', () => {
    const owned = { 'statusBar.background': { backup: '#111111', written: '#9f00a6' } };
    const { next, owned: after } = mergeOwned({ 'statusBar.background': '#9f00a6' }, owned, {});
    assert.deepEqual(next, { 'statusBar.background': '#111111' });
    assert.deepEqual(after, {});
  });

  it('removes keys that were unset before', () => {
    const owned = { 'statusBar.background': { backup: null, written: '#9f00a6' } };
    assert.deepEqual(mergeOwned({ 'statusBar.background': '#9f00a6' }, owned, {}).next, {});
  });

  it('keeps the original backup across several changes', () => {
    let owned = mergeOwned({ 'statusBar.background': '#111111' }, {}, { 'statusBar.background': '#aaaaaa' }).owned;
    owned = mergeOwned({ 'statusBar.background': '#aaaaaa' }, owned, { 'statusBar.background': '#bbbbbb' }).owned;
    assert.equal(owned['statusBar.background'].backup, '#111111');
  });

  it('leaves a released key alone if the user edited it by hand', () => {
    const owned = { 'statusBar.background': { backup: null, written: '#9f00a6' } };
    assert.deepEqual(mergeOwned({ 'statusBar.background': '#123456' }, owned, {}).next, {
      'statusBar.background': '#123456',
    });
  });
});
