# @elizaos/plugin-datamirror

ElizaOS plugin that lets an agent conversationally add public documents into Knowledge and keep them current via background reconciliation.

## Features

- **Add single URL to Knowledge** - Ingest any public webpage as a knowledge document
- **Mirror entire docs site** - Discover and ingest via llms.txt, llms-full.txt, or sitemap
- **Version tracking** - Change detection using HEAD metadata + content hash
- **Configurable policies** - Size limits and refresh intervals
- **Background reconciliation** - Automatic updates via reconciliation worker

## Installation

```bash
npm install @elizaos/plugin-datamirror
```

## Configuration

### Environment Variables

```env
# Required
DATABASE_URL=postgresql://localhost:5432/elizaos_plugin_dev
OPENAI_API_KEY=your-key

# Recommended
DATAMIRROR_AUTH_TOKEN=your-auth-token

# Future (GitHub discovery)
GITHUB_TOKEN=your-github-token
```

## Usage

### Register the Plugin

```typescript
import { datamirrorPlugin } from "@elizaos/plugin-datamirror";

const agent = new Agent({
  plugins: [datamirrorPlugin],
});
```

### Actions

| Action | Description |
|--------|-------------|
| `ADD_URL_TO_KNOWLEDGE` | Add a single URL to Knowledge |
| `MIRROR_SOURCE_TO_KNOWLEDGE` | Mirror an entire docs site to Knowledge |
| `SET_DATAMIRROR_SIZE_POLICY` | Configure size limits for mirroring |
| `SET_DATAMIRROR_REFRESH_POLICY` | Configure refresh intervals |

### Example Conversations

```
User: Add https://docs.example.com/getting-started to knowledge
Agent: I've added the getting started guide to knowledge. It's now available for reference.

User: Mirror the entire example.com docs site
Agent: I'll mirror the docs site. Let me check for llms.txt or sitemap...
      Found 24 documents. Proceeding with ingestion...
      Successfully mirrored 24 documents to knowledge.
```

## Architecture

```
plugin-datamirror/
├── src/
│   ├── index.ts              # Plugin entry
│   ├── schema.ts             # Schema export
│   ├── actions/              # 4 actions (add URL, mirror source, set policies)
│   ├── config/               # SizePolicy, RefreshPolicy
│   ├── db/                   # Drizzle schema + repositories
│   ├── integration/          # mirrorDocToKnowledge
│   ├── orchestrator/         # Reconciliation worker/service, preview, bootstrap
│   ├── publicspace/          # URL discovery (llms.txt, sitemap, single URL)
│   └── services/             # HTTP, GitHub, Datamirror service
├── tests/                    # Unit tests
└── scripts/                  # Migration scripts
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

## License

MIT
