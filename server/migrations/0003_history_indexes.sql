-- Indexes for store-side history filtering and pagination (see
-- application/history.ts and infrastructure/pgStore.ts eventsFilter).

-- Play history filters by (world_id, visibility) and paginates by seq.
CREATE INDEX IF NOT EXISTS events_world_visibility_seq_idx
  ON events (world_id, visibility, seq);

-- Hex-detail history matches located events by their axial coordinates.
CREATE INDEX IF NOT EXISTS events_location_coords_idx
  ON events (world_id, ((location->>'q')::int), ((location->>'r')::int))
  WHERE location IS NOT NULL;
