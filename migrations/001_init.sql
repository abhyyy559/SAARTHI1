-- WeatherGPT production schema (PostgreSQL + PostGIS). MVP runs on JSON cache;
-- this DDL is the documented production path (§37–38). Provenance on every row.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE sources (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNCONFIGURED',
  detail TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE weather_observations (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'LIVE',
  observed_at TIMESTAMPTZ NOT NULL,
  geom GEOMETRY(Point, 4326),
  temperature DOUBLE PRECISION, humidity DOUBLE PRECISION,
  rainfall DOUBLE PRECISION, wind_speed DOUBLE PRECISION,
  condition TEXT, retrieved_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE forecasts (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL, provenance TEXT NOT NULL DEFAULT 'LIVE',
  issued_at TIMESTAMPTZ NOT NULL, location TEXT,
  days JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE warnings (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL, provenance TEXT NOT NULL DEFAULT 'LIVE',
  hazard TEXT NOT NULL, severity TEXT NOT NULL,
  district TEXT, geom GEOMETRY(Geometry, 4326),
  message TEXT DEFAULT '', instruction TEXT DEFAULT '',
  issued_at TIMESTAMPTZ, valid_until TIMESTAMPTZ,
  verified BOOLEAN DEFAULT FALSE, active BOOLEAN DEFAULT FALSE
);

CREATE TABLE historical_weather (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL, provenance TEXT NOT NULL DEFAULT 'LIVE',
  district TEXT, year INT NOT NULL, tmean_c DOUBLE PRECISION, rain_mm DOUBLE PRECISION,
  UNIQUE (source, district, year)
);

CREATE TABLE advisories (
  id SERIAL PRIMARY KEY,
  user_context TEXT NOT NULL, advisory TEXT NOT NULL,
  official_instruction BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE emergency_messages (
  message_id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  message_type TEXT NOT NULL, geom GEOMETRY(Point, 4326),
  people_count INT DEFAULT 1, medical_required BOOLEAN DEFAULT FALSE,
  ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, signature TEXT NOT NULL,
  hops INT DEFAULT 0, synced BOOLEAN DEFAULT FALSE
);

CREATE TABLE community_reports (
  report_id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL, geom GEOMETRY(Point, 4326),
  district TEXT, text TEXT, reporter_id TEXT DEFAULT 'anonymous',
  created_at TIMESTAMPTZ DEFAULT now(), status TEXT DEFAULT 'COMMUNITY'
);

CREATE INDEX idx_warnings_geom ON warnings USING GIST (geom);
CREATE INDEX idx_warnings_valid ON warnings (valid_until) WHERE active;
CREATE INDEX idx_reports_geom ON community_reports USING GIST (geom);
