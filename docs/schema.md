# Schema — plugin-autognostic

> Drizzle ORM definitions: `src/db/schema.ts`
> Re-exported via: `src/schema.ts`
> All tables live in PostgreSQL schema `autognostic` for isolation.

## Tables

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `settings` | Per-agent size policy config | `agent_id` (PK), `size_policy_json` |
| `refresh_settings` | Per-agent refresh policy config | `agent_id` (PK), `refresh_policy_json` |
| `preview_cache` | Cached source previews | `source_id` (PK), `preview_json`, `checked_at` |
| `sources` | Registered external data sources | `id` (PK), `source_url`, `enabled`, `version_tracking_enabled`, `is_static_content` |
| `versions` | Version snapshots of sources | `id` (PK), `source_id` (FK→sources), `version_id`, `status` |
| `knowledge_link` | Links sources to ElizaOS knowledge docs | `id` (PK), `source_id` (FK→sources), `knowledge_document_id` |
| `documents` | Full document content storage | `id` (UUID PK), `source_id`, `version_id`, `url`, `content`, `content_hash` |

### Scientific Paper Classification Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `paper_classification` | Paper classification with lakehouse zones | `id` (UUID PK), `document_id`, `zone` (bronze/silver/gold), `primary_path`, `focus` |
| `taxonomy_nodes` | L1-L4 taxonomy hierarchy | `id` (PK, e.g. "L1.NATSCI"), `level` (1-4), `name`, `parent_id` |
| `controlled_vocab` | L5 facet vocabulary | `id` (PK), `facet_type`, `term`, `definition` |

### Sync Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `sync_config` | Cron schedule + staleness config | `id` (PK, default "default"), `cron_expression`, `staleness_threshold_hours` |
| `sync_log` | Sync run history | `id` (PK), `started_at`, `status`, `sources_checked`, `documents_added` |

## Relationships

- `versions.source_id` → `sources.id` (CASCADE delete)
- `knowledge_link.source_id` → `sources.id` (CASCADE delete)
- `taxonomy_nodes.parent_id` → `taxonomy_nodes.id` (self-referencing hierarchy)
- `paper_classification.document_id` → `documents.id` (logical FK, not enforced)

## Migrations

| File | Description |
|------|-------------|
| `001_rename_to_autognostic.sql` | Renames legacy `datamirror` schema to `autognostic` |
| `002_add_sync_tables.sql` | Adds version tracking columns, sync_config, sync_log |
| `003_add_paper_classification_tables.sql` | Adds paper_classification, taxonomy_nodes, controlled_vocab with seed data |

## Procedures

```bash
# Apply migrations (uses Drizzle push via ElizaOS)
bun run db:migrate

# Seed taxonomy data
bun run db:seed

# Nuclear reset
rm -rf ./data/autognostic.db
bun run db:migrate
bun run db:seed
```
