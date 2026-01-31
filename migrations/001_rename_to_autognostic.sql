-- Migration: Rename datamirror schema to autognostic
-- Run this if you have an existing datamirror installation

ALTER SCHEMA IF EXISTS datamirror RENAME TO autognostic;

-- If using table-level names instead of schema:
-- ALTER TABLE IF EXISTS datamirror_sources RENAME TO autognostic_sources;
-- ALTER TABLE IF EXISTS datamirror_documents RENAME TO autognostic_documents;
-- ALTER TABLE IF EXISTS datamirror_versions RENAME TO autognostic_versions;
-- ALTER TABLE IF EXISTS datamirror_knowledge_link RENAME TO autognostic_knowledge_link;
-- ALTER TABLE IF EXISTS datamirror_settings RENAME TO autognostic_settings;
-- ALTER TABLE IF EXISTS datamirror_refresh_settings RENAME TO autognostic_refresh_settings;
-- ALTER TABLE IF EXISTS datamirror_preview_cache RENAME TO autognostic_preview_cache;
