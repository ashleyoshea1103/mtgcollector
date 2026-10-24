-- +goose Up
-- Accounts and their sign-in sessions (internal/auth).
CREATE TABLE users (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         citext NOT NULL UNIQUE CHECK (length(email) <= 254),
    -- argon2id in the PHC string format: $argon2id$v=19$m=…,t=…,p=…$salt$hash
    password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- A signed-in browser. The cookie holds a random token; only its SHA-256 is stored, so
-- the table can't be used to sign in as anyone.
CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY CHECK (length(token_hash) = 32),
    user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Moves forward while the session is used, never past created_at plus the absolute limit.
    expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- +goose Down
DROP TABLE sessions;
DROP TABLE users;
