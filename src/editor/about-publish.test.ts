import assert from "node:assert/strict";
import { execFile as callback } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createAboutEditorDraft } from "./about-draft-state.ts";
import { AboutPublishEvidenceStore } from "./about-publish-evidence.ts";
import {
  AboutPublishError,
  publishSavedAboutEntry,
  retryAboutPublish,
} from "./about-publish.ts";
import { readAboutEditorEntry } from "./about-state.ts";

const execFile = promisify(callback);
async function git(root: string, ...args: string[]) {
  const { stdout } = await execFile("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  return stdout.trim();
}
const runner =
  (root: string, failPush = { value: false }) =>
  async (args: string[], binary = false) => {
    if (args[0] === "push" && failPush.value)
      throw new Error("injected push failure");
    const result = await execFile("git", args, {
      cwd: root,
      encoding: binary ? null : "utf8",
    });
    return binary
      ? Buffer.from(result.stdout as Buffer)
      : String(result.stdout).trim();
  };

async function repository(
  run: (root: string, remote: string) => Promise<void>,
) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "about-publish-"));
  const root = path.join(temporary, "work"),
    remote = path.join(temporary, "remote.git");
  try {
    await fs.mkdir(path.join(root, "src/content/about"), { recursive: true });
    await fs.cp(
      path.resolve("src/content/about/about"),
      path.join(root, "src/content/about/about"),
      { recursive: true },
    );
    await fs.mkdir(path.join(root, "public/images/about"), { recursive: true });
    for (const name of [
      "about-hero.jpg",
      "about-01.jpg",
      "about-02.jpg",
      "about-03.jpg",
      "about-04.jpg",
    ])
      await fs.copyFile(
        path.resolve("public/images/about", name),
        path.join(root, "public/images/about", name),
      );
    await fs.writeFile(path.join(root, "unrelated.txt"), "initial\n");
    await git(root, "init", "-b", "main");
    await git(root, "config", "user.name", "About Test");
    await git(root, "config", "user.email", "about@example.test");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "Initial");
    await git(temporary, "init", "--bare", remote);
    await git(root, "remote", "add", "origin", remote);
    await git(root, "push", "-u", "origin", "main");
    await run(root, remote);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
async function baseline(root: string) {
  return createAboutEditorDraft(
    await readAboutEditorEntry(path.join(root, "src/content/about")),
  );
}
async function changeJa(root: string) {
  await fs.appendFile(
    path.join(root, "src/content/about/about/ja.md"),
    "\nAbout publish test\n",
  );
  return baseline(root);
}

test("synced Publish commits exact About subset and leaves unrelated unstaged", async () => {
  await repository(async (root, remote) => {
    const draft = await changeJa(root);
    await fs.writeFile(path.join(root, "unrelated.txt"), "unstaged\n");
    const result = await publishSavedAboutEntry(
      draft,
      draft,
      false,
      root,
      path.join(root, "src/content/about"),
    );
    assert.equal(result.state, "published");
    assert.equal(
      await git(remote, "rev-parse", "refs/heads/main"),
      result.commit,
    );
    assert.equal(
      await git(root, "show", "--format=", "--name-only", "HEAD"),
      "src/content/about/about/ja.md",
    );
    assert.equal(await git(root, "status", "--short"), "M unrelated.txt");
    assert.equal(await new AboutPublishEvidenceStore(root).read(), undefined);
  });
});

test("ahead, behind, missing upstream, detached HEAD, and pre-staged changes fail closed", async (t) => {
  for (const kind of [
    "ahead",
    "behind",
    "missing-upstream",
    "detached",
    "staged",
  ] as const)
    await t.test(kind, async () =>
      repository(async (root, remote) => {
        if (kind === "ahead") {
          await fs.writeFile(path.join(root, "ahead.txt"), "x");
          await git(root, "add", "ahead.txt");
          await git(root, "commit", "-m", "Ahead");
        }
        if (kind === "behind") {
          const clone = path.join(path.dirname(root), "other");
          await git(path.dirname(root), "clone", remote, clone);
          await git(clone, "config", "user.name", "Other");
          await git(clone, "config", "user.email", "other@example.test");
          await fs.writeFile(path.join(clone, "remote.txt"), "x");
          await git(clone, "add", ".");
          await git(clone, "commit", "-m", "Remote");
          await git(clone, "push");
        }
        if (kind === "missing-upstream")
          await git(root, "branch", "--unset-upstream");
        if (kind === "detached") await git(root, "checkout", "--detach");
        if (kind === "staged") {
          await fs.writeFile(path.join(root, "unrelated.txt"), "staged\n");
          await git(root, "add", "unrelated.txt");
        }
        const draft = await changeJa(root),
          before = await git(root, "rev-parse", "HEAD");
        await assert.rejects(
          publishSavedAboutEntry(
            draft,
            draft,
            false,
            root,
            path.join(root, "src/content/about"),
          ),
          (error: unknown) =>
            error instanceof AboutPublishError &&
            error.code === "unsafe-repository",
        );
        assert.equal(await git(root, "rev-parse", "HEAD"), before);
      }),
    );
});

test("wrong upstream, divergence, fetch failure, and branch drift fail closed", async (t) => {
  for (const kind of [
    "wrong-upstream",
    "diverged",
    "fetch",
    "branch-drift",
  ] as const)
    await t.test(kind, async () =>
      repository(async (root, remote) => {
        if (kind === "wrong-upstream") {
          await git(root, "push", "origin", "HEAD:other");
          await git(
            root,
            "branch",
            "--set-upstream-to",
            "origin/other",
            "main",
          );
        }
        if (kind === "diverged") {
          const clone = path.join(path.dirname(root), "diverged-other");
          await git(path.dirname(root), "clone", remote, clone);
          await git(clone, "config", "user.name", "Other");
          await git(clone, "config", "user.email", "other@example.test");
          await fs.writeFile(path.join(clone, "remote-diverged.txt"), "x");
          await git(clone, "add", ".");
          await git(clone, "commit", "-m", "Remote diverged");
          await git(clone, "push");
          await fs.writeFile(path.join(root, "local-diverged.txt"), "x");
          await git(root, "add", ".");
          await git(root, "commit", "-m", "Local diverged");
        }
        const draft = await changeJa(root);
        const base = runner(root);
        const failingFetch = async (args: string[], binary = false) => {
          if (kind === "fetch" && args[0] === "fetch")
            throw new Error("injected fetch failure");
          return base(args, binary);
        };
        await assert.rejects(
          publishSavedAboutEntry(
            draft,
            draft,
            false,
            root,
            path.join(root, "src/content/about"),
            {
              git: failingFetch,
              hook: async (point) => {
                if (kind === "branch-drift" && point === "after-validation")
                  await git(root, "checkout", "-b", "switched");
              },
            },
          ),
          (error: unknown) =>
            error instanceof AboutPublishError &&
            error.code === "unsafe-repository",
        );
        assert.equal(
          await new AboutPublishEvidenceStore(root).read(),
          undefined,
        );
      }),
    );
});

test("canonical and HEAD races fail before commit", async (t) => {
  for (const kind of ["canonical", "head"] as const)
    await t.test(kind, async () =>
      repository(async (root) => {
        const draft = await changeJa(root),
          starting = await git(root, "rev-parse", "HEAD");
        await assert.rejects(
          publishSavedAboutEntry(
            draft,
            draft,
            false,
            root,
            path.join(root, "src/content/about"),
            {
              hook: async (point) => {
                if (point !== "after-validation") return;
                if (kind === "canonical")
                  await fs.appendFile(
                    path.join(root, "src/content/about/about/en.md"),
                    "\nrace\n",
                  );
                else {
                  await fs.writeFile(path.join(root, "race.txt"), "x");
                  await git(root, "add", "race.txt");
                  await git(root, "commit", "-m", "Race");
                }
              },
            },
          ),
          AboutPublishError,
        );
        assert.notEqual(
          kind === "head" ? await git(root, "rev-parse", "HEAD") : starting,
          "",
        );
        assert.equal(
          await new AboutPublishEvidenceStore(root).read(),
          undefined,
        );
      }),
    );
});

test("push failure records exact commit and retry creates no commit", async () => {
  await repository(async (root, remote) => {
    const draft = await changeJa(root),
      failure = { value: true };
    const result = await publishSavedAboutEntry(
      draft,
      draft,
      false,
      root,
      path.join(root, "src/content/about"),
      { git: runner(root, failure) },
    );
    assert.equal(result.state, "committed-push-failed");
    const evidence = await new AboutPublishEvidenceStore(root).read();
    assert.equal(evidence?.state, "committed-push-failed");
    assert.equal(evidence?.commit, result.commit);
    const before = await git(root, "rev-list", "--count", "HEAD");
    failure.value = false;
    const retried = await retryAboutPublish(root, {
      git: runner(root, failure),
    });
    assert.equal(retried.state, "published");
    assert.equal(await git(root, "rev-list", "--count", "HEAD"), before);
    assert.equal(
      await git(remote, "rev-parse", "refs/heads/main"),
      result.commit,
    );
    assert.equal(await new AboutPublishEvidenceStore(root).read(), undefined);
  });
});

test("retry rejects a later unrelated local commit and preserves evidence", async () => {
  await repository(async (root) => {
    const draft = await changeJa(root),
      failure = { value: true };
    const result = await publishSavedAboutEntry(
      draft,
      draft,
      false,
      root,
      path.join(root, "src/content/about"),
      { git: runner(root, failure) },
    );
    assert.equal(result.state, "committed-push-failed");
    await fs.writeFile(path.join(root, "later.txt"), "later\n");
    await git(root, "add", "later.txt");
    await git(root, "commit", "-m", "Later unrelated");
    failure.value = false;
    const retried = await retryAboutPublish(root, {
      git: runner(root, failure),
    });
    assert.equal(retried.state, "committed-push-failed");
    assert.match(retried.error, /later local commit/);
    assert(await new AboutPublishEvidenceStore(root).read());
  });
});

test("malformed evidence blocks normal Publish and retry", async () => {
  await repository(async (root) => {
    const file = path.join(
      root,
      ".kiki-editor/publish-evidence/about/about.v1.json",
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{broken");
    const draft = await changeJa(root);
    await assert.rejects(
      publishSavedAboutEntry(
        draft,
        draft,
        false,
        root,
        path.join(root, "src/content/about"),
      ),
    );
    await assert.rejects(retryAboutPublish(root));
  });
});

test("missing referenced asset and staged blob mismatch fail closed", async (t) => {
  await t.test("asset", async () =>
    repository(async (root) => {
      const draft = await changeJa(root);
      await fs.rm(path.join(root, "public/images/about/about-hero.jpg"));
      await assert.rejects(
        publishSavedAboutEntry(
          draft,
          draft,
          false,
          root,
          path.join(root, "src/content/about"),
        ),
        (error: unknown) =>
          error instanceof AboutPublishError &&
          error.code === "canonical-mismatch",
      );
      assert.equal(await new AboutPublishEvidenceStore(root).read(), undefined);
    }),
  );
  await t.test("staged blob", async () =>
    repository(async (root) => {
      const draft = await changeJa(root);
      await assert.rejects(
        publishSavedAboutEntry(
          draft,
          draft,
          false,
          root,
          path.join(root, "src/content/about"),
          {
            hook: async (point) => {
              if (point === "after-add") {
                await fs.appendFile(
                  path.join(root, "src/content/about/about/ja.md"),
                  "changed after add\n",
                );
                await git(root, "add", "src/content/about/about/ja.md");
              }
            },
          },
        ),
        (error: unknown) =>
          error instanceof AboutPublishError &&
          error.code === "publish-set-mismatch",
      );
      assert.equal(await git(root, "rev-list", "--count", "HEAD"), "1");
    }),
  );
});

test("missing, extra, and symlinked canonical topology fail before Git mutation", async (t) => {
  for (const kind of ["missing", "extra", "symlink"] as const)
    await t.test(kind, async () =>
      repository(async (root) => {
        const draft = await changeJa(root),
          unit = path.join(root, "src/content/about/about");
        if (kind === "missing") await fs.rm(path.join(unit, "en.md"));
        if (kind === "extra")
          await fs.writeFile(path.join(unit, "extra.md"), "x");
        if (kind === "symlink") {
          const target = path.join(unit, "en-source.md");
          await fs.rename(path.join(unit, "en.md"), target);
          await fs.symlink(target, path.join(unit, "en.md"));
        }
        const before = await git(root, "rev-parse", "HEAD");
        await assert.rejects(
          publishSavedAboutEntry(
            draft,
            draft,
            false,
            root,
            path.join(root, "src/content/about"),
          ),
          (error: unknown) =>
            error instanceof AboutPublishError &&
            error.code === "canonical-mismatch",
        );
        assert.equal(await git(root, "rev-parse", "HEAD"), before);
        assert.equal(
          await new AboutPublishEvidenceStore(root).read(),
          undefined,
        );
      }),
    );
});

test("commit and post-commit evidence failures remain fail closed", async (t) => {
  await t.test("commit failure leaves pending recovery", async () =>
    repository(async (root) => {
      const draft = await changeJa(root),
        base = runner(root);
      const failing = async (args: string[], binary = false) => {
        if (args[0] === "commit-tree")
          throw new Error("injected commit failure");
        return base(args, binary);
      };
      await assert.rejects(
        publishSavedAboutEntry(
          draft,
          draft,
          false,
          root,
          path.join(root, "src/content/about"),
          { git: failing },
        ),
      );
      assert.equal(
        (await new AboutPublishEvidenceStore(root).read())?.state,
        "pending",
      );
    }),
  );
  await t.test(
    "evidence finalization failure preserves pending identity",
    async () =>
      repository(async (root) => {
        const draft = await changeJa(root),
          real = new AboutPublishEvidenceStore(root);
        let writes = 0;
        const evidence = {
          read: () => real.read(),
          write: async (
            value: Parameters<AboutPublishEvidenceStore["write"]>[0],
          ) => {
            if (++writes === 2) throw new Error("injected evidence failure");
            return real.write(value);
          },
          delete: () => real.delete(),
        } as unknown as AboutPublishEvidenceStore;
        await assert.rejects(
          publishSavedAboutEntry(
            draft,
            draft,
            false,
            root,
            path.join(root, "src/content/about"),
            { evidence },
          ),
          (error: unknown) =>
            error instanceof AboutPublishError &&
            error.code === "recovery-required",
        );
        assert.equal((await real.read())?.state, "pending");
        assert.equal(await git(root, "rev-list", "--count", "HEAD"), "2");
      }),
  );
});

test("cleanup failure never reports Published and retry reconciles remote", async () => {
  await repository(async (root) => {
    const draft = await changeJa(root),
      real = new AboutPublishEvidenceStore(root);
    const evidence = {
      read: () => real.read(),
      write: (value: Parameters<AboutPublishEvidenceStore["write"]>[0]) =>
        real.write(value),
      delete: async () => {
        throw new Error("injected cleanup failure");
      },
    } as unknown as AboutPublishEvidenceStore;
    const result = await publishSavedAboutEntry(
      draft,
      draft,
      false,
      root,
      path.join(root, "src/content/about"),
      { evidence },
    );
    assert.equal(result.state, "published-evidence-cleanup-failed");
    assert(await real.read());
    const retried = await retryAboutPublish(root);
    assert.equal(retried.state, "published");
    assert.equal(await real.read(), undefined);
  });
});

test("About UI distinguishes Published from incomplete push and exposes retry", async () => {
  const source = await fs.readFile(
    "src/pages/editor/about/workspace/[contentId].astro",
    "utf8",
  );
  assert.match(source, /result\.state === "published"/);
  assert.match(
    source,
    /Commit succeeded \(\$\{result\.commit\}\); push failed; publication incomplete/,
  );
  assert.match(source, /data-retry-about/);
  assert.match(source, /action: "retry"/);
});
