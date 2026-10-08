CREATE TABLE profile_photos (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  photo text NOT NULL CHECK (length(photo) <= 90000)
);
