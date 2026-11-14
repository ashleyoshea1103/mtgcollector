import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp, signedOut } from '../test/app';

afterEach(() => localStorage.clear());

const switchIn = async () => within(await screen.findByRole('radiogroup', { name: 'Currency' }));

describe('CurrencySwitch', () => {
  it('starts on EUR, and remembers GBP once chosen', async () => {
    const { user } = renderApp('/search', signedOut);
    const currency = await switchIn();
    expect(currency.getByRole('radio', { name: 'EUR' })).toBeChecked();
    await user.click(currency.getByRole('radio', { name: 'GBP' }));
    expect(currency.getByRole('radio', { name: 'GBP' })).toBeChecked();
    expect(localStorage.getItem('mtgcollector-currency')).toBe('gbp');
  });

  it('starts from the stored choice', async () => {
    localStorage.setItem('mtgcollector-currency', 'gbp');
    renderApp('/search', signedOut);
    expect((await switchIn()).getByRole('radio', { name: 'GBP' })).toBeChecked();
  });

  it('follows a choice made in another tab', async () => {
    renderApp('/search', signedOut);
    const currency = await switchIn();
    act(() => {
      localStorage.setItem('mtgcollector-currency', 'gbp');
      window.dispatchEvent(new StorageEvent('storage', { key: 'mtgcollector-currency', newValue: 'gbp' }));
    });
    expect(currency.getByRole('radio', { name: 'GBP' })).toBeChecked();
  });

  it('asks for the rate once, without signing in', async () => {
    const { api } = renderApp('/search', signedOut);
    await switchIn();
    await screen.findByRole('searchbox', { name: 'Card name' });
    expect(api.sent('GET /api/rates')).toHaveLength(1);
    expect(api.unhandled).toEqual([]);
  });
});
