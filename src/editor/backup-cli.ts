import path from "node:path";

import {
  createBackup,
  restoreBackup,
  verifyBackup,
} from "./backup-recovery.ts";

const [command, location, ...flags] = process.argv.slice(2);
const usage = () => {
  console.error(
    "Usage: npm run backup -- <create|verify|restore> <backup-directory> [--include-canonical]",
  );
  process.exitCode = 2;
};

if (!command || !location || !["create", "verify", "restore"].includes(command))
  usage();
else {
  const repositoryRoot = process.cwd();
  const backupRoot = path.resolve(location);
  try {
    if (command === "create") {
      const result = await createBackup({
        repositoryRoot,
        destination: backupRoot,
      });
      console.log(
        `Created backup ${result.backupId} with ${result.files.length} files at ${backupRoot}; run verify after copying it to storage`,
      );
    } else if (command === "verify") {
      const result = await verifyBackup(backupRoot);
      console.log(
        `Verified backup ${result.backupId}: ${result.files.length} files`,
      );
    } else {
      const result = await restoreBackup({
        repositoryRoot,
        backupRoot,
        includeCanonical: flags.includes("--include-canonical"),
      });
      console.log(
        `Restored ${result.restoredRoots.join(", ")} from ${result.manifest.backupId}${result.skippedCapturedLock ? "; captured lock was not restored" : ""}`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
