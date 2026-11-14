-- Queries for the exchange rates (internal/rates).

-- name: UpsertExchangeRate :exec
-- Stores a fetched rate. The fetch always counts (fetched_at moves), but an older day's rate
-- never replaces a newer one, so a stale copy of the ECB's file can't undo a newer rate.
INSERT INTO exchange_rates (currency, per_eur, rate_date)
VALUES (@currency::text, @per_eur::float8, @rate_date::date)
ON CONFLICT (currency) DO UPDATE
   SET per_eur    = CASE WHEN EXCLUDED.rate_date >= exchange_rates.rate_date
                         THEN EXCLUDED.per_eur ELSE exchange_rates.per_eur END,
       rate_date  = GREATEST(EXCLUDED.rate_date, exchange_rates.rate_date),
       fetched_at = now();

-- name: ListExchangeRates :many
SELECT currency, per_eur::float8 AS per_eur, to_char(rate_date, 'YYYY-MM-DD')::text AS rate_date
  FROM exchange_rates
 ORDER BY currency;

-- name: LastRateFetch :one
-- When rates were last fetched; null when they never have been.
SELECT max(fetched_at)::timestamptz AS fetched_at FROM exchange_rates;
