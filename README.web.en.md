# Godwit Web development build

A personal webmail adapter for Godwit commit `f8234f5a4cd7f74ede4e60e0407484d6674d47c7`. The original Apache-2.0 LICENSE and NOTICE are retained. [한국어](README.web.md)

This is an incomplete migration, not a feature-parity release. See [migration status](docs/web-migration.md).

Build with `docker compose -f compose.web.yaml build`, initialize once with `docker compose -f compose.web.yaml run --rm mail -init -data-dir /data -key-file /keys/vault.key`, then run `docker compose -f compose.web.yaml up -d`. The host endpoint is `http://127.0.0.1:8878`.

Initialization creates private 0600 files containing the initial password, TOTP setup URI and dedicated MCP token. Inspect them only in your private terminal; enroll an authenticator and sign in with the password and six-digit code. Never publish these files or paste them into logs. Existing installations are not overwritten.

For remote access, terminate TLS at a reverse proxy and set `GODWIT_ORIGIN` to the exact HTTPS origin. Disable SSE buffering and do not cache authenticated API responses. Configure your own Google/Microsoft web OAuth clients using the private `-oauth-clients` JSON file, keyed by provider ID (`gmail`, `outlook`), with `ID` and `Secret`. The registered callback is `ORIGIN/oauth/callback`.

Models are configured in Settings. A local model endpoint must be reachable by the Go server, not just the browser. External MCP clients use `/mcp` with Streamable HTTP and the dedicated Bearer token; OAuth discovery and individual host compatibility are not yet verified.

Development requires Go 1.27.3, Bun 1.4.2 and Node 22+. Install the original web dependencies, run `go tool mygo generate`, `go run ./cmd/godwit-web-types`, and `bun run browser:build` from `web/`. Run Vitest through Node (`node node_modules/vitest/vitest.mjs run --maxWorkers=2`), because Bun currently fails in jsdom setup. Run Go tests as an unprivileged user with writable `XDG_CACHE_HOME` and an init that reaps child processes.

Back up both mail-data and mail-keys volumes before an upgrade. Mail data is not encrypted at rest; credentials are encrypted using the separate AES-GCM key. Rollbacks involving schema changes require the matching previous data snapshot as well as the previous image. Ambiguous SMTP outcomes require owner review and are never automatically resent.
