-- Queries for accounts and sessions (internal/auth). Times come from the caller's clock.

-- name: CreateUser :one
-- No row when the email is taken (emails are case-insensitive).
INSERT INTO users (email, password_hash)
VALUES (@email, @password_hash)
ON CONFLICT (email) DO NOTHING
RETURNING id, email;

-- name: UserCredentials :one
SELECT id, email, password_hash FROM users WHERE email = @email;

-- name: SetPasswordHash :exec
UPDATE users SET password_hash = @password_hash WHERE id = @id;

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
VALUES (@token_hash, @user_id, @created_at, @expires_at);

-- name: SessionUser :one
-- The user a session belongs to, if it hasn't expired.
SELECT u.id, u.email, s.created_at, s.expires_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id
 WHERE s.token_hash = @token_hash
   AND s.expires_at > @now;

-- name: SetSessionExpiry :exec
UPDATE sessions SET expires_at = @expires_at WHERE token_hash = @token_hash;

-- name: DeleteSession :exec
DELETE FROM sessions WHERE token_hash = @token_hash;

-- name: DeleteExpiredSessions :execrows
DELETE FROM sessions WHERE expires_at <= @now;
