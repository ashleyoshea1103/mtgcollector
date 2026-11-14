import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MoneyContext, type Money } from '../lib/money';
import { RateNote } from './RateNote';

const money = (m: Partial<Money>): Money => ({ chosen: 'eur', currency: 'eur', gbpPerEur: null, rateDate: null, rateStatus: 'unavailable', choose: () => {}, ...m });
const showing = (m: Money, euros?: string) =>
  render(
    <MoneyContext value={m}>
      <RateNote euros={euros} />
    </MoneyContext>,
  ).container;

describe('RateNote', () => {
  it('says where the pounds come from: the ECB rate, its day and the rate', () => {
    const shown = showing(money({ chosen: 'gbp', currency: 'gbp', gbpPerEur: 0.8712, rateDate: '2026-10-09', rateStatus: 'ready' }));
    expect(shown).toHaveTextContent(/^Cardmarket's euro prices in pounds, at the ECB rate of 9 Oct 2026 \(€1 = £0\.8712\)$/);
  });

  it("shows an old rate's own day, not today's", () => {
    const shown = showing(money({ chosen: 'gbp', currency: 'gbp', gbpPerEur: 0.85, rateDate: '2026-09-01', rateStatus: 'ready' }));
    expect(shown).toHaveTextContent('at the ECB rate of 1 Sep 2026 (€1 = £0.85)');
  });

  it("says so when pounds are chosen but there's no rate to be had", () => {
    const shown = showing(money({ chosen: 'gbp', currency: 'eur', rateStatus: 'unavailable' }), 'Values from Cardmarket, in euros');
    expect(shown).toHaveTextContent(/^Pound prices aren't available yet, so these are in euros\.$/);
  });

  it('says nothing while the rate is still coming, rather than that it is missing', () => {
    expect(showing(money({ chosen: 'gbp', currency: 'eur', rateStatus: 'pending' }), 'Values from Cardmarket, in euros')).toBeEmptyDOMElement();
  });

  it('in euros, says what the page asks, or nothing', () => {
    expect(showing(money({}), 'Values from Cardmarket, in euros')).toHaveTextContent(/^Values from Cardmarket, in euros$/);
    expect(showing(money({}))).toBeEmptyDOMElement();
  });
});
