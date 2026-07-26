# CLAUDE.md

Parallel search aggregator — one query fans out to all configured engines. Full architecture: `docs/ARCHITECTURE.md`.

## Commands

```bash
make build       # Install npm deps, compile TypeScript, minify UI JS, compile Sass
make             # Build then serve (local dev, port 3000)
make oauth       # Generate Google OAuth refresh token
make oauth_microsoft  # Generate Microsoft Graph OAuth refresh token
```

## Gotchas

- TypeScript compile needs `NODE_OPTIONS=--max_old_space_size=4096` (already set in Makefile) — 4GB heap, or it OOMs
- Docker builds on this host need `--network=host` — containers here can't reach the internet otherwise
- Config path differs by environment: `config.yaml` locally, `/data/config.yaml` in Docker (see `docs/ARCHITECTURE.md`)
