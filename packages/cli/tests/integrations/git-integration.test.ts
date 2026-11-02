/**
 * Git integration loading (`github:owner/repo`, `file://…`): clone into the
 * user config cache, load the built entry, validate id, reuse the cache.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGitIntegration } from "../../src/app/integrations/loadManifestIntegrations.ts";
import { parseTargetSpec } from "../../src/common/targetSpec.ts";

/** Minimal self-contained runtime integration (no dependencies → no build step). */
const ENTRY = `
export function createIntegration() {
  return {
    id: "x-git-test",
    deployRoots: [".git-test"],
    detect: () => false,
    async materialize() {
      return { targetId: "x-git-test", deployedFiles: [] };
    },
  };
}
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeGitIntegrationRepo(): { url: string; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "bapm-git-int-repo-"));
  const url = join(root, "integration-repo");
  mkdirSync(join(url, "dist"), { recursive: true });
  git(url, "init", "-q");
  git(url, "config", "user.email", "bapm@example.com");
  git(url, "config", "user.name", "bapm");
  writeFileSync(
    join(url, "package.json"),
    JSON.stringify(
      {
        name: "x-git-test",
        version: "0.0.1",
        type: "module",
        exports: { ".": "./dist/index.mjs" },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(url, "dist", "index.mjs"), ENTRY);
  git(url, "add", "-A");
  git(url, "commit", "-qm", "init");
  return {
    url: `file://${url}`,
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("git integration loading", () => {
  let cleanup: (() => void) | undefined;
  let configDir: string | undefined;
  const previousConfigDir = process.env.BAPM_CONFIG_DIR;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    if (previousConfigDir === undefined) delete process.env.BAPM_CONFIG_DIR;
    else process.env.BAPM_CONFIG_DIR = previousConfigDir;
  });

  function setup(): string {
    const repo = makeGitIntegrationRepo();
    const cfg = mkdtempSync(join(tmpdir(), "bapm-git-int-config-"));
    configDir = cfg;
    cleanup = () => {
      repo.cleanup();
      rmSync(cfg, { recursive: true, force: true });
    };
    process.env.BAPM_CONFIG_DIR = cfg;
    return repo.url;
  }

  /** The single cached clone dir under integrations-git/. */
  function cachedClone(): string {
    const root = join(configDir!, "integrations-git");
    const entries = readdirSync(root);
    if (entries.length !== 1) throw new Error(`expected one cached clone under ${root}`);
    return join(root, entries[0]!);
  }

  test("clones a git repo, loads and validates the integration", async () => {
    const url = setup();

    const integration = await loadGitIntegration(url, "x-git-test");

    expect(integration.id).toBe("x-git-test");
    expect(typeof integration.detect).toBe("function");
    expect(typeof integration.materialize).toBe("function");
    expect(integration.deployRoots).toContain(".git-test");
    expect(existsSync(join(cachedClone(), ".git"))).toBe(true);
  });

  test("second load reuses the cached clone (no re-clone)", async () => {
    const url = setup();
    await loadGitIntegration(url, "x-git-test");

    // Removing the origin remote makes any re-clone attempt fail loudly;
    // a cache hit must not touch the network.
    git(cachedClone(), "remote", "remove", "origin");

    const second = await loadGitIntegration(url, "x-git-test");
    expect(second.id).toBe("x-git-test");
  });

  test("wrong expected id fails closed with id_mismatch", async () => {
    const url = setup();
    await expect(loadGitIntegration(url, "x-other-id")).rejects.toThrow(/id_mismatch|x-other-id/);
  });

  test("github: specifier parses to a canonical id via target spec", () => {
    expect(parseTargetSpec("github:dealenx/bapm-omp")).toEqual({
      id: "omp",
      specifier: "github:dealenx/bapm-omp",
    });
  });
});
