import assert from "node:assert/strict";
import test from "node:test";

import {
  exhibitionsDeleteEndpoint,
  exhibitionsDeleteFailureGuidance,
} from "./exhibitions-delete-ui.ts";

test("Exhibitions Delete browser contract exposes stable endpoint and fail-closed guidance", () => {
  assert.equal(exhibitionsDeleteEndpoint, "/editor/api/exhibitions-delete");
  assert.match(
    exhibitionsDeleteFailureGuidance("backup-proof-stale"),
    /fresh generation/,
  );
  assert.match(
    exhibitionsDeleteFailureGuidance("incoming-reference"),
    /incoming reference/,
  );
  assert.match(
    exhibitionsDeleteFailureGuidance("lock-conflict"),
    /will not be stolen/,
  );
  assert.match(
    exhibitionsDeleteFailureGuidance("rollback-failed"),
    /Stop all Editor mutation/,
  );
});
