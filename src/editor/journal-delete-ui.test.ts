import assert from "node:assert/strict";
import test from "node:test";

import {
  journalDeleteEndpoint,
  journalDeleteFailureGuidance,
} from "./journal-delete-ui.ts";

test("Journal Delete browser contract exposes stable endpoint and fail-closed guidance", () => {
  assert.equal(journalDeleteEndpoint, "/editor/api/journal-delete");
  assert.match(
    journalDeleteFailureGuidance("backup-proof-stale"),
    /fresh generation/,
  );
  assert.match(
    journalDeleteFailureGuidance("incoming-reference"),
    /incoming reference/,
  );
  assert.match(
    journalDeleteFailureGuidance("lock-conflict"),
    /will not be stolen/,
  );
  assert.match(
    journalDeleteFailureGuidance("rollback-failed"),
    /Stop all Editor mutation/,
  );
});
