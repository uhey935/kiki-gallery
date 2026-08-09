import assert from "node:assert/strict";
import test from "node:test";
import {
  worksDeleteEndpoint,
  worksDeleteFailureGuidance,
} from "./works-delete-ui.ts";

test("Works Delete UI exposes stable endpoint and fail-closed guidance", () => {
  assert.equal(worksDeleteEndpoint, "/editor/api/works-delete");
  assert.match(
    worksDeleteFailureGuidance("backup-proof-stale"),
    /fresh generation/,
  );
  assert.match(
    worksDeleteFailureGuidance("incoming-reference"),
    /incoming reference/,
  );
  assert.match(
    worksDeleteFailureGuidance("pending-asset-state"),
    /pending image/,
  );
  assert.match(worksDeleteFailureGuidance("lock-conflict"), /never stolen/);
  assert.match(
    worksDeleteFailureGuidance("rollback-failed"),
    /Stop all Editor mutation/,
  );
});
