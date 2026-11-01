import type { InitApi } from "@/modules/Init";
import type { InstallApi } from "@/modules/Install";

export async function initCommand(
  argv: string[],
  init: InitApi,
  install?: InstallApi,
): Promise<number> {
  const installRequested = argv.includes("--install");
  const initArgv = installRequested ? argv.filter((arg) => arg !== "--install") : argv;
  const showHelp = initArgv.includes("--help") || initArgv.includes("-h");
  const result = await init.run({ args: initArgv, cwd: process.cwd() });
  if (!result.ok) return 1;
  if (!installRequested || showHelp || !install) return 0;
  // The fresh scaffold has no lockfile, so the chained first install cannot be frozen.
  const installed = await install.run({ args: ["--no-frozen"], cwd: process.cwd() });
  return installed.ok ? 0 : 1;
}
