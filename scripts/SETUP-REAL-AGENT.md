## Setup Commands — Run in order

### Step 1: Scaffold the agent (from plugin directory)
```powershell
cd C:\Users\kidco\dev\eliza\plugin-autognostic
npx tsx scripts/scaffold-test-agent.ts
```

### Step 2: Commit plugin changes first
```powershell
cd C:\Users\kidco\dev\eliza\plugin-autognostic
git add -A
git commit -m "feat: direct Ollama embedding, action routing fixes, test agent scaffold

- Add ollamaDirectEmbed provider (bypasses broken ollama-ai-provider v1/ai SDK v5 incompatibility)
- Register TEXT_EMBEDDING model override in plugin models map
- Rewrite fullDocumentProvider: routing-only inventory, no content leaking
- Strengthen GET_EXACT_QUOTE description with anti-REPLY routing language
- Add default full-doc fallback when no mode detected
- Widen validate regex: print/show/contents/give/get patterns
- Clean callback messages: [STORED] prefix to prevent context pollution
- Add test-embedding.ts, test-direct-embed.ts diagnostic scripts
- Add scaffold-test-agent.ts for real agent environment testing"
git push origin main
```

### Step 3: Set up the agent
```powershell
cd C:\Users\kidco\dev\eliza\autognostic-agent
New-Item -ItemType Junction -Path packages\plugin-autognostic -Target ..\plugin-autognostic\
bun install
```

### Step 4: Build and run
```powershell
bun run build
elizaos dev
```

### Step 5: Ctrl+Shift+R the browser, then test
```
1. "Add this to knowledge: https://github.com/Mayakovsky/test_tube/blob/main/potato_chimpanzee_falafel_garb.md"
2. "What documents do you have?"
3. "Print the full document"
4. "What's the last line?"
```
