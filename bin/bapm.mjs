#!/usr/bin/env bun
// git-run entrypoint (`bunx github:owner/bapm`): bun executes TypeScript sources
// directly; npm-published installs use packages/cli/dist via @b-apm/cli bin.
import "../packages/cli/src/cli.ts";
