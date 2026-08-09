import assert from "node:assert/strict";
import test from "node:test";

import {
  newsDeleteEndpoint,
  newsDeleteFailureGuidance,
} from "./news-delete-ui.ts";

test("News Delete browser contract exposes stable endpoint and fail-closed guidance", () => {
  assert.equal(newsDeleteEndpoint, "/editor/api/news-delete");
  assert.match(
    newsDeleteFailureGuidance("backup-proof-stale"),
    /fresh generation/,
  );
  assert.match(
    newsDeleteFailureGuidance("incoming-reference"),
    /incoming reference/,
  );
  assert.match(
    newsDeleteFailureGuidance("lock-conflict"),
    /will not be stolen/,
  );
  assert.match(
    newsDeleteFailureGuidance("rollback-failed"),
    /Stop all Editor mutation/,
  );
});
