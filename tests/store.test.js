"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../store.js");

test("sanitize: 形式が違う入力は null", () => {
  for (const bad of [null, undefined, 1, "x", [], {}, { courses: "x" }]) {
    assert.equal(Store.sanitize(bad), null);
  }
});

test("sanitize: 制御文字の除去・長さ制限・空名の除外", () => {
  const data = Store.sanitize({
    courses: [
      { name: "  A\u0000B\n  ", units: [{ title: "x".repeat(500), status: "done", doneAt: "2026-10-01" }] },
      { name: "   ", units: [] },
    ],
  });
  assert.equal(data.courses.length, 1);
  assert.equal(data.courses[0].name, "AB");
  assert.equal(data.courses[0].units[0].title.length, Store.LIMITS.title);
});

test("sanitize: 不正な状態・存在しない日付は安全な値に直す", () => {
  const data = Store.sanitize({
    courses: [{ name: "C", target: "2026-02-31", units: [
      { title: "a", status: "__proto__", due: "2026-13-01" },
      { title: "b", status: "constructor" },
      { title: "c", status: "todo", doneAt: "2026-10-01" },
    ] }],
  });
  const [a, b, c] = data.courses[0].units;
  assert.equal(data.courses[0].target, "");
  assert.equal(a.status, "todo");
  assert.equal(a.due, "");
  assert.equal(b.status, "todo");
  assert.equal(c.doneAt, "", "完了でない項目に doneAt は残さない");
});

test("sanitize: 件数の上限を超える分は切り捨てる", () => {
  const courses = Array.from({ length: 80 }, (_, i) => ({ name: "c" + i, units: [] }));
  assert.equal(Store.sanitize({ courses }).courses.length, Store.LIMITS.courses);
  const units = Array.from({ length: 300 }, (_, i) => ({ title: "u" + i }));
  assert.equal(Store.sanitize({ courses: [{ name: "c", units }] }).courses[0].units.length, Store.LIMITS.units);
});

test("sanitize: 学習ログの検証（分数・日付・存在しない講座ID）", () => {
  const data = Store.sanitize({
    courses: [{ id: "course-1", name: "c", units: [] }],
    sessions: [
      { date: "2026-10-01", minutes: 30, courseId: "course-1" },
      { date: "2026-10-01", minutes: 0 },
      { date: "2026-10-01", minutes: 5000 },
      { date: "bad", minutes: 10 },
      { date: "2026-10-02", minutes: "45", courseId: "nope" },
      null,
    ],
  });
  assert.equal(data.sessions.length, 2);
  assert.equal(data.sessions[0].courseId, "course-1");
  assert.equal(data.sessions[1].minutes, 45);
  assert.equal(data.sessions[1].courseId, "");
});

test("sanitize: 講座IDの重複と不正なIDは振り直す", () => {
  const data = Store.sanitize({ courses: [
    { id: "same", name: "a", units: [] },
    { id: "same", name: "b", units: [] },
    { id: "<script>", name: "c", units: [] },
  ] });
  const ids = data.courses.map((c) => c.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.every((id) => /^[A-Za-z0-9-]{1,64}$/.test(id)));
});

test("sanitize: v1形式（sessions なし）も読み込める", () => {
  const data = Store.sanitize({ version: 1, courses: [{ name: "旧", units: [{ title: "第1回", status: "done" }] }] });
  assert.equal(data.version, 2);
  assert.deepEqual(data.sessions, []);
});

test("buildUnits: オンデマンド講座型は 視聴+課題 ×回数 と 最終課題・アンケート", () => {
  const titles = Store.buildUnits("ondemand", 2).map((u) => u.title);
  assert.deepEqual(titles, ["第1回 視聴", "第1回 課題", "第2回 視聴", "第2回 課題", "最終課題", "アンケート提出"]);
  assert.deepEqual(Store.buildUnits("simple", 2).map((u) => u.title), ["第1回", "第2回"]);
});
