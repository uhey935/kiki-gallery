import assert from "node:assert/strict";
import test from "node:test";

import {
  artistsDeleteEndpoint,
  artistsDeleteFailureGuidance,
} from "./artists-delete-ui.ts";

test("Artists Delete browser contract exposes stable endpoint and fail-closed guidance", () => {
  assert.equal(artistsDeleteEndpoint, "/editor/api/artists-delete");
  assert.match(
    artistsDeleteFailureGuidance("backup-proof-stale"),
    /fresh generation/,
  );
  assert.match(
    artistsDeleteFailureGuidance("incoming-reference"),
    /incoming reference/,
  );
  assert.match(
    artistsDeleteFailureGuidance("lock-conflict"),
    /will not be stolen/,
  );
  assert.match(
    artistsDeleteFailureGuidance("rollback-failed"),
    /Stop all Editor mutation/,
  );
});
