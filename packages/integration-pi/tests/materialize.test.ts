/**
 * Materialize: skills → .agents/skills; commands → .pi/prompts with shared
 * frontmatter filter; instructions/agents/hooks skipped with diagnostics;
 * deploy-root containment; portable plugin skill directory copied.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTempProject,
  loadPiIntegration,
  reportDiagnostics,
  writePrimitiveFile,
} from "./helpers.ts";

describe("pi materialize", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  test("skill appears under .agents/skills (Agent Skills location pi discovers)", async () => {
    const project = createTempProject("bapm-pi-skill-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".pi"), { recursive: true });
    const srcDir = join(project.cwd, "src-skill");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "SKILL.md"), "---\nname: hello\n---\n# Hello\n", "utf8");

    const target = loadPiIntegration();
    await target.materialize(
      [{ name: "hello", type: "skill", source: "local", path: join(srcDir, "SKILL.md") }],
      { cwd: project.cwd, targetId: "pi", deployRoots: target.deployRoots },
    );

    const dest = join(project.cwd, ".agents", "skills", "hello", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toMatch(/Hello/);
    expect(existsSync(join(project.cwd, ".pi", "skills", "hello", "SKILL.md"))).toBe(false);
  });

  test("command lands under .pi/prompts with description preserved", async () => {
    const project = createTempProject("bapm-pi-command-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".pi"), { recursive: true });
    const src = writePrimitiveFile(
      project.cwd,
      "cmd.md",
      '---\ndescription: Review staged changes\nargument-hint: "[focus]"\nmodel: sonnet\nglobs: "**/*.ts"\n---\nReview $1.\n',
    );

    const target = loadPiIntegration();
    await target.materialize([{ name: "review", type: "command", source: "local", path: src }], {
      cwd: project.cwd,
      targetId: "pi",
      deployRoots: target.deployRoots,
    });

    const dest = join(project.cwd, ".pi", "prompts", "review.md");
    expect(existsSync(dest)).toBe(true);
    const body = readFileSync(dest, "utf8");
    expect(body).toMatch(/description: Review staged changes/);
    expect(body).toMatch(/argument-hint/);
    expect(body).toMatch(/model: sonnet/);
    expect(body).not.toMatch(/globs:/);
    expect(body).toMatch(/Review \$1/);
  });

  test("instruction, agent, and hook primitives are skipped with diagnostics", async () => {
    const project = createTempProject("bapm-pi-skips-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".pi"), { recursive: true });
    const instruction = writePrimitiveFile(project.cwd, "style.md", "# Style\n");
    const agent = writePrimitiveFile(project.cwd, "reviewer.md", "# Reviewer\n");
    const hook = writePrimitiveFile(project.cwd, "hook.json", "{}\n");

    const target = loadPiIntegration();
    const report = await target.materialize(
      [
        { name: "style", type: "instruction", source: "local", path: instruction },
        { name: "reviewer", type: "agent", source: "local", path: agent },
        { name: "on-start", type: "hook", source: "local", path: hook },
      ],
      { cwd: project.cwd, targetId: "pi", deployRoots: target.deployRoots },
    );

    const codes = reportDiagnostics(report).map((d) => d.code);
    expect(codes).toContain("PI_INSTRUCTION_SKIPPED");
    expect(codes).toContain("PI_AGENT_UNSUPPORTED");
    expect(codes).toContain("PI_HOOK_UNSUPPORTED");
    expect(existsSync(join(project.cwd, ".pi", "rules"))).toBe(false);
    expect(existsSync(join(project.cwd, ".pi", "agents"))).toBe(false);
    expect(existsSync(join(project.cwd, ".pi", "hooks"))).toBe(false);
    // AGENTS.md is the compile path, not materialize.
    expect(existsSync(join(project.cwd, "AGENTS.md"))).toBe(false);
  });

  test("portable Agent Plugins skill directory is fully copied", async () => {
    const project = createTempProject("bapm-pi-portable-skill-");
    cleanup = project.cleanup;
    mkdirSync(join(project.cwd, ".pi"), { recursive: true });
    const pluginRoot = join(project.cwd, "plugin");
    const skillDir = join(pluginRoot, "skills", "example");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: example\n---\n# Example\n", "utf8");
    writeFileSync(join(skillDir, "guide.md"), "auxiliary skill file\n", "utf8");

    const target = loadPiIntegration();
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
      { cwd: project.cwd, targetId: "pi", deployRoots: target.deployRoots },
    );

    expect(
      readFileSync(join(project.cwd, ".agents", "skills", "example", "guide.md"), "utf8"),
    ).toBe("auxiliary skill file\n");
    expect(existsSync(join(project.cwd, ".agents", "skills", "example", "SKILL.md"))).toBe(true);
  });

  test("materialize refuses when the .pi deploy root is missing", async () => {
    const project = createTempProject("bapm-pi-no-root-");
    cleanup = project.cleanup;

    const target = loadPiIntegration();
    await expect(
      target.materialize([], {
        cwd: project.cwd,
        targetId: "pi",
        deployRoots: [".agents/skills"],
      }),
    ).rejects.toThrow(/\.pi deploy root/);
  });
});
