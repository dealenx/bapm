/**
 * configureMcp → project `.omp/mcp.json` with omp-native mcpServers shape;
 * portable SSE accepted (omp supports the legacy transport); preserve unrelated
 * servers; never write other clients' MCP files.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, loadOmpIntegration, readJson, writeJson } from "./helpers.ts";

type McpDoc = {
  mcpServers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

describe("omp configureMcp → .omp/mcp.json", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function project(): { cwd: string } {
    const p = createTempProject("bapm-omp-mcp-");
    cleanup = p.cleanup;
    mkdirSync(join(p.cwd, ".omp"), { recursive: true });
    return { cwd: p.cwd };
  }

  test("writes mcpServers stdio entry under .omp/mcp.json", async () => {
    const { cwd } = project();

    const target = loadOmpIntegration();
    const report = await target.configureMcp!(
      [{ name: "test-stdio-server", command: "echo", args: ["hi"], env: { A: "b" } }],
      { cwd, deployRoots: target.deployRoots, targetId: "omp" },
    );

    const path = join(cwd, ".omp", "mcp.json");
    expect(existsSync(path)).toBe(true);
    expect(report.configPath).toBe(".omp/mcp.json");

    const doc = readJson(path) as McpDoc;
    const server = doc.mcpServers!["test-stdio-server"]!;
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("echo");
    expect(server.args).toEqual(["hi"]);
    expect(server.env).toEqual({ A: "b" });
    expect(existsSync(join(cwd, ".mcp.json"))).toBe(false);
    expect(existsSync(join(cwd, "mcp.json"))).toBe(false);
  });

  test("portable streamable-http and sse map to typed url entries", async () => {
    const { cwd } = project();

    const target = loadOmpIntegration();
    const report = await target.configureMcp!(
      [
        {
          name: "docs",
          format: "agent-plugin",
          transport: "streamable-http",
          url: "https://example.com/mcp",
        },
        {
          name: "legacy",
          format: "agent-plugin",
          transport: "sse",
          url: "https://example.com/sse",
        },
        {
          name: "weird",
          format: "agent-plugin",
          transport: "ftp",
          url: "ftp://example.com/mcp",
        },
      ],
      { cwd, deployRoots: target.deployRoots, targetId: "omp" },
    );

    const doc = readJson(join(cwd, ".omp", "mcp.json")) as McpDoc;
    expect(doc.mcpServers!["docs"]).toEqual({ type: "http", url: "https://example.com/mcp" });
    // omp accepts the legacy SSE transport natively — unlike pi, no fail-closed.
    expect(doc.mcpServers!["legacy"]).toEqual({ type: "sse", url: "https://example.com/sse" });
    expect(doc.mcpServers!["weird"]).toBeUndefined();
    const diag = (report.diagnostics ?? []).find((d) => d.server === "weird");
    expect(diag?.code).toBe("OMP_PORTABLE_MCP_UNSUPPORTED");
  });

  test("existing unrelated servers are preserved", async () => {
    const { cwd } = project();
    writeJson(join(cwd, ".omp", "mcp.json"), {
      mcpServers: { keep: { command: "keep-cmd" } },
    });

    const target = loadOmpIntegration();
    await target.configureMcp!([{ name: "fresh", command: "fresh-cmd" }], {
      cwd,
      deployRoots: target.deployRoots,
      targetId: "omp",
    });

    const doc = readJson(join(cwd, ".omp", "mcp.json")) as McpDoc;
    expect(doc.mcpServers!["keep"]!.command).toBe("keep-cmd");
    expect(doc.mcpServers!["fresh"]!.command).toBe("fresh-cmd");
  });
});
