import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDefaultDownloader,
  declaredTargetIntegrationMap,
  identityToCacheDir,
  loadManifest,
  ManifestError,
  normalizeRepoIdentity,
  resolveUserConfigRoot,
  type BapmManifest,
} from "@b-apm/core";
import type { BapmIntegration, IntegrationRegistry } from "@b-apm/integration-api";
import { CANONICAL_HOST_IDS, canonicalPackageSpecifier } from "@/common/canonicalHosts.ts";
import { isGitIntegrationSpecifier } from "@/common/targetSpec.ts";
import { isLocalPathSpecifier, resolveContainedLocalPath } from "./localPathSpecifier.ts";

export type ManifestIntegrationLoadCause =
  | "unresolvable"
  | "invalid_export"
  | "marketplace_only"
  | "id_mismatch";

/** Fail-closed diagnostic for object-map integration package load. */
export class ManifestIntegrationLoadError extends Error {
  readonly hostId: string;
  readonly specifier: string;
  readonly causeClass: ManifestIntegrationLoadCause;

  constructor(
    hostId: string,
    specifier: string,
    causeClass: ManifestIntegrationLoadCause,
    detail: string,
  ) {
    super(
      `Failed to load target integration "${hostId}" from "${specifier}": ${causeClass} — ${detail}`,
    );
    this.name = "ManifestIntegrationLoadError";
    this.hostId = hostId;
    this.specifier = specifier;
    this.causeClass = causeClass;
  }
}

function isContainedUnderRoot(absoluteTarget: string, projectRoot: string): boolean {
  const root = resolve(projectRoot);
  const targetRelativeToRoot = relative(root, resolve(absoluteTarget));
  if (targetRelativeToRoot === "") return true;
  return !(
    targetRelativeToRoot === ".." ||
    targetRelativeToRoot.startsWith("..\\") ||
    targetRelativeToRoot.startsWith("../") ||
    isAbsolute(targetRelativeToRoot)
  );
}

type ResolveNpmOptions = {
  /** Map entries may resolve from the CLI package; canonical entries must not. */
  allowCliFallback?: boolean;
  /** Overrides discovered global roots for an embedding or isolated test. */
  globalRoots?: readonly string[];
};

let cachedGlobalModuleRoots: readonly string[] | undefined;

/**
 * Return the node_modules root only when the invoked entrypoint is this CLI
 * package. Resolving the symlink handles npm and pnpm global bin shims without
 * spawning a package manager during every CLI process.
 */
export function globalModuleRootForCliEntry(entryPath: string | undefined): string | undefined {
  if (!entryPath) return undefined;

  let entry = resolve(entryPath);
  try {
    entry = realpathSync(entry);
  } catch {
    // Keep the resolved path for embedders and tests with a synthetic entrypoint.
  }

  for (let directory = dirname(entry); ; directory = dirname(directory)) {
    if (basename(directory) === "node_modules") {
      const packagePath = relative(directory, entry).split(sep);
      return packagePath[0] === "@b-apm" && packagePath[1] === "cli" ? directory : undefined;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
  }
}

function isWorkspaceModuleRoot(moduleRoot: string): boolean {
  for (let directory = dirname(moduleRoot); ; directory = dirname(directory)) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return true;
    const parent = dirname(directory);
    if (parent === directory) return false;
  }
}

/** Locate the global module root of the invoked CLI without consulting dev dependencies. */
export function globalModuleRoots(): readonly string[] {
  if (cachedGlobalModuleRoots) return cachedGlobalModuleRoots;

  const root = globalModuleRootForCliEntry(process.argv[1]);
  cachedGlobalModuleRoots = root && !isWorkspaceModuleRoot(root) ? [root] : [];
  return cachedGlobalModuleRoots;
}

/** Resolve a canonical package from the project, global paths, or global module roots. */
function resolveNpmProjectOrGlobal(
  specifier: string,
  cwd: string,
  globalRoots: readonly string[] = globalModuleRoots(),
): string {
  const requireFromCwd = createRequire(join(cwd, "package.json"));
  try {
    return requireFromCwd.resolve(specifier);
  } catch (cwdErr) {
    // `module.globalPaths` exists at runtime; default ESM type export may omit it.
    const mod = createRequire(import.meta.url)("node:module") as { globalPaths?: string[] };
    const globalPaths = Array.isArray(mod.globalPaths)
      ? mod.globalPaths.filter((path) => !isWorkspaceModuleRoot(path))
      : [];
    const searchRoots = [...globalPaths, ...globalRoots];
    if (searchRoots.length === 0) throw cwdErr;
    try {
      return requireFromCwd.resolve(specifier, { paths: searchRoots });
    } catch {
      throw cwdErr;
    }
  }
}

/** npm package: project cwd first, then CLI fallback (map) or global lookup (canonical). */
function resolveNpmPackageSpecifier(
  specifier: string,
  cwd: string,
  options: ResolveNpmOptions = {},
): string {
  const allowCliFallback = options.allowCliFallback !== false;
  if (!allowCliFallback) {
    return resolveNpmProjectOrGlobal(specifier, cwd, options.globalRoots);
  }
  const requireFromCwd = createRequire(join(cwd, "package.json"));
  try {
    return requireFromCwd.resolve(specifier);
  } catch (cwdErr) {
    const requireFromCli = createRequire(import.meta.url);
    try {
      return requireFromCli.resolve(specifier);
    } catch {
      throw cwdErr;
    }
  }
}

/**
 * Local path: containment under project root, then createRequire from cwd only
 * (no CLI fallback — path miss fails closed).
 */
function resolveLocalIntegrationPath(specifier: string, hostId: string, cwd: string): string {
  const contained = resolveContainedLocalPath(specifier, cwd);
  if (contained === null) {
    throw new ManifestIntegrationLoadError(
      hostId,
      specifier,
      "unresolvable",
      `local path escapes project root (containment): ${specifier}`,
    );
  }

  const requireFromCwd = createRequire(join(cwd, "package.json"));
  let resolved: string;
  try {
    resolved = requireFromCwd.resolve(specifier);
  } catch (cause) {
    const detail =
      cause instanceof Error ? cause.message : "cannot find module / unresolvable path";
    throw new ManifestIntegrationLoadError(
      hostId,
      specifier,
      "unresolvable",
      `unresolvable local path / missing module: ${detail}`,
    );
  }

  if (!isContainedUnderRoot(resolved, cwd)) {
    throw new ManifestIntegrationLoadError(
      hostId,
      specifier,
      "unresolvable",
      `resolved local path escapes project root (containment): ${specifier}`,
    );
  }

  return resolved;
}

function isMarketplaceOnly(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  const mo = rec.marketplaceOutput;
  if (!mo || typeof mo !== "object") return false;
  const hasRuntime = typeof rec.detect === "function" && typeof rec.materialize === "function";
  return !hasRuntime;
}

function isRuntimeIntegration(value: unknown): value is BapmIntegration {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  return (
    id.length > 0 &&
    Array.isArray(rec.deployRoots) &&
    typeof rec.detect === "function" &&
    typeof rec.materialize === "function"
  );
}

function extractIntegrationCandidate(mod: Record<string, unknown>): unknown {
  if (typeof mod.createIntegration === "function") {
    return (mod.createIntegration as () => unknown)();
  }
  if (typeof mod.createCursorIntegration === "function") {
    return (mod.createCursorIntegration as () => unknown)();
  }
  if ("default" in mod) {
    const d = mod.default;
    return typeof d === "function" ? (d as () => unknown)() : d;
  }
  return undefined;
}

export type LoadIntegrationOptions = {
  /**
   * For npm specifiers: also try resolving from the CLI package (map entries).
   * Canonical fallback sets this false to use project and global roots only.
   */
  allowCliFallback?: boolean;
  /** Overrides discovered global roots for an embedding or isolated test. */
  globalRoots?: readonly string[];
};

/**
 * Import an integration module file and extract a validated runtime
 * `BapmIntegration` (createIntegration → createCursorIntegration → default).
 */
async function loadIntegrationModule(
  resolvedPath: string,
  specifier: string,
  expectedId: string,
): Promise<BapmIntegration> {
  let mod: Record<string, unknown>;
  try {
    const imported = await import(pathToFileURL(resolvedPath).href);
    mod = (imported ?? {}) as Record<string, unknown>;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ManifestIntegrationLoadError(
      expectedId,
      specifier,
      "unresolvable",
      `failed to load module: ${detail}`,
    );
  }

  let candidate: unknown;
  try {
    candidate = extractIntegrationCandidate(mod);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ManifestIntegrationLoadError(
      expectedId,
      specifier,
      "invalid_export",
      `invalid export / factory threw: ${detail}`,
    );
  }

  if (candidate === undefined) {
    throw new ManifestIntegrationLoadError(
      expectedId,
      specifier,
      "invalid_export",
      "package export is not a valid runtime integration (expected createIntegration, createCursorIntegration, or default export)",
    );
  }

  if (isMarketplaceOnly(candidate)) {
    throw new ManifestIntegrationLoadError(
      expectedId,
      specifier,
      "marketplace_only",
      "marketplace-only package is not a valid runtime integration (missing detect/materialize)",
    );
  }

  if (!isRuntimeIntegration(candidate)) {
    throw new ManifestIntegrationLoadError(
      expectedId,
      specifier,
      "invalid_export",
      "invalid export: not a valid runtime BapmIntegration (need id, deployRoots, detect, materialize)",
    );
  }

  if (candidate.id !== expectedId) {
    throw new ManifestIntegrationLoadError(
      expectedId,
      specifier,
      "id_mismatch",
      `integration id "${candidate.id}" does not match map key / expected "${expectedId}"`,
    );
  }

  return candidate;
}

/** Cache dir for a cloned git integration: `<config-root>/integrations-git/<identity>`. */
function gitIntegrationCacheDir(cloneUrl: string): string {
  const identity = normalizeRepoIdentity(cloneUrl);
  return join(resolveUserConfigRoot(), "integrations-git", identityToCacheDir(identity));
}

/** Parsed git integration specifier: clone URL plus optional package subpath. */
type GitIntegrationSpec = { cloneUrl: string; subpath?: string };

/** Parse `github:owner/repo[/sub]`, `https://github.com/...`, `git+…`, `file://…`. */
function parseGitSpec(spec: string): GitIntegrationSpec {
  const clean = spec
    .trim()
    .replace(/^git\+/, "")
    .split("#")[0]!
    .split("?")[0]!
    .replace(/\/+$/, "");
  if (clean.startsWith("github:")) {
    const segs = clean.slice("github:".length).split("/").filter(Boolean);
    const cloneUrl = `https://github.com/${segs[0]}/${(segs[1] ?? "").replace(/\.git$/, "")}.git`;
    return { cloneUrl, subpath: segs.length > 2 ? segs.slice(2).join("/") : undefined };
  }
  if (/^https?:\/\/(www\.)?github\.com\//.test(clean)) {
    const segs = new URL(clean).pathname.split("/").filter(Boolean);
    const cloneUrl = `https://github.com/${segs[0]}/${(segs[1] ?? "").replace(/\.git$/, "")}.git`;
    return { cloneUrl, subpath: segs.length > 2 ? segs.slice(2).join("/") : undefined };
  }
  // git://, git@, file:// and other plain URLs: whole repo, no subpath split.
  return { cloneUrl: clean };
}

/**
 * Load an integration from a git repository (`github:owner/repo`,
 * `https://github.com/owner/repo`, `git+…`). Clones into the user config cache
 * (reused across runs), resolves the package root (repo root or an explicit
 * `/sub` suffix), installs production dependencies when the entry is not yet
 * built, and validates the module like any map value.
 */
export async function loadGitIntegration(
  specifier: string,
  expectedId: string,
): Promise<BapmIntegration> {
  const spec = parseGitSpec(specifier);
  const cloneRoot = gitIntegrationCacheDir(spec.cloneUrl);

  const downloader = createDefaultDownloader();
  if (!existsSync(join(cloneRoot, ".git"))) {
    mkdirSync(cloneRoot, { recursive: true });
    try {
      await downloader.download({
        repoUrl: spec.cloneUrl,
        dest: cloneRoot,
        identity: spec.cloneUrl,
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ManifestIntegrationLoadError(
        expectedId,
        specifier,
        "unresolvable",
        `failed to clone git integration: ${detail}`,
      );
    }
  }

  const packageRoot = spec.subpath ? join(cloneRoot, ...spec.subpath.split("/")) : cloneRoot;

  const manifestPath = join(packageRoot, "package.json");
  if (!existsSync(manifestPath)) {
    throw new ManifestIntegrationLoadError(
      expectedId,
      specifier,
      "unresolvable",
      `git integration has no package.json at ${spec.subpath ?? "(repo root)"}`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    exports?: Record<string, unknown> | string;
    main?: string;
    scripts?: Record<string, string>;
  };

  const entryRelative =
    typeof manifest.exports === "string"
      ? manifest.exports
      : typeof manifest.exports?.["."] === "string"
        ? (manifest.exports["."] as string)
        : (manifest.main ?? "./index.mjs");
  const entryPath = resolve(packageRoot, entryRelative);

  if (!existsSync(entryPath)) {
    // Entry not built yet: install production deps and run the package's own
    // build/prepare (mirrors npm git-dependency semantics).
    await installAndBuildGitIntegration(packageRoot, manifest.scripts ?? {}, expectedId, specifier);
    if (!existsSync(entryPath)) {
      throw new ManifestIntegrationLoadError(
        expectedId,
        specifier,
        "unresolvable",
        `git integration entry "${entryRelative}" is missing after build`,
      );
    }
  }

  return loadIntegrationModule(entryPath, specifier, expectedId);
}

/** Install deps + run prepare/build for a cloned integration package (best-effort, fail-closed). */
async function installAndBuildGitIntegration(
  packageRoot: string,
  scripts: Record<string, string>,
  expectedId: string,
  specifier: string,
): Promise<void> {
  const hasDeps = (() => {
    try {
      const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return (
        Boolean(pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
        Boolean(scripts.prepare || scripts.build)
      );
    } catch {
      return false;
    }
  })();
  if (!hasDeps) return;

  const run = async (cmd: string, args: string[]): Promise<void> => {
    const { spawn } = await import("node:child_process");
    await new Promise<void>((res, rej) => {
      const child = spawn(cmd, args, {
        cwd: packageRoot,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      let err = "";
      child.stderr?.on("data", (c: Buffer) => {
        err += c.toString();
      });
      child.on("error", rej);
      child.on("close", (code) =>
        code === 0
          ? res()
          : rej(new Error(`${cmd} ${args.join(" ")} failed: ${err.slice(0, 400)}`)),
      );
    });
  };

  try {
    await run("bun", ["install", "--production"]).catch(() =>
      run("npm", ["install", "--omit=dev"]),
    );
    if (scripts.prepare)
      await run("bun", ["run", "prepare"]).catch(() => run("npm", ["run", "prepare"]));
    else if (scripts.build)
      await run("bun", ["run", "build"]).catch(() => run("npm", ["run", "build"]));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ManifestIntegrationLoadError(
      expectedId,
      specifier,
      "unresolvable",
      `failed to build git integration: ${detail}`,
    );
  }
}

/**
 * Resolve a map value (npm package or local filesystem path) from project cwd,
 * import it, and extract a runtime `BapmIntegration`
 * (createIntegration → createCursorIntegration → default).
 */
export async function loadIntegrationFromPackage(
  specifier: string,
  expectedId: string,
  cwd: string,
  options: LoadIntegrationOptions = {},
): Promise<BapmIntegration> {
  if (isGitIntegrationSpecifier(specifier)) {
    return loadGitIntegration(specifier, expectedId);
  }
  let resolved: string;
  if (isLocalPathSpecifier(specifier)) {
    resolved = resolveLocalIntegrationPath(specifier, expectedId, cwd);
  } else {
    try {
      resolved = resolveNpmPackageSpecifier(specifier, cwd, {
        allowCliFallback: options.allowCliFallback,
        globalRoots: options.globalRoots,
      });
    } catch (cause) {
      const detail =
        cause instanceof Error ? cause.message : "cannot find module / unresolvable package";
      throw new ManifestIntegrationLoadError(
        expectedId,
        specifier,
        "unresolvable",
        `unresolvable module: ${detail}`,
      );
    }
  }

  return loadIntegrationModule(resolved, specifier, expectedId);
}

/**
 * `allowCliFallback` below is true only for git-run (`bunx github:owner/bapm`,
 * BAPM_GIT_RUN=1 from bin/bapm.mjs): the clone has no npm install around the CLI,
 * so canonical fallback may resolve `@b-apm/integration-<id>` from the CLI's own
 * checkout (bun honours packages/cli/tsconfig.json paths). npm/global runs keep
 * project + global roots only — workspace dev deps must not shadow canonical.
 */

/**
 * Try to resolve+register a canonical `@b-apm/integration-<id>` package.
 * Soft-fails when the package is missing or unloadable so other hosts still work.
 */
async function tryRegisterCanonicalHost(
  registry: IntegrationRegistry,
  hostId: string,
  cwd: string,
): Promise<void> {
  if (registry.get(hostId)) return;
  const specifier = canonicalPackageSpecifier(hostId);
  try {
    const integration = await loadIntegrationFromPackage(specifier, hostId, cwd, {
      allowCliFallback: process.env.BAPM_GIT_RUN === "1",
    });
    registry.register(integration);
  } catch {
    // Soft-fail: package not installed in the project / not a valid runtime integration.
  }
}

/**
 * Eagerly load object-map entries (fail-closed), then attempt canonical fallback
 * for known hosts not covered by the map. Absent/partial map ≠ empty registry.
 */
export async function registerManifestIntegrations(
  registry: IntegrationRegistry,
  manifest: BapmManifest,
  cwd: string,
): Promise<void> {
  const map = declaredTargetIntegrationMap(manifest);
  const mappedIds = new Set<string>();

  if (map) {
    for (const [hostId, specifier] of Object.entries(map)) {
      const integration = await loadIntegrationFromPackage(specifier, hostId, cwd);
      registry.register(integration);
      mappedIds.add(hostId);
    }
  }

  for (const hostId of CANONICAL_HOST_IDS) {
    if (mappedIds.has(hostId)) continue;
    await tryRegisterCanonicalHost(registry, hostId, cwd);
  }
}

/**
 * Load project manifest (when present) and register map + canonical integrations.
 * Missing manifest is a no-op; explicit map load failures propagate (fail-closed).
 */
export async function registerManifestIntegrationsFromCwd(
  registry: IntegrationRegistry,
  cwd: string,
): Promise<void> {
  let document: BapmManifest;
  try {
    ({ document } = loadManifest({ cwd }));
  } catch (error) {
    if (
      error instanceof ManifestError &&
      (error.code === "MANIFEST_NOT_FOUND" || error.code === "MANIFEST_MISSING_FILE")
    ) {
      return;
    }
    throw error;
  }
  await registerManifestIntegrations(registry, document, cwd);
}
