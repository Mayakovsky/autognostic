-- Migration: Add version tracking columns and sync tables

-- Add new columns to sources table
ALTER TABLE autognostic.sources ADD COLUMN IF NOT EXISTS version_tracking_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE autognostic.sources ADD COLUMN IF NOT EXISTS is_static_content BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE autognostic.sources ADD COLUMN IF NOT EXISTS static_detection_metadata JSONB;
ALTER TABLE autognostic.sources ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE autognostic.sources ADD COLUMN IF NOT EXISTS next_sync_at TIMESTAMPTZ;

-- Create sync configuration table
CREATE TABLE IF NOT EXISTS autognostic.sync_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  cron_expression TEXT DEFAULT '0 3 * * *',
  timezone TEXT DEFAULT 'UTC',
  staleness_threshold_hours INTEGER DEFAULT 24,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create sync log table
CREATE TABLE IF NOT EXISTS autognostic.sync_log (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  sources_checked INTEGER DEFAULT 0,
  sources_updated INTEGER DEFAULT 0,
  sources_skipped INTEGER DEFAULT 0,
  documents_added INTEGER DEFAULT 0,
  documents_removed INTEGER DEFAULT 0,
  errors JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Insert default sync config
INSERT INTO autognostic.sync_config (id) VALUES ('default') ON CONFLICT DO NOTHING;
