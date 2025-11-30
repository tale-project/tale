-- Tale DB Initialization Script
-- This script sets up the TimescaleDB extension and creates initial schema

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Enable additional useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- UUID generation
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- Query performance monitoring
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- Cryptographic functions

-- Create schema for Tale application
CREATE SCHEMA IF NOT EXISTS tale;

-- Set search path to include tale schema for the current database
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO tale, public', current_database());
END $$;

-- Grant permissions to the current user (entrypoint runs scripts as POSTGRES_USER)
GRANT ALL PRIVILEGES ON SCHEMA tale TO CURRENT_USER;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA tale TO CURRENT_USER;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA tale TO CURRENT_USER;

-- Create a sample time-series table (can be customized based on needs)
CREATE TABLE IF NOT EXISTS tale.metrics (
    time        TIMESTAMPTZ NOT NULL,
    metric_name TEXT NOT NULL,
    value       DOUBLE PRECISION,
    tags        JSONB,
    metadata    JSONB
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('tale.metrics', 'time', if_not_exists => TRUE);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_metrics_name_time ON tale.metrics (metric_name, time DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_tags ON tale.metrics USING GIN (tags);

-- Create a sample events table
CREATE TABLE IF NOT EXISTS tale.events (
    time        TIMESTAMPTZ NOT NULL,
    event_type  TEXT NOT NULL,
    user_id     UUID,
    session_id  UUID,
    properties  JSONB,
    metadata    JSONB
);

-- Convert to hypertable
SELECT create_hypertable('tale.events', 'time', if_not_exists => TRUE);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_events_type_time ON tale.events (event_type, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_user ON tale.events (user_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_session ON tale.events (session_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_properties ON tale.events USING GIN (properties);

-- Create retention policies (optional - adjust based on needs)
-- Automatically drop data older than 90 days
-- SELECT add_retention_policy('tale.metrics', INTERVAL '90 days', if_not_exists => TRUE);
-- SELECT add_retention_policy('tale.events', INTERVAL '90 days', if_not_exists => TRUE);

-- Create continuous aggregates for common queries (optional)
-- Example: hourly metrics rollup
-- CREATE MATERIALIZED VIEW tale.metrics_hourly
-- WITH (timescaledb.continuous) AS
-- SELECT
--     time_bucket('1 hour', time) AS bucket,
--     metric_name,
--     AVG(value) as avg_value,
--     MAX(value) as max_value,
--     MIN(value) as min_value,
--     COUNT(*) as count
-- FROM tale.metrics
-- GROUP BY bucket, metric_name;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'Tale DB initialized successfully with TimescaleDB';
END $$;

