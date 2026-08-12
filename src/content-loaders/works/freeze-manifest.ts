import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createWorkMigrationManifest,
  serializeWorkMigrationManifest,
  worksSha256,
} from "./migration-manifest.ts";
const manifest = await createWorkMigrationManifest(
  path.resolve("src/content/works"),
);
const serialized = serializeWorkMigrationManifest(manifest);
const output = process.argv[2];
if (output)
  await fs.writeFile(path.resolve(output), serialized, { flag: "wx" });
else process.stdout.write(serialized);
process.stderr.write(`sha256 ${worksSha256(serialized)}\n`);
