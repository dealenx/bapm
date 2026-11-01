/**
 * Materialize: skills → .agents/skills; commands → .omp/prompts with shared
 * frontmatter filter; instructions/agents/hooks skipped with diagnostics;
 * deploy-root containment; portable plugin skill directory copied.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTempProject,
  loadOmpIntegration,
  reportDiagnostics,
  writePrimitiveFile,
} from "./helpers.ts";

describe("omp materialize", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("skill appears under .agents/skills (Agent Skills location omp discovers)", async () => {
    const project = createTempProject("bapm-omp-skill-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".omp"), { recursive: true });
    const srcDir = join(project.cwd, "src-skill");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "SKILL.md"), "---\nname: hello\n---\n# Hello\n", "utf8");

    const target = loadOmpIntegration();
    await target.materialize(
      [{ name: "hello", type: "skill", source: "local", path: join(srcDir, "SKILL.md") }],
      { cwd: project.cwd, targetId: "omp", deployRoots: target.deployRoots },
    );

    const dest = join(project.cwd, ".agents", "skills", "hello", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toMatch(/Hello/);
    expect(existsSync(join(project.cwd, ".omp", "skills", "hello", "SKILL.md"))).toBe(false);
  });

  test("command lands under .omp/prompts with description preserved", async () => {
    const project = createTempProject("bapm-omp-command-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".omp"), { recursive: true });
    // `name` is not in the shared allowlist: omp names the command after the
    // filename, so a frontmatter `name` never renames it and is dropped.
    const src = writePrimitiveFile(
      project.cwd,
      "cmd.md",
      '---\ndescription: Review staged changes\nargument-hint: "[focus]"\nname: review\n---\nReview $1.\n',
    );

    const target = loadOmpIntegration();
    const report = await target.materialize(
      [{ name: "review", type: "command", source: "local", path: src }],
      { cwd: project.cwd, targetId: "omp", deployRoots: target.deployRoots },
    );

    const dest = join(project.cwd, ".omp", "prompts", "review.md");
    expect(existsSync(dest)).toBe(true);
    const body = readFileSync(dest, "utf8");
    expect(body).toMatch(/description: Review staged changes/);
    expect(body).toMatch(/argument-hint/);
    expect(body).not.toMatch(/name: review/);
    expect(body).toMatch(/Review \$1/);
    const diag = reportDiagnostics(report).find(
      (d) => d.code === "OMP_COMMAND_FRONTMATTER_DROPPED",
    );
    expect(diag?.droppedKeys).toEqual(["name"]);
  });

  test("instruction, agent, and hook primitives are skipped with diagnostics", async () => {
    const project = createTempProject("bapm-omp-skips-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".omp"), { recursive: true });
    const instruction = writePrimitiveFile(project.cwd, "style.md", "# Style\n");
    const agent = writePrimitiveFile(project.cwd, "reviewer.md", "# Reviewer\n");
    const hook = writePrimitiveFile(project.cwd, "hook.json", "{}\n");

    const target = loadOmpIntegration();
    const report = await target.materialize(
      [
        { name: "style", type: "instruction", source: "local", path: instruction },
        { name: "reviewer", type: "agent", source: "local", path: agent },
        { name: "on-start", type: "hook", source: "local", path: hook },
      ],
      { cwd: project.cwd, targetId: "omp", deployRoots: target.deployRoots },
    );

    const codes = reportDiagnostics(report).map((d) => d.code);
    expect(codes).toContain("OMP_INSTRUCTION_SKIPPED");
    expect(codes).toContain("OMP_AGENT_UNSUPPORTED");
    expect(codes).toContain("OMP_HOOK_UNSUPPORTED");
    expect(existsSync(join(project.cwd, ".omp", "rules"))).toBe(false);
    expect(existsSync(join(project.cwd, ".omp", "agents"))).toBe(false);
    expect(existsSync(join(project.cwd, ".omp", "hooks"))).toBe(false);
    // No skills were materialized, so the shared skills tree must stay absent.
    expect(existsSync(join(project.cwd, ".agents"))).toBe(false);
    // AGENTS.md is the compile path, not materialize.
    expect(existsSync(join(project.cwd, "AGENTS.md"))).toBe(false);
  });

  test("portable Agent Plugins skill directory is fully copied", async () => {
    const project = createTempProject("bapm-omp-portable-skill-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".omp"), { recursive: true });
    const pluginRoot = join(project.cwd, "plugin");
    const skillDir = join(pluginRoot, "skills", "example");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: example\n---\n# Example\n", "utf8");
    writeFileSync(join(skillDir, "guide.md"), "auxiliary skill file\n", "utf8");

    const target = loadOmpIntegration();
    await target.materialize(
      [
        {
          name: "example",
          type: "skill",
          source: "local",
          path: join(skillDir, "SKILL.md"),
          format: "agent-plugin",
          skillDirectory: skillDir,
          pluginRoot,
        },
      ],
      { cwd: project.cwd, targetId: "omp", deployRoots: target.deployRoots },
    );

    expect(
      readFileSync(join(project.cwd, ".agents", "skills", "example", "guide.md"), "utf8"),
    ).toBe("auxiliary skill file\n");
    expect(existsSync(join(project.cwd, ".agents", "skills", "example", "SKILL.md"))).toBe(true);
  });

  test("materialize refuses when the .omp deploy root is missing", async () => {
    const project = createTempProject("bapm-omp-no-root-");
    cleanup = project.cleanup;

    const target = loadOmpIntegration();
    await expect(
      target.materialize([], {
        cwd: project.cwd,
        targetId: "omp",
        deployRoots: [".agents/skills"],
      }),
    ).rejects.toThrow(/\.omp deploy root/);
  });
});
