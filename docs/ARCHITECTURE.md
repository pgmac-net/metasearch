# Architecture

Metasearch is a parallel search aggregator — a single query fans out to all configured engines simultaneously and aggregates results.

## Request flow

1. `src/index.ts` — Express server (port 3000) loads `config.yaml`, registers all enabled engines, handles `GET /` (search UI) and `GET /search` (JSON results)
2. `src/engines/index.ts` — engine registry; exports all engine implementations
3. `src/engines/<name>.ts` — each engine queries one external service and returns `{ title, url, snippet?, modified? }[]`
4. `src/util.ts` — shared helpers: `sanitizeHtml`, `fuzzyIncludes`, `rateLimit`, `stripStopWords`, `escapeQuotes`

## Config loading (`src/index.ts`)

- Local: reads `config.yaml` from the project root
- Docker: reads `/data/config.yaml` (detected via `/.dockerenv` or `/run/.containerenv`)
- `${ENV_VAR}` syntax in the YAML is expanded from environment variables at startup
- Copy `config-example.yaml` → `config.yaml`; each engine section key must match the engine's registered name — only engines with a config section are enabled

## Adding an engine

1. Create `src/engines/<name>.ts` — export an async function matching the engine interface (any existing engine is a working template)
2. Register it in `src/engines/index.ts`
3. Add a sample config block to `config-example.yaml`

The function receives the per-engine config object and the search query string, and must handle its own errors (log and return `[]`) so one failing engine doesn't break the whole response.

## CI/CD

`.github/workflows/docker.yml` — builds on PR, builds+pushes to `macro.int.pgmac.net:5000` on merge to master, generates a CycloneDX SBoM from the image, attests both image and SBoM, uploads to Dependency Track (`dtrack.int.pgmac.net`) using org-level secret `DT_APIKEY`.

`.github/workflows/sbom.yml` — separate source-level SBoM workflow (reusable workflow from `pgmac-net/pg-actions`).
