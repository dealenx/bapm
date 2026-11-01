/**
 * Create the Pi (pi.dev) target.
 * Detect: project-root `.pi/` directory (pi project config dir).
 * Materialize: skills → `.agents/skills/<name>/SKILL.md` (Agent Skills standard;
 *   pi discovers project `.agents/skills` from cwd up to the repository root),
 *   commands → `.pi/prompts/<name>.md` (description / argument-hint frontmatter),
 *   instructions → non-fatal skip (pi has no per-file rules dir — `bapm compile`
 *   emits AGENTS.md, which pi loads as a context file),
 *   agents / hooks → non-fatal skip diagnostics.
 * MCP: optional `configureMcp` writes `.pi/mcp.json` (`mcpServers`; portable SSE
 *   is fail-closed because pi rejects the `sse` transport).
 * Compile: project-root `AGENTS.md` (context-file family pi reads from cwd/parents).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  BapmIntegration,
  CompileReport,
  ConfigureMcpContext,
  ConfigureMcpReport,
  MaterializeReport,
  McpServerConfig,
} from "@b-apm/integration-api";
import {
  SHARED_COMMAND_FRONTMATTER_KEYS,
  assertUnderDeployRoots,
  compileMarkdownReport,
  filterFrontmatterKeys,
  materializeSkill,
  primitivesList,
  primitivesMaterialize,
  readPrimitiveContent,
  renderPrimitivesMarkdown,
  writeDeployedFile,
} from "@b-apm/integration-api";

const DEFAULT_DEPLOY_ROOTS = [".agents/skills", ".pi"] as const;
const MCP_JSON_REL = ".pi/mcp.json";

export function createPiIntegration(options?: {
  id?: string;
  deployRoots?: string[];
}): BapmIntegration {
  const id = options?.id ?? "pi";
  const deployRoots = [...(options?.deployRoots ?? DEFAULT_DEPLOY_ROOTS)];

  return {
    id,
    deployRoots,
    detect: ({ cwd }) => {
      const piDir = join(cwd, ".pi");
      return existsSync(piDir) && statSync(piDir).isDirectory();
    },
    getDeployRoots: () => [...deployRoots],
    async compile(primitives, context): Promise<CompileReport> {
      const content = renderPrimitivesMarkdown({
        primitives: primitivesList(primitives),
        title: "# AGENTS.md",
      });
      return compileMarkdownReport({
        cwd: context.cwd,
        outputFile: context.outputFile ?? "AGENTS.md",
        write: context.write,
        content,
        requireBasename: "AGENTS.md",
        outsideCwdMessage: "Pi compile output must be a cwd-relative file path",
      });
    },
    async materialize(primitives, ctx): Promise<MaterializeReport> {
      const cwd = resolve(ctx?.cwd ?? process.cwd());
      const roots = ctx?.deployRoots?.length ? [...ctx.deployRoots] : deployRoots;
      if (!roots.some((r) => r === ".pi" || r.startsWith(".pi"))) {
        throw new Error("pi target missing .pi deploy root");
      }
      if (!roots.some((r) => r === ".agents/skills" || r.startsWith(".agents/skills"))) {
        throw new Error("pi target missing .agents/skills deploy root");
      }

      const deployedFiles: MaterializeReport["deployedFiles"] = [];
      const diagnostics: NonNullable<MaterializeReport["diagnostics"]> = [];

      await primitivesMaterialize(primitives, {
        skill(p, { name }) {
          deployedFiles.push(
            ...materializeSkill({
              primitive: p,
              cwd,
              deployRoots: roots,
              destDir: join(".agents", "skills", name),
            }),
          );
        },
        instruction(p, { name }) {
          diagnostics.push({
            code: "PI_INSTRUCTION_SKIPPED",
            message: `Pi has no per-file rules directory; instruction "${name}" reaches pi through bapm compile → AGENTS.md`,
            primitive: String(p.name),
          });
        },
        agent(p) {
          diagnostics.push({
            code: "PI_AGENT_UNSUPPORTED",
            message: `Pi does not receive agents from this target; ship "${p.name}" as a skill instead`,
            primitive: String(p.name),
          });
        },
        command(p, { name }) {
          const { content, droppedKeys } = filterFrontmatterKeys(
            readPrimitiveContent(p),
            SHARED_COMMAND_FRONTMATTER_KEYS,
          );
          deployedFiles.push(
            writeDeployedFile({
              cwd,
              deployRoots: roots,
              destRel: join(".pi", "prompts", `${name}.md`),
              content,
              primitive: { name: String(p.name), packageName: p.packageName },
            }),
          );
          if (droppedKeys.length > 0) {
            diagnostics.push({
              code: "PI_COMMAND_FRONTMATTER_DROPPED",
              message: `Dropped non-preserved command frontmatter keys for "${p.name}": ${droppedKeys.join(", ")}`,
              primitive: String(p.name),
              droppedKeys,
            });
          }
        },
        hook(p) {
          diagnostics.push({
            code: "PI_HOOK_UNSUPPORTED",
            message: `Pi hooks are extension-owned and are not written by this target; hook "${p.name}" skipped`,
            primitive: String(p.name),
          });
        },
      });

      return {
        targetId: id,
        deployedFiles,
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      };
    },
    async configureMcp(servers, ctx): Promise<ConfigureMcpReport> {
      return writePiMcpConfig(servers, {
        cwd: resolve(ctx?.cwd ?? process.cwd()),
        deployRoots: ctx?.deployRoots?.length ? [...ctx.deployRoots] : deployRoots,
        targetId: ctx?.targetId ?? id,
      });
    },
  };
}

function writePiMcpConfig(
  servers: McpServerConfig[] | Record<string, McpServerConfig>,
  ctx: ConfigureMcpContext & { cwd: string; deployRoots: string[] },
): ConfigureMcpReport {
  const { cwd, deployRoots } = ctx;
  if (!deployRoots.some((r) => r === ".pi" || r.startsWith(".pi"))) {
    throw new Error("pi configureMcp requires a registered .pi deploy root");
  }

  const destFile = join(cwd, ".pi", "mcp.json");
  assertUnderDeployRoots(cwd, destFile, deployRoots);
  mkdirSync(join(cwd, ".pi"), { recursive: true });

  const existing = readExistingMcpServers(destFile);
  const { entries: incoming, diagnostics } = normalizeServerEntries(servers);
  const next: Record<string, Record<string, unknown>> = { ...existing };

  const writtenNames: string[] = [];
  for (const [name, entry] of Object.entries(incoming)) {
    next[name] = entry;
    writtenNames.push(name);
  }

  const doc = { mcpServers: next };
  writeFileSync(destFile, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  return {
    targetId: ctx.targetId,
    configPath: MCP_JSON_REL,
    servers: writtenNames,
    deployedFiles: [{ path: MCP_JSON_REL }],
    diagnostics,
  } as ConfigureMcpReport;
}

function readExistingMcpServers(path: string): Record<string, Record<string, unknown>> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: Record<string, Record<string, unknown>>;
    };
    return raw.mcpServers && typeof raw.mcpServers === "object" ? { ...raw.mcpServers } : {};
  } catch {
    return {};
  }
}

function normalizeServerEntries(servers: McpServerConfig[] | Record<string, McpServerConfig>): {
  entries: Record<string, Record<string, unknown>>;
  diagnostics: Array<{ code: string; message: string; server?: string }>;
} {
  const out: Record<string, Record<string, unknown>> = {};
  const diagnostics: Array<{ code: string; message: string; server?: string }> = [];
  const list: McpServerConfig[] = Array.isArray(servers)
    ? servers
    : Object.entries(servers).map(([name, value]) => ({
        ...value,
        name: value.name ?? name,
      }));

  for (const server of list) {
    const name = String(server.name ?? "").trim();
    if (!name) continue;
    const entry = toPiServerEntry(server);
    if (!entry) {
      const transport = String(server.transport ?? server.type ?? "").toLowerCase();
      diagnostics.push({
        code: "PI_PORTABLE_MCP_UNSUPPORTED",
        message:
          transport === "sse"
            ? `Pi rejects the sse transport; MCP server "${name}" was not written (use streamable http)`
            : `Pi cannot faithfully represent MCP server "${name}" (stdio needs command; http needs url)`,
        server: name,
      });
      continue;
    }
    out[name] = entry;
  }
  return { entries: out, diagnostics };
}

const ADAPTER_KEYS: Record<string, true> = {
  name: true,
  transport: true,
  type: true,
  command: true,
  args: true,
  url: true,
  env: true,
  cwd: true,
  packageName: true,
  registry: true,
  format: true,
};

function toPiServerEntry(server: McpServerConfig): Record<string, unknown> | undefined {
  const transport = String(server.transport ?? server.type ?? "").toLowerCase();
  const entry: Record<string, unknown> = {};
  const portable = server.format === "agent-plugin";

  if (portable) {
    // Portable v1 is adapted field-by-field, never copied as pi JSON.
    if (transport === "stdio") {
      if (typeof server.command !== "string") return undefined;
      entry.command = server.command;
      if (Array.isArray(server.args)) entry.args = server.args;
      if (typeof server.cwd === "string") entry.cwd = server.cwd;
      if (server.env && typeof server.env === "object") entry.env = server.env;
      return entry;
    }
    if (transport === "streamable-http" || transport === "http") {
      if (typeof server.url !== "string") return undefined;
      entry.url = server.url;
      return entry;
    }
    // pi rejects sse (and any other transport) — fail closed with a diagnostic.
    return undefined;
  }

  if (typeof server.url === "string" && server.url) {
    entry.url = server.url;
  } else {
    if (typeof server.command !== "string") return undefined;
    entry.command = server.command;
    if (Array.isArray(server.args)) entry.args = server.args;
    if (typeof server.cwd === "string") entry.cwd = server.cwd;
    if (server.env && typeof server.env === "object") entry.env = server.env;
  }

  // Preserve native extra keys (headers, description, timeout, …), never adapter metadata.
  for (const [key, value] of Object.entries(server)) {
    if (ADAPTER_KEYS[key]) continue;
    if (value !== undefined) entry[key] = value;
  }

  return entry;
}
