import assert from "node:assert/strict";
import test from "node:test";
import {
  formatExhibitionClosedWeekdays,
  formatExhibitionOpeningHours,
} from "./exhibition-schedule.ts";

test("formats Exhibition opening hours identically for presentation", () => {
  assert.equal(
    formatExhibitionOpeningHours({ opens: "13:00", closes: "17:00" }),
    "13:00–17:00",
  );
});

test("formats zero through three closed weekdays for JA and EN", () => {
  assert.equal(formatExhibitionClosedWeekdays([], "ja"), "");
  assert.equal(formatExhibitionClosedWeekdays([], "en"), "");
  assert.equal(formatExhibitionClosedWeekdays(["wed"], "ja"), "水曜");
  assert.equal(formatExhibitionClosedWeekdays(["wed"], "en"), "Wednesday");
  assert.equal(
    formatExhibitionClosedWeekdays(["wed", "thu"], "ja"),
    "水曜・木曜",
  );
  assert.equal(
    formatExhibitionClosedWeekdays(["wed", "thu"], "en"),
    "Wednesday and Thursday",
  );
  assert.equal(
    formatExhibitionClosedWeekdays(["mon", "wed", "fri"], "ja"),
    "月曜・水曜・金曜",
  );
  assert.equal(
    formatExhibitionClosedWeekdays(["mon", "wed", "fri"], "en"),
    "Monday, Wednesday, and Friday",
  );
  assert.equal(
    formatExhibitionClosedWeekdays(["fri", "mon", "wed"], "en"),
    "Monday, Wednesday, and Friday",
  );
});
