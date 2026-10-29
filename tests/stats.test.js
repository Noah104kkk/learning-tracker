"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../stats.js");

const TODAY = new Date(2026, 9, 29); // 2026-10-29（ローカル）
const day = (n) => S.ymd(S.addDays(TODAY, n));

test("percent: 完了数の割合を四捨五入する", () => {
  assert.equal(S.percent([]), 0);
  assert.equal(S.percent([{ status: "done" }, { status: "todo" }, { status: "doing" }]), 33);
  assert.equal(S.percent([{ status: "done" }]), 100);
});

test("weekMinutes: 直近7日を古い順に返し、同じ日は合算する", () => {
  const sessions = [
    { date: day(0), minutes: 25 },
    { date: day(0), minutes: 30 },
    { date: day(-6), minutes: 10 },
    { date: day(-7), minutes: 999 }, // 範囲外
  ];
  const week = S.weekMinutes(sessions, TODAY);
  assert.equal(week.length, 7);
  assert.equal(week[0].date, day(-6));
  assert.equal(week[0].minutes, 10);
  assert.equal(week[6].minutes, 55);
});

test("streak: 連続日数を数える（今日が未学習なら昨日から）", () => {
  const s = (...offsets) => offsets.map((o) => ({ date: day(o), minutes: 20 }));
  assert.equal(S.streak([], TODAY), 0);
  assert.equal(S.streak(s(0, -1, -2), TODAY), 3);
  assert.equal(S.streak(s(-1, -2), TODAY), 2);
  assert.equal(S.streak(s(0, -2), TODAY), 1);
  assert.equal(S.streak(s(-2, -3), TODAY), 0);
});

test("heatmap: 今日で終わり、未来のマスを含まず、日曜始まり", () => {
  const cells = S.heatmap([{ date: day(0), minutes: 130 }], TODAY, 12);
  assert.equal(cells[cells.length - 1].date, day(0));
  assert.equal(cells[cells.length - 1].level, 4);
  assert.equal(S.parse(cells[0].date).getDay(), 0);
  assert.ok(cells.length > 77 && cells.length <= 84);
});

test("level: 学習量の段階", () => {
  assert.deepEqual([0, 1, 29, 30, 59, 60, 119, 120].map(S.level), [0, 1, 1, 2, 2, 3, 3, 4]);
});

test("forecast: 完了・ペース不明", () => {
  assert.equal(S.forecast({ units: [{ status: "done" }] }, TODAY).state, "complete");
  assert.equal(S.forecast({ units: [{ status: "todo" }] }, TODAY).state, "unknown");
});

function course(target, doneCount, remaining) {
  const units = [];
  for (let i = 0; i < doneCount; i++) units.push({ status: "done", doneAt: day(-(i % 14)), due: "" });
  for (let i = 0; i < remaining; i++) units.push({ status: "todo", due: "" });
  return { target, units };
}

test("forecast: 目標に間に合う見込みは ontrack", () => {
  // 14日で7件完了 → 0.5件/日、残り4件 → 8日後
  const f = S.forecast(course(day(20), 7, 4), TODAY);
  assert.equal(f.state, "ontrack");
  assert.equal(f.finish, day(8));
});

test("forecast: 間に合わない見込みは behind（遅れ日数と必要ペースを返す）", () => {
  const f = S.forecast(course(day(5), 7, 4), TODAY);
  assert.equal(f.state, "behind");
  assert.equal(f.delayDays, 3);
  assert.ok(Math.abs(f.requiredPerDay - 0.8) < 1e-9);
});

test("forecast: 目標がなければ締切の最終日を使い、それも無ければ noTarget", () => {
  const withDue = course("", 7, 4);
  withDue.units[withDue.units.length - 1].due = day(30);
  assert.equal(S.forecast(withDue, TODAY).state, "ontrack");
  assert.equal(S.forecast(course("", 7, 4), TODAY).state, "noTarget");
});
