CREATE TABLE reservations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  book_id varchar(32) NOT NULL REFERENCES books(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'fulfilled', 'cancelled')),
  CHECK ((status = 'waiting' AND closed_at IS NULL)
    OR (status <> 'waiting' AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_waiting_reservation_per_user_book
  ON reservations(user_id, book_id) WHERE status = 'waiting';
CREATE INDEX reservations_queue_idx
  ON reservations(book_id, created_at, id) WHERE status = 'waiting';
CREATE INDEX reservations_user_idx ON reservations(user_id, created_at DESC);

CREATE TABLE reading_states (
  user_id uuid NOT NULL REFERENCES users(id),
  book_id varchar(32) NOT NULL REFERENCES books(id),
  status varchar(16) NOT NULL CHECK (status IN ('wishlist', 'reading', 'completed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX reading_states_user_updated_idx ON reading_states(user_id, updated_at DESC);
