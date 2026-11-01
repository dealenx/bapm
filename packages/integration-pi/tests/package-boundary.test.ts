/**
 * Package identity / registry surface for @b-apm/integration-pi.
 */
import { describe, expect, test } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIntegration, createPiIntegration } from "../src/index.ts";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "../..");
const coreRoot = join(repoRoot, "packages/core");

describe("@b-apm/integration-pi package boundary", () => {
  test("package is @b-apm/integration-pi with integration-api only (no core hard-dep)", () => {
    expect(existsSync(pkgRoot)).toBe(true);
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      name?: string;
      type?: string;
      description?: string;
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(pkg.name).toBe("@b-apm/integration-pi");
    expect(pkg.type).toBe("module");
    expect(pkg.dependencies?.["@b-apm/integration-api"]).toBeTruthy();
    expect(pkg.dependencies?.["@b-apm/core"]).toBeUndefined();
    expect(JSON.stringify(pkg.scripts ?? {})).toMatch(/vp/);
    expect(String(pkg.description ?? "")).toMatch(/\bpi\b/i);
  });

  test("createIntegration aliases createPiIntegration with id pi and deploy roots", () => {
    expect(createIntegration).toBe(createPiIntegration);
    const target = createPiIntegration();
    expect(target.id).toBe("pi");
    expect(typeof target.detect).toBe("function");
    expect(typeof target.materialize).toBe("function");
    expect(typeof target.configureMcp).toBe("function");
    expect(target.deployRoots).toEqual(expect.arrayContaining([".pi", ".agents/skills"]));
    expect(target.deployRoots).not.toContain(".");
    expect((target as { mcpEnvMode?: string }).mcpEnvMode).not.toBe("translate");
  });

  test("@b-apm/core must not hard-depend on @b-apm/integration-pi", () => {
    const corePkg = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(corePkg.dependencies).not.toHaveProperty("@b-apm/integration-pi");

    const viteConfig = readFileSync(join(coreRoot, "vite.config.ts"), "utf8");
    expect(viteConfig).not.toMatch(/["']@b-apm\/integration-pi["']\s*:/);
  });
});
