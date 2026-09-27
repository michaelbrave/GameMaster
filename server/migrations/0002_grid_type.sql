ALTER TABLE worlds ADD COLUMN grid_type TEXT NOT NULL DEFAULT 'hex'
  CHECK (grid_type IN ('hex', 'square-diamond'));
