import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { label, render, variablesIn } from '../template';

describe('render', () => {
  it('replaces known variables and blanks unknown ones', () => {
    assert.equal(render('Hi ${user} on ${gitBranch}', { user: 'thiago', gitBranch: 'main' }), 'Hi thiago on main');
    assert.equal(render('${nope}x', {}), 'x');
  });

  it('drops separators left dangling by empty values', () => {
    assert.equal(render('${claudeModel} · ${claudeContext}', { claudeModel: 'Opus 5.5', claudeContext: '' }), 'Opus 5.5');
    assert.equal(render('${a} | ${b}', { a: '', b: 'x' }), 'x');
  });

  it('keeps separators when every value is present', () => {
    assert.equal(render('- ${a} -', { a: 'x' }), '- x -');
  });

  it('does not touch codicons', () => {
    assert.equal(render('$(flame) ${user}', { user: 'me' }), '$(flame) me');
  });
});

describe('variablesIn', () => {
  it('lists variable names', () => {
    assert.deepEqual(variablesIn('${time} ${user}'), ['time', 'user']);
  });
});

describe('label', () => {
  it('joins icon and text, skipping empties', () => {
    assert.equal(label('$(flame)', 'me'), '$(flame) me');
    assert.equal(label('', 'me'), 'me');
    assert.equal(label('🔥', ''), '🔥');
  });
});
