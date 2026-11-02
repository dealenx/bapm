/**
 * --target value forms: host id, canonical package, id=package (unit + e2e).
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { parseTargetSpec } from "../../src/common/targetSpec.ts";
import {
  acmeMarkerPath,
  createTempProject,
  existsSync,
  linkCursorIntegration,
  linkFixturePackage,
  readFileSync,
  runInProject,
  writeActiveProject,
  writeText,
  type TempProject,
} from "./active-helpers.ts";
import { join } from "node:path";

describe("parseTargetSpec", () => {
  test("bare host id stays id-only", () => {
    expect(parseTargetSpec("cursor")).toEqual({ id: "cursor" });
  });

  test("canonical package derives id and keeps specifier", () => {
    expect(parseTargetSpec("@b-apm/integration-cursor")).toEqual({
      id: "cursor",
      specifier: "@b-apm/integration-cursor",
    });
  });

  test("id=package splits id and specifier (npm name or local path)", () => {
    expect(parseTargetSpec("x-acme=@acme/my-integration")).toEqual({
      id: "x-acme",
      specifier: "@acme/my-integration",
    });
    expect(parseTargetSpec("x-mine=./vendor/mine")).toEqual({
      id: "x-mine",
      specifier: "./vendor/mine",
    });
  });

  test("bare package name is rejected with id= guidance", () => {
    expect(parseTargetSpec("@acme/my-integration").error).toMatch(/id=@acme\/my-integration/);
    expect(parseTargetSpec("./vendor/mine").error).toMatch(/id=\.\/vendor\/mine/);
  });

  test("empty and half-empty id= forms error", () => {
    expect(parseTargetSpec("").error).toBeTruthy();
    expect(parseTargetSpec("=pkg").error).toBeTruthy();
    expect(parseTargetSpec("id=").error).toBeTruthy();
  });
});

describe("CLI install --target package forms", () => {
  let project: TempProject | undefined;

  afterEach(() => {
    project?.cleanup();
    project = undefined;
  });

  test("--target id=package registers an integration package absent from targets:", async () => {
    project = createTempProject();
    const acmeSpec = linkFixturePackage(project.cwd, "create-integration-pkg");
    writeActiveProject(project.cwd, {
      name: "cli-target-spec",
      active: { target: "x-acme-editor" },
    });

    const { result, combined } = await runInProject(project.cwd, [
      "install",
      "--target",
      `x-acme-editor=${acmeSpec}`,
    ]);

    expect(combined).not.toMatch(/unknown or unregistered target/i);
    expect(result).toBe(0);
    expect(existsSync(acmeMarkerPath(project.cwd))).toBe(true);
  });

  test("--target @b-apm/integration-cursor forces the canonical host without targets:", async () => {
    project = createTempProject();
    writeText(project.cwd, "bapm.yml", "name: cli-target-canonical\nversion: 0.0.1\n");

    const { result, combined } = await runInProject(project.cwd, [
      "install",
      "--target",
      "@b-apm/integration-cursor",
    ]);

    expect(combined).not.toMatch(/unknown or unregistered target/i);
    expect(result).toBe(0);
    expect(combined).toMatch(/installed for cursor/i);
  });

  test("bare package name via --target fails closed with id= guidance", async () => {
    project = createTempProject();
    linkFixturePackage(project.cwd, "create-integration-pkg");
    writeActiveProject(project.cwd, {
      name: "cli-target-spec-bad",
      active: { target: "x-acme-editor" },
    });

    const { result, combined } = await runInProject(project.cwd, [
      "install",
      "--target",
      "@acme/integration-editor",
    ]);

    expect(result).not.toBe(0);
    expect(combined).toMatch(/id=@acme\/integration-editor/);
  });

  test("bare --target registers the canonical package before the manifest exists (positional add)", async () => {
    project = createTempProject();
    linkCursorIntegration(project.cwd);
    writeText(project.cwd, "leaf/bapm.yml", "name: leaf\nversion: 1.0.0\n");

    // No manifest on disk yet: core auto-creates it from the positional ref,
    // which happens AFTER CLI registration — the forced id must not go blind.
    const { result, combined } = await runInProject(project.cwd, [
      "install",
      "./leaf",
      "--target",
      "cursor",
    ]);

    expect(result).toBe(0);
    expect(combined).toMatch(/installed for cursor/i);
    const manifestPath = existsSync(join(project.cwd, "apm.yml"))
      ? join(project.cwd, "apm.yml")
      : join(project.cwd, "bapm.yml");
    expect(existsSync(manifestPath)).toBe(true);

    // The forced target must land in the auto-created manifest so the next
    // bare `bapm install` reproduces without flags.
    const raw = readFileSync(manifestPath, "utf8");
    expect(raw).toMatch(/targets:/);
    expect(raw).toMatch(/cursor:\s*["']?@b-apm\/integration-cursor["']?/);
    expect(raw).toMatch(/active:/);

    // And the follow-up bare install uses the persisted target.
    const second = await runInProject(project.cwd, ["install"]);
    expect(second.result).toBe(0);
    expect(second.combined).toMatch(/installed for cursor/i);
  });

  test("--target does not rewrite an already declared active target", async () => {
    project = createTempProject();
    linkCursorIntegration(project.cwd);
    writeActiveProject(project.cwd, {
      name: "cli-target-declared",
      active: { target: "cursor" },
    });
    const before = readFileSync(join(project.cwd, "bapm.yml"), "utf8");

    const { result } = await runInProject(project.cwd, ["install", "--target", "cursor"]);
    expect(result).toBe(0);
    // Declared hosts stay the manifest owner's choice — --target is a
    // per-invocation override and must not mutate configured projects.
    expect(readFileSync(join(project.cwd, "bapm.yml"), "utf8")).toBe(before);
  });
});
