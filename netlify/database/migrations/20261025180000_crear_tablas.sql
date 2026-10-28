CREATE TABLE IF NOT EXISTS picks (
  id TEXT PRIMARY KEY,
  month TEXT,
  date TEXT,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS picks_month_idx ON picks (month);
CREATE INDEX IF NOT EXISTS picks_date_idx ON picks (date);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  month TEXT,
  date TEXT,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
