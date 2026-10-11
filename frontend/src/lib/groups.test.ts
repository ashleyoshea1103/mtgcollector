import { describe, expect, it } from 'vitest';
import { MaxGroupDescriptionLength, MaxGroupNameLength } from '../types';
import { characters, groupChange, groupProblems, tidy } from './groups';

describe('tidy and characters', () => {
  it('trims and normalises as the server stores names', () => {
    expect(tidy('  Café binder ')).toBe('Café binder');
  });

  it('counts code points, not UTF-16 units', () => {
    expect(characters('\u{1F0CF}\u{1F0CF}')).toBe(2);
    expect('\u{1F0CF}\u{1F0CF}'.length).toBe(4);
    expect(characters('Café')).toBe(4);
  });
});

describe('groupProblems', () => {
  it('needs a name', () => {
    expect(groupProblems({ name: '   ', description: '' })).toEqual({ name: 'Give the group a name.' });
  });

  it('allows the longest name and description, counted in characters', () => {
    const emoji = '\u{1F0CF}';
    expect(groupProblems({ name: emoji.repeat(MaxGroupNameLength), description: emoji.repeat(MaxGroupDescriptionLength) })).toEqual({});
  });

  it('refuses longer ones', () => {
    expect(groupProblems({ name: 'x'.repeat(MaxGroupNameLength + 1), description: 'y'.repeat(MaxGroupDescriptionLength + 1) })).toEqual({
      name: `Use at most ${MaxGroupNameLength} characters.`,
      description: `Use at most ${MaxGroupDescriptionLength} characters.`,
    });
  });

  it("doesn't count the spaces that trimming removes", () => {
    expect(groupProblems({ name: ` ${'x'.repeat(MaxGroupNameLength)} `, description: '' })).toEqual({});
  });
});

describe('groupChange', () => {
  const before = { name: 'Trade binder', kind: 'binder', description: 'For trades' } as const;

  it('is empty when nothing changed, or only spacing did', () => {
    expect(groupChange(before, before)).toEqual({});
    expect(groupChange(before, { ...before, name: ' Trade binder ', description: 'For trades\n' })).toEqual({});
  });

  it('has only what changed, tidied', () => {
    expect(groupChange(before, { ...before, name: ' Trades ' })).toEqual({ name: 'Trades' });
    expect(groupChange(before, { ...before, kind: 'box' })).toEqual({ kind: 'box' });
    expect(groupChange(before, { ...before, description: '' })).toEqual({ description: '' });
  });

  it('counts a change of case as a change', () => {
    expect(groupChange(before, { ...before, name: 'trade binder' })).toEqual({ name: 'trade binder' });
  });
});
