/**
 * Package identity / registry surface for @b-apm/integration-omp.
 */
import { describe, expect, test } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIntegration, createOmpIntegration } from "../src/index.ts";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "../..");
const coreRoot = join(repoRoot, "packages/core");

describe("@b-apm/integration-omp package boundary", () => {
  test("package is @b-apm/integration-omp with integration-api only (no core hard-dep)", () => {
    expect(existsSync(pkgRoot)).toBe(true);
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      name?: string;
      type?: string;
      description?: string;
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(pkg.name).toBe("@b-apm/integration-omp");
    expect(pkg.type).toBe("module");
    expect(pkg.dependencies?.["@b-apm/integration-api"]).toBeTruthy();
    expect(pkg.dependencies?.["@b-apm/core"]).toBeUndefined();
    expect(JSON.stringify(pkg.scripts ?? {})).toMatch(/vp/);
    expect(String(pkg.description ?? "")).toMatch(/omp/i);
  });

  test("createIntegration aliases createOmpIntegration with id omp and deploy roots", () => {
    expect(createIntegration).toBe(createOmpIntegration);
    const target = createOmpIntegration();
    expect(target.id).toBe("omp");
    expect(typeof target.detect).toBe("function");
    expect(typeof target.materialize).toBe("function");
    expect(typeof target.configureMcp).toBe("function");
    expect(target.deployRoots).toEqual(expect.arrayContaining([".omp", ".agents/skills"]));
    expect(target.deployRoots).not.toContain(".");
    const mcpEnvMode = "mcpEnvMode" in target ? target.mcpEnvMode : undefined;
    expect(mcpEnvMode).not.toBe("translate");
  });

  test("@b-apm/core must not hard-depend on @b-apm/integration-omp", () => {
    const corePkg = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(corePkg.dependencies).not.toHaveProperty("@b-apm/integration-omp");

    const viteConfig = readFileSync(join(coreRoot, "vite.config.ts"), "utf8");
    expect(viteConfig).not.toMatch(/["']@b-apm\/integration-omp["']\s*:/);
  });
});
