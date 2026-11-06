# Public source review

This repository is a source-only snapshot derived from Godwit commit `f8234f5a4cd7f74ede4e60e0407484d6674d47c7`. It intentionally starts a new history so local deployment state and private author metadata are not imported. Original copyright, LICENSE and NOTICE are retained.

Excluded: runtime databases, attachments and caches, passwords, TOTP enrollment keys, MCP tokens, vault keys, environment files, deployment backups, local telemetry, private server paths and personal deployment domains. The original publisher workflows and distribution account configuration are omitted; the third-party desktop OAuth fallback is removed. Web operators must register their own OAuth clients.

Checks: exact matching against live and development credentials found no matches in the publication snapshot; deployment identifier and runtime/key-file checks found no matches. Gitleaks v8.24.3 reported 19 findings, all reviewed as synthetic test fixtures: 18 are byte-identical to the cited upstream commit and one is the public standard TOTP test vector. No blanket scanner suppression has been added. These test fixtures are retained to preserve security and authentication regression coverage.

No mail account data or production credentials are included. This review is evidence from automated scans and source inspection, not a guarantee that every possible sensitive string can be recognized.
