-- Fixture schema for E2E and integration tests.
--
-- Shaped to exercise the parts of the UI that are easy to break:
--   * more than one page of rows (default page size is 50)
--   * a foreign key, so FK-follow and the ER diagram have something to show
--   * an enum, a JSONB column, and nullable columns for the cell renderers
--   * a view, so the sidebar has both table and view types
--
-- Idempotent: safe to run repeatedly against the same database.

DROP VIEW IF EXISTS active_users CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS user_status CASCADE;

CREATE TYPE user_status AS ENUM ('active', 'inactive', 'banned');

CREATE TABLE users (
  id          serial PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  status      user_status NOT NULL DEFAULT 'active',
  metadata    jsonb,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      numeric(10, 2) NOT NULL,
  placed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);

-- 120 users: two full pages plus a partial third at the default page size.
INSERT INTO users (email, name, status, metadata, notes)
SELECT
  'user' || i || '@example.com',
  'User ' || i,
  (ARRAY['active', 'inactive', 'banned']::user_status[])[1 + (i % 3)],
  jsonb_build_object('seq', i, 'tier', CASE WHEN i % 10 = 0 THEN 'gold' ELSE 'standard' END),
  CASE WHEN i % 7 = 0 THEN NULL ELSE 'note for user ' || i END
FROM generate_series(1, 120) AS i;

INSERT INTO orders (user_id, amount)
SELECT
  1 + (i % 120),
  round((i * 7.31)::numeric, 2)
FROM generate_series(1, 300) AS i;

CREATE VIEW active_users AS
  SELECT id, email, name FROM users WHERE status = 'active';
