export const schemaV1 = [
  `CREATE TABLE people (
    id text PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL,
    role text NOT NULL CHECK (role IN ('teacher','student')), active boolean NOT NULL DEFAULT true,
    password_hash text NOT NULL, CHECK (username = lower(username))
  )`,
  `CREATE TABLE systems (
    key text PRIMARY KEY, name text NOT NULL, enabled boolean NOT NULL DEFAULT true
  )`,
  `CREATE TABLE grants (
    student_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    system_key text NOT NULL REFERENCES systems(key) ON DELETE CASCADE,
    PRIMARY KEY(student_id, system_key)
  )`,
  `CREATE TABLE sessions (
    digest text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    host text NOT NULL, parent text REFERENCES sessions(digest) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  )`,
  'CREATE INDEX sessions_person ON sessions(person_id)',
  'CREATE INDEX sessions_expiry ON sessions(expires_at)',
  `CREATE TABLE tickets (
    digest text PRIMARY KEY, parent text NOT NULL REFERENCES sessions(digest) ON DELETE CASCADE,
    system_key text NOT NULL REFERENCES systems(key) ON DELETE CASCADE, expires_at timestamptz NOT NULL
  )`,
  'CREATE INDEX tickets_expiry ON tickets(expires_at)',
  `CREATE TABLE nonces (
    digest text PRIMARY KEY, scope text NOT NULL, action text NOT NULL, expires_at timestamptz NOT NULL
  )`,
  'CREATE INDEX nonces_expiry ON nonces(expires_at)',
  `CREATE TABLE login_limits (
    scope text PRIMARY KEY, attempts integer NOT NULL, until_at timestamptz NOT NULL
  )`,
  `CREATE TABLE books (
    id text PRIMARY KEY, title text NOT NULL, location text NOT NULL, copies integer NOT NULL CHECK (copies > 0)
  )`,
  `CREATE TABLE loans (
    person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, book_id text NOT NULL REFERENCES books(id),
    quantity integer NOT NULL CHECK (quantity >= 0), PRIMARY KEY(person_id, book_id)
  )`,
  `CREATE TABLE slots (
    id text PRIMARY KEY, room text NOT NULL, label text NOT NULL
  )`,
  `CREATE TABLE reservations (
    person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE, slot_id text NOT NULL REFERENCES slots(id),
    PRIMARY KEY(slot_id)
  )`,
  `CREATE TABLE audit (
    id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, action text NOT NULL, detail text NOT NULL
  )`,
  'CREATE INDEX audit_time ON audit(at)',
]

export const schemaV2 = [
  `CREATE TABLE system_profiles (
    system_key text PRIMARY KEY REFERENCES systems(key) ON DELETE CASCADE,
    name_en text NOT NULL DEFAULT '', summary text NOT NULL DEFAULT '', summary_en text NOT NULL DEFAULT '',
    repository text NOT NULL DEFAULT '', platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
    CHECK (jsonb_typeof(platforms) = 'array')
  )`,
  `CREATE TABLE screenshots (
    id text PRIMARY KEY, system_key text NOT NULL REFERENCES systems(key) ON DELETE CASCADE,
    title text NOT NULL, group_name text NOT NULL, position integer NOT NULL CHECK (position >= 0),
    width integer NOT NULL CHECK (width BETWEEN 1 AND 3840),
    height integer NOT NULL CHECK (height BETWEEN 1 AND 16383),
    CHECK (width::bigint * height <= 40000000),
    bytes integer NOT NULL CHECK (bytes > 0), content_hash text NOT NULL,
    body bytea NOT NULL, thumbnail bytea NOT NULL,
    CHECK (bytes = octet_length(body) + octet_length(thumbnail)),
    UNIQUE(system_key, content_hash),
    UNIQUE(system_key, position) DEFERRABLE INITIALLY DEFERRED
  )`,
]
