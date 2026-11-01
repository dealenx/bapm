#!/usr/bin/env bun
// git-run entrypoint (`bunx github:owner/bapm`): bun executes TypeScript sources
// directly; npm-published installs use packages/cli/dist via @b-apm/cli bin.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { plugin } from "bun";

// The monorepo's packages are not installed inside a git-run clone (bun cannot
// resolve workspace: deps of git dependencies), so redirect bare @b-apm/* specifiers
// to sibling sources when present; unknown packages fall through to normal resolution.
await plugin({
  name: "bapm-workspace-src",
  setup(build) {
    build.onResolve({ filter: /^@b-apm\/[^/]+$/ }, (args) => {
      const path = fileURLToPath(new URL(`../packages/${args.path.slice("@b-apm/".length)}/src/index.ts`, import.meta.url));
      if (existsSync(path)) return { path };
    });
  },
});

await import("../packages/cli/src/cli.ts");
