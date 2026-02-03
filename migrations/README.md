# Autognostic Plugin - Database Migrations

## Overview

The Autognostic plugin uses Drizzle ORM for database access. Tables are automatically
created by ElizaOS when it reads the plugin's `schema` export.

## Deployment Modes

### Local Development (PGlite - Default)

No manual migration required. ElizaOS automatically:
1. Creates tables from the Drizzle schema
2. Seeds reference data via plugin `init()`

Configuration in `.env`:
```env
PGLITE_DATA_DIR=./.eliza/.elizadb
ELIZA_DB_PROVIDER=sql
```

### Cloud Deployment (External PostgreSQL)

For production deployments with external PostgreSQL:

1. Set connection string in `.env`:
   ```env
   POSTGRES_URL=postgresql://user:password@host:5432/database
   ```

2. Tables are auto-created on first run, OR run manually:
   ```bash
   psql -U user -d database -f migrations/001_rename_to_autognostic.sql
   psql -U user -d database -f migrations/002_add_sync_tables.sql
   psql -U user -d database -f migrations/003_add_paper_classification_tables.sql
   ```

## Tables

| Table | Purpose |
|-------|---------|
| `autognostic.settings` | Agent-specific size policies |
| `autognostic.refresh_settings` | Refresh/sync policies |
| `autognostic.preview_cache` | Cached source previews |
| `autognostic.sources` | Registered knowledge sources |
| `autognostic.versions` | Source version history |
| `autognostic.knowledge_link` | Links between sources and knowledge docs |
| `autognostic.documents` | Full document storage for quotes |
| `autognostic.sync_config` | Scheduled sync configuration |
| `autognostic.sync_log` | Sync operation history |
| `autognostic.paper_classification` | Scientific paper classifications |
| `autognostic.taxonomy_nodes` | L1-L4 taxonomy hierarchy |
| `autognostic.controlled_vocab` | L5 focus facet vocabulary |

## Seed Data

Reference data is automatically seeded on first run:
- **8 L1 Domain taxonomy nodes** - Natural Sciences, Life Sciences, Engineering, etc.
- **18 Task/Study Type terms** - theory, experiment_in_vivo, simulation, etc.
- **21 Method/Approach terms** - deep_learning, spectroscopy, bayesian_modeling, etc.

This seeding is **idempotent** - safe to run multiple times. It only inserts if tables are empty.

## SQL Files in This Directory

| File | Purpose |
|------|---------|
| `001_rename_to_autognostic.sql` | Rename from datamirror to autognostic |
| `002_add_sync_tables.sql` | Add scheduled sync tables |
| `003_add_paper_classification_tables.sql` | Add scientific paper classification tables |

These files are provided for:
- Documentation of expected schema
- Manual migrations in restricted environments
- Backup/restore operations
- Production deployments requiring explicit DDL control

For normal usage, let ElizaOS handle migrations automatically via the `schema` export.

## Troubleshooting

### Tables Not Created

If tables aren't being created automatically:

1. Verify `@elizaos/plugin-sql` is loaded before this plugin
2. Check that `schema` is exported in the plugin definition
3. Look for errors in the ElizaOS startup logs

### Seed Data Missing

If taxonomy nodes or controlled vocab aren't present:

1. Plugin `init()` runs after table creation - there may be a timing issue
2. Check logs for `[autognostic] Seeded X taxonomy nodes` messages
3. Manually verify: `SELECT COUNT(*) FROM autognostic.taxonomy_nodes;`

### Schema Already Exists (Cloud PostgreSQL)

If you see "relation already exists" errors:

1. This is safe to ignore for CREATE TABLE IF NOT EXISTS
2. For INSERT statements, ON CONFLICT DO NOTHING handles duplicates
3. The seeder is idempotent and won't duplicate data

## Manual Database Reset

To completely reset the autognostic schema:

```sql
-- WARNING: This deletes all data!
DROP SCHEMA IF EXISTS autognostic CASCADE;
```

Then restart ElizaOS to recreate tables and seed data.
