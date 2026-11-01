/**
 * Parse a `--target` flag value into a host id plus an optional package specifier.
 *
 * Accepted forms:
 *   cursor                            → host id (canonical package lookup, as before)
 *   @b-apm/integration-cursor         → id derived from the canonical prefix
 *   x-acme=@acme/my-integration       → explicit id + package (npm name or local path)
 *
 * A bare package name without `id=` has no unambiguous host id and is rejected
 * with guidance rather than guessed.
 */
export type TargetSpec = {
  id: string;
  specifier?: string;
  error?: string;
};

const CANONICAL_PREFIX = "@b-apm/integration-";

export function parseTargetSpec(value: string): TargetSpec {
  const raw = value.trim();
  if (!raw) {
    return {
      id: "",
      error: "Missing --target value (expected <id>, <package>, or <id>=<package>)",
    };
  }

  const eq = raw.indexOf("=");
  if (eq !== -1) {
    const id = raw.slice(0, eq).trim();
    const specifier = raw.slice(eq + 1).trim();
    if (!id) {
      return {
        id: "",
        error: `--target: missing host id before "=" in "${raw}" (expected id=package)`,
      };
    }
    if (!specifier) {
      return { id, error: `--target: missing package after "=" in "${raw}" (expected id=package)` };
    }
    return { id, specifier };
  }

  if (raw.startsWith(CANONICAL_PREFIX)) {
    const id = raw.slice(CANONICAL_PREFIX.length);
    if (!id || id.includes("/")) {
      return {
        id: "",
        error: `--target: cannot derive a host id from "${raw}" (expected ${CANONICAL_PREFIX}<id>)`,
      };
    }
    return { id, specifier: raw };
  }

  if (raw.includes("/")) {
    return {
      id: "",
      error: `--target: "${raw}" is a package name; pass it as id=${raw} or use a host id (e.g. cursor)`,
    };
  }

  return { id: raw };
}
