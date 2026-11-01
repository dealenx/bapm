/**
 * configureMcp → project `.pi/mcp.json` with pi-native mcpServers shape;
 * portable SSE fail-closed (pi rejects sse); preserve unrelated servers;
 * never write other clients' MCP files.
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTempProject, loadPiIntegration, readJson, writeJson } from "./helpers.ts";

type McpDoc = {
  mcpServers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

describe("pi configureMcp → .pi/mcp.json", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function project(): { cwd: string } {
    const p = createTempProject("bapm-pi-mcp-");
    cleanup = p.cleanup;
    mkdirSync(join(p.cwd, ".pi"), { recursive: true });
    return { cwd: p.cwd };
  }

  test("writes mcpServers stdio entry under .pi/mcp.json", async () => {
    const { cwd } = project();

    const target = loadPiIntegration();
    const report = await target.configureMcp!(
      [{ name: "test-stdio-server", command: "echo", args: ["hi"], env: { A: "b" } }],
      { cwd, deployRoots: target.deployRoots, targetId: "pi" },
    );

    const path = join(cwd, ".pi", "mcp.json");
    expect(existsSync(path)).toBe(true);
    expect(report.configPath).toBe(".pi/mcp.json");

    const doc = readJson(path) as McpDoc;
    const server = doc.mcpServers!["test-stdio-server"]!;
    expect(server.command).toBe("echo");
    expect(server.args).toEqual(["hi"]);
    expect(server.env).toEqual({ A: "b" });
    expect(existsSync(join(cwd, ".mcp.json"))).toBe(false);
    expect(existsSync(join(cwd, "mcp.json"))).toBe(false);
    expect(existsSync(join(cwd, "mcp.json"))).toBe(false);
  });

  test("portable streamable-http maps to url entry; portable sse fails closed", async () => {
    const { cwd } = project();

    const target = loadPiIntegration();
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
      ],
      { cwd, deployRoots: target.deployRoots, targetId: "pi" },
    );

    const doc = readJson(join(cwd, ".pi", "mcp.json")) as McpDoc;
    expect(doc.mcpServers!["docs"]!.url).toBe("https://example.com/mcp");
    expect(doc.mcpServers!["legacy"]).toBeUndefined();
    const diag = (report.diagnostics ?? []).find((d) => d.server === "legacy");
    expect(diag?.code).toBe("PI_PORTABLE_MCP_UNSUPPORTED");
    expect(String(diag?.message)).toMatch(/sse/i);
  });

  test("existing unrelated servers are preserved", async () => {
    const { cwd } = project();
    writeJson(join(cwd, ".pi", "mcp.json"), {
      mcpServers: { keep: { command: "keep-cmd" } },
    });

    const target = loadPiIntegration();
    await target.configureMcp!([{ name: "fresh", command: "fresh-cmd" }], {
      cwd,
      deployRoots: target.deployRoots,
      targetId: "pi",
    });

    const doc = readJson(join(cwd, ".pi", "mcp.json")) as McpDoc;
    expect(doc.mcpServers!["keep"]!.command).toBe("keep-cmd");
    expect(doc.mcpServers!["fresh"]!.command).toBe("fresh-cmd");
  });
});
