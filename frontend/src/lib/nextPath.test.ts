import { describe, expect, it } from 'vitest';
import { loginUrl, nextPath } from './nextPath';

describe('nextPath', () => {
  it('goes back to a page of the app, with its query', () => {
    expect(nextPath('/collection', '/')).toBe('/collection');
    expect(nextPath('/groups/4?view=list&sort=price', '/')).toBe('/groups/4?view=list&sort=price');
  });

  it.each([
    ['nothing', null],
    ['an empty path', ''],
    ['another site', 'https://evil.example/'],
    ['another site, scheme-relative', '//evil.example/collection'],
    ['another site, by backslash', '/\\evil.example'],
    ['a backslash later on', '/collection\\..\\x'],
    ['a script', 'javascript:alert(1)'],
    ['a relative path', 'collection'],
    ['a control character', '/collection\n'],
    ['a tab between the slashes', '/\t/evil.example'],
    ['the login page', '/login?next=/collection'],
    ['the sign-up page', '/signup'],
  ])('ignores %s', (_, next) => {
    expect(nextPath(next, '/collection')).toBe('/collection');
  });

  it("allows pages that only start like the login page's name", () => {
    expect(nextPath('/loginhelp', '/')).toBe('/loginhelp');
  });
});

describe('loginUrl', () => {
  it('carries where to come back to', () => {
    expect(loginUrl('/groups/4?view=list')).toBe('/login?next=%2Fgroups%2F4%3Fview%3Dlist');
    expect(loginUrl('/')).toBe('/login');
  });

  it('round-trips through nextPath', () => {
    const path = '/collection?group_by=set&sort=added';
    expect(nextPath(new URL(loginUrl(path), 'http://x').searchParams.get('next'), '/')).toBe(path);
  });
});
