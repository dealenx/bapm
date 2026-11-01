/**
 * Detect: `.omp/` directory; never mkdir solely for detect.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, loadOmpIntegration } from "./helpers.ts";

describe("omp detect", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("detects .omp directory", async () => {
    const project = createTempProject("bapm-omp-detect-dir-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".omp"), { recursive: true });

    const target = loadOmpIntegration();
    expect(await target.detect({ cwd: project.cwd })).toBe(true);
  });

  test("empty project is not omp and detect does not create roots", async () => {
    const project = createTempProject("bapm-omp-detect-none-");
    cleanup = project.cleanup;
    const target = loadOmpIntegration();
    expect(await target.detect({ cwd: project.cwd })).toBe(false);
    expect(existsSync(join(project.cwd, ".omp"))).toBe(false);
    expect(existsSync(join(project.cwd, ".agents"))).toBe(false);
  });

  test("lone .agents/ without .omp is not omp", async () => {
    const project = createTempProject("bapm-omp-detect-agents-only-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".agents", "skills"), { recursive: true });

    const target = loadOmpIntegration();
    expect(await target.detect({ cwd: project.cwd })).toBe(false);
    expect(existsSync(join(project.cwd, ".omp"))).toBe(false);
  });
});
