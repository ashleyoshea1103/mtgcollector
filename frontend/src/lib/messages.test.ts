import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../api/client';
import { errorMessage, isNotFound, sentence } from './messages';

describe('sentence', () => {
  it('capitalises and ends a message', () => {
    expect(sentence('email or password is incorrect')).toBe('Email or password is incorrect.');
    expect(sentence('too many requests; try again shortly')).toBe('Too many requests; try again shortly.');
  });

  it("doesn't add a second full stop", () => {
    expect(sentence('Done.')).toBe('Done.');
    expect(sentence('really?')).toBe('Really?');
    expect(sentence('  padded  ')).toBe('Padded.');
    expect(sentence('')).toBe('');
  });
});

describe('errorMessage', () => {
  it("shows the API's message", () => {
    expect(errorMessage(new ApiError(409, 'an account with that email already exists'))).toBe('An account with that email already exists.');
    expect(errorMessage(new ApiError(503, 'that took too long; try again'))).toBe('That took too long; try again.');
  });

  it('explains a lost connection', () => {
    expect(errorMessage(new NetworkError())).toBe("Couldn't reach the server. Check your connection and try again.");
  });

  it("doesn't show other errors' messages, which may be internals", () => {
    expect(errorMessage(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe('Something went wrong. Try again.');
    expect(errorMessage('a string')).toBe('Something went wrong. Try again.');
  });
});

describe('isNotFound', () => {
  it('is a 404 only', () => {
    expect(isNotFound(new ApiError(404, 'no such group'))).toBe(true);
    expect(isNotFound(new ApiError(400, 'bad'))).toBe(false);
    expect(isNotFound(new NetworkError())).toBe(false);
  });
});
