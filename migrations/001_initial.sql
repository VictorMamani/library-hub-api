CREATE TABLE users (
  id uuid PRIMARY KEY,
  name varchar(80) NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE TABLE books (
  id varchar(32) PRIMARY KEY CHECK (id ~ '^OL[0-9]+W$'),
  title text NOT NULL,
  authors jsonb NOT NULL DEFAULT '[]',
  cover_id integer,
  publication_year integer,
  subjects jsonb NOT NULL DEFAULT '[]',
  description text NOT NULL DEFAULT ''
);

CREATE TABLE loans (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  book_id varchar(32) NOT NULL REFERENCES books(id),
  borrowed_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  returned_at timestamptz,
  CHECK (due_at > borrowed_at)
);
CREATE UNIQUE INDEX one_active_loan_per_book ON loans(book_id) WHERE returned_at IS NULL;
CREATE INDEX loans_user_id_idx ON loans(user_id, borrowed_at DESC);
