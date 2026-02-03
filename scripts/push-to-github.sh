#!/bin/bash
# Push autognostic plugin to GitHub
# Run from: C:\Users\kidco\dev\eliza\autognostic-agent\packages\plugin-autognostic

cd "C:\Users\kidco\dev\eliza\autognostic-agent\packages\plugin-autognostic"

git add .

git commit -m "fix: resolve circular dependency in plugin initialization

- Use dynamic import for DatabaseSeeder in init()
- Add DatabaseSeeder service for seed data
- Add seedData.ts with L1 taxonomy and controlled vocab
- Add migrations/README.md documenting dual-mode deployment
- Update .env.example for PGlite and PostgreSQL modes
- Fix SERVER-STARTUP-ERROR by breaking import cycle"

git push origin main
