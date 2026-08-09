import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const sourceRoot = process.cwd();
const sandboxRoot = await mkdtemp(path.join(tmpdir(), "kiki-browser-"));
const repositoryRoot = path.join(sandboxRoot, "repository");
const remoteRoot = path.join(sandboxRoot, "remote.git");
const port = "4322";
let server;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/editor/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the isolated Editor server");
}

try {
  run("git", ["clone", "--no-hardlinks", sourceRoot, repositoryRoot]);
  run("git", ["init", "--bare", remoteRoot]);
  run("git", ["remote", "set-url", "origin", remoteRoot], {
    cwd: repositoryRoot,
  });
  run("git", ["push", "-u", "origin", "main"], { cwd: repositoryRoot });
  await symlink(
    path.join(sourceRoot, "node_modules"),
    path.join(repositoryRoot, "node_modules"),
  );

  server = spawn(
    process.execPath,
    [
      path.join(sourceRoot, "node_modules/astro/bin/astro.mjs"),
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      port,
    ],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  await waitForServer();

  run(
    process.execPath,
    [
      path.join(sourceRoot, "node_modules/@playwright/test/cli.js"),
      "test",
      "--config",
      path.join(sourceRoot, "playwright.config.ts"),
    ],
    {
      cwd: sourceRoot,
      env: {
        ...process.env,
        KIKI_BROWSER_BASE_URL: `http://127.0.0.1:${port}`,
        KIKI_BROWSER_REPOSITORY: repositoryRoot,
      },
    },
  );
} finally {
  server?.kill("SIGTERM");
  await rm(sandboxRoot, { recursive: true, force: true });
}
