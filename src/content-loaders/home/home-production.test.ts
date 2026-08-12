import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createHomeFacade } from "./facade.ts";
import { loadHomeUnit } from "./repository.ts";

const homeDirectory = path.resolve(
  import.meta.dirname,
  "../../content/home/home",
);

test("migrated Home exposes only the explicit JA development projection", async () => {
  const unit = await loadHomeUnit(homeDirectory);
  const facade = createHomeFacade(
    unit,
    {
      ja: { artists: true, about: true },
      en: { artists: true, about: false },
    },
    true,
  );
  assert.equal(facade.formal("ja"), undefined);
  assert.equal(facade.formal("en"), undefined);
  const ja = facade.developmentJa();
  assert.equal(ja?.copyStatus, "temporary");
  assert.equal(
    ja?.data.about_intro,
    "KiKi Galleryは、現代美術を中心に紹介するアートギャラリーです。",
  );
  assert.doesNotMatch(String(ja?.data.about_intro), /__TODO_/);
});
