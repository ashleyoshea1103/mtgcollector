-- +goose Up
-- The latest euro exchange rate for each currency the app shows prices in (internal/rates):
-- the European Central Bank's daily reference rate, PerEUR of the currency to one euro. Only
-- the latest is kept; price history is out of scope.
CREATE TABLE exchange_rates (
    currency   text PRIMARY KEY CHECK (currency ~ '^[A-Z]{3}$'),
    per_eur    numeric(12,6) NOT NULL CHECK (per_eur > 0),
    rate_date  date NOT NULL,           -- the ECB's day for the rate
    fetched_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE exchange_rates;
