import { assertAboutTopology, loadAboutUnit } from "./repository.ts";

export async function loadAboutSingleton(root: string) {
  return loadAboutUnit(await assertAboutTopology(root));
}
