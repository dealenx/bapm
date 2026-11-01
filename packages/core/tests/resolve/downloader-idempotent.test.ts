/**
 * createDefaultDownloader must be idempotent for an already-cloned dest.
 *
 * resolveGit clones the dest first to read the child manifest (transitive
 * discovery), then downloadPackages enters download() again with the same
 * dest — a second `git clone` used to fail on the non-empty destination
 * ("Failed to download <repoUrl>").
 */
import { afterEach, describe, expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultDownloader } from "@b-apm/core";

type Origin = {
  url: string;
  root: string;
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createOrigin(): Origin {
  const root = mkdtempSync(join(tmpdir(), "bapm-downloader-origin-"));
  const url = join(root, "origin");
  mkdirSync(url, { recursive: true });
  git(url, "init", "-q");
  git(url, "config", "user.email", "bapm@example.com");
  git(url, "config", "user.name", "bapm");
  writeFileSync(join(url, "apm.yml"), "name: fixture\nversion: 1.0.0\n");
  git(url, "add", "-A");
  git(url, "commit", "-qm", "first");
  return { url, root };
}

/** Advance the origin after the first clone so its objects are absent in the cache. */
function advanceOrigin(origin: Origin, version: string): string {
  writeFileSync(join(origin.url, "apm.yml"), `name: fixture\nversion: ${version}\n`);
  git(origin.url, "commit", "-qam", `version ${version}`);
  return git(origin.url, "rev-parse", "HEAD");
}

describe("createDefaultDownloader reuse of an existing clone", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function setup(): { origin: Origin; dest: string; firstCommit: string } {
    const origin = createOrigin();
    cleanup = () => rmSync(origin.root, { recursive: true, force: true });
    const dest = join(origin.root, "cache", "dest");
    return { origin, dest, firstCommit: git(origin.url, "rev-parse", "HEAD") };
  }

  test("second download into the same dest does not throw (double-clone regression)", async () => {
    const { origin, dest, firstCommit } = setup();
    const downloader = createDefaultDownloader();

    await downloader.download({
      repoUrl: origin.url,
      commit: firstCommit,
      dest,
      identity: "fixture",
    });
    // resolveAndLock/downloadPackages re-enters here after resolveGit's peek clone.
    await downloader.download({
      repoUrl: origin.url,
      commit: firstCommit,
      dest,
      identity: "fixture",
    });

    const manifest = readFileSync(join(dest, "apm.yml"), "utf8");
    expect(manifest).toMatch(/version: 1\.0\.0/);
  });

  test("reused clone fetches when the pinned commit is absent", async () => {
    const { origin, dest, firstCommit } = setup();
    const downloader = createDefaultDownloader();

    await downloader.download({
      repoUrl: origin.url,
      commit: firstCommit,
      dest,
      identity: "fixture",
    });
    // New upstream commit: the cache clone predates it, so checkout needs a fetch.
    const laterCommit = advanceOrigin(origin, "2.0.0");
    await downloader.download({
      repoUrl: origin.url,
      commit: laterCommit,
      dest,
      identity: "fixture",
    });

    const manifest = readFileSync(join(dest, "apm.yml"), "utf8");
    expect(manifest).toMatch(/version: 2\.0\.0/);
  });

  test("no-commit download on a reused clone refreshes to the remote tip", async () => {
    const { origin, dest } = setup();
    const downloader = createDefaultDownloader();

    await downloader.download({ repoUrl: origin.url, dest, identity: "fixture" });
    advanceOrigin(origin, "3.0.0");
    // The reused clone must move to the new remote tip like a fresh clone would.
    await downloader.download({ repoUrl: origin.url, dest, identity: "fixture" });

    const manifest = readFileSync(join(dest, "apm.yml"), "utf8");
    expect(manifest).toMatch(/version: 3\.0\.0/);
  });
});
