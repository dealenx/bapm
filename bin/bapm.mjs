#!/usr/bin/env bun
// git-run entrypoint (`bunx github:owner/bapm`): bun executes TypeScript sources
// directly; npm-published installs use packages/cli/dist via @b-apm/cli bin.
// Bare @b-apm/* imports resolve to sibling sources via packages/*/tsconfig.json paths.
// BAPM_GIT_RUN flags canonical integration fallback to resolve from this checkout
// (see loadManifestIntegrations) — dynamic import so the flag is set before the CLI runs.
process.env.BAPM_GIT_RUN ??= "1";
await import("../packages/cli/src/cli.ts");
