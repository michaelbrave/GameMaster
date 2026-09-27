-- Worldforge initial schema: immutable events + rebuildable projections.
-- Migrations are append-only after being shared; fix forward with new files.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE worlds (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  seed TEXT NOT NULL,
  content_release TEXT NOT NULL,
  current_tick INTEGER NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES worlds (id),
  character_name TEXT NOT NULL,
  q INTEGER NOT NULL,
  r INTEGER NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  creator_policy JSONB NOT NULL,
  pending_encounter JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

-- Append-only domain events. UNIQUE(stream_id, stream_version) makes duplicate
-- appends impossible; seq gives a stable global order for history pagination.
CREATE TABLE events (
  id UUID PRIMARY KEY,
  seq BIGSERIAL,
  world_id UUID NOT NULL REFERENCES worlds (id),
  stream_id TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  world_tick INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor JSONB,
  location JSONB,
  causation_id UUID,
  correlation_id UUID,
  visibility TEXT NOT NULL,
  payload JSONB NOT NULL,
  UNIQUE (stream_id, stream_version)
);
CREATE INDEX events_world_seq_idx ON events (world_id, seq);
CREATE INDEX events_stream_idx ON events (stream_id, stream_version);

-- Resolution traces; UNIQUE(session_id, idempotency_key) means a retry can
-- never roll twice.
CREATE TABLE resolutions (
  id UUID PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES worlds (id),
  session_id UUID NOT NULL REFERENCES sessions (id),
  command_type TEXT NOT NULL,
  command_hash TEXT NOT NULL,
  seed TEXT NOT NULL,
  world_tick INTEGER NOT NULL,
  rolls JSONB NOT NULL,
  event_ids JSONB NOT NULL,
  outcome TEXT NOT NULL,
  response JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (session_id, idempotency_key)
);

-- Current-state projection per materialized hex (rebuildable from events).
CREATE TABLE hex_projections (
  world_id UUID NOT NULL REFERENCES worlds (id),
  q INTEGER NOT NULL,
  r INTEGER NOT NULL,
  terrain TEXT NOT NULL,
  tags JSONB NOT NULL,
  sites JSONB NOT NULL,
  facts JSONB NOT NULL,
  materialized_tick INTEGER NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (world_id, q, r)
);

CREATE TABLE discoveries (
  world_id UUID NOT NULL REFERENCES worlds (id),
  session_id UUID NOT NULL REFERENCES sessions (id),
  q INTEGER NOT NULL,
  r INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  PRIMARY KEY (session_id, q, r)
);

-- Immutable published table versions (seeded from content packs, then
-- extended by creator publishing).
CREATE TABLE content_tables (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);
