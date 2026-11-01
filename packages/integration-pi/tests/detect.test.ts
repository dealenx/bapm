/**
 * Detect: `.pi/` directory; never mkdir solely for detect.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, loadPiIntegration } from "./helpers.ts";

describe("pi detect", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("detects .pi directory", async () => {
    const project = createTempProject("bapm-pi-detect-dir-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".pi"), { recursive: true });

    const target = loadPiIntegration();
    expect(await target.detect({ cwd: project.cwd })).toBe(true);
  });

  test("empty project is not pi and detect does not create roots", async () => {
    const project = createTempProject("bapm-pi-detect-none-");
    cleanup = project.cleanup;

    const target = loadPiIntegration();
    expect(await target.detect({ cwd: project.cwd })).toBe(false);
    expect(existsSync(join(project.cwd, ".pi"))).toBe(false);
    expect(existsSync(join(project.cwd, ".agents"))).toBe(false);
  });

  test("lone .agents/ without .pi is not pi", async () => {
    const project = createTempProject("bapm-pi-detect-agents-only-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".agents", "skills"), { recursive: true });

    const target = loadPiIntegration();
    expect(await target.detect({ cwd: project.cwd })).toBe(false);
    expect(existsSync(join(project.cwd, ".pi"))).toBe(false);
  });
});
