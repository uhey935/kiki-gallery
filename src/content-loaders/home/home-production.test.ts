import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createHomeFacade } from "./facade.ts";
import { loadHomeUnit } from "./repository.ts";

const homeDirectory = path.resolve(
  import.meta.dirname,
  "../../content/home/home",
);

test("current Home exposes symmetric formal locale projections", async () => {
  const unit = await loadHomeUnit(homeDirectory);
  const facade = createHomeFacade(
    unit,
    {
      ja: { artists: true, about: true },
      en: { artists: true, about: true },
    },
    true,
  );
  const ja = facade.formal("ja");
  const en = facade.formal("en");
  assert(ja);
  assert(en);
  assert.equal(
    ja?.data.about_intro,
    "KiKi Galleryは、現代美術を中心に紹介するアートギャラリーです。",
  );
  assert.doesNotMatch(String(ja?.data.about_intro), /__TODO_/);
  assert.equal(
    en.data.about_intro,
    "White Porcelain Chrysanthemum-shaped Dish",
  );
  assert.equal("copyStatus" in ja, false);
  assert.equal("copyStatus" in en, false);
});
