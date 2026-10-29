"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../planner.js");
const S = require("../stats.js");

const TODAY = new Date(2026, 9, 29); // 2026-10-29（木）
const day = (n) => S.ymd(S.addDays(TODAY, n));
const unit = (title, status, due) => ({ title, status: status || "todo", due: due || "" });
const course = (name, units) => ({ name, units });

test("pendingItems: 未完了だけを、締切の早い順（締切なしは最後）で返す", () => {
  const items = P.pendingItems([
    course("A", [unit("a1", "done", day(1)), unit("a2", "todo", day(9)), unit("a3", "todo", "")]),
    course("B", [unit("b1", "todo", day(3)), unit("b2", "doing", "")]),
  ]);
  assert.deepEqual(items.map((i) => i.title), ["b1", "a2", "a3", "b2"]);
});

test("plan: 1日の上限ずつ日ごとに割り当てる", () => {
  const r = P.plan([course("A", [unit("1"), unit("2"), unit("3"), unit("4"), unit("5")])], TODAY, { perDay: 2 });
  assert.deepEqual(r.days.map((d) => d.items.length), [2, 2, 1]);
  assert.equal(r.days[0].date, day(0));
  assert.equal(r.finishDate, day(2));
  assert.equal(r.feasible, true);
});

test("plan: 休む曜日は飛ばす（今日が木曜、木・金を休む → 土曜から）", () => {
  const r = P.plan([course("A", [unit("1"), unit("2")])], TODAY, { perDay: 1, offDays: [4, 5] });
  assert.equal(S.parse(r.days[0].date).getDay(), 6);
  assert.equal(r.days[0].date, day(2));
});

test("plan: 全曜日を休みにしても止まらない（無効として扱う）", () => {
  const r = P.plan([course("A", [unit("1")])], TODAY, { perDay: 1, offDays: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(r.days.length, 1);
});

test("plan: 締切に間に合わない項目を、超過日数つきで検出する", () => {
  const r = P.plan([course("A", [unit("1", "todo", day(0)), unit("2", "todo", day(0)), unit("3", "todo", day(1))])], TODAY, { perDay: 1 });
  assert.equal(r.feasible, false);
  assert.deepEqual(r.late.map((i) => [i.title, i.daysLate]), [["2", 1], ["3", 1]]);
});

test("minPerDay: 間に合う最低ペースを返す。無理なら null、未完了なしは 0", () => {
  const c = [course("A", [unit("1", "todo", day(1)), unit("2", "todo", day(1)), unit("3", "todo", day(1)), unit("4", "todo", day(1))])];
  assert.equal(P.minPerDay(c, TODAY, []), 2); // 今日と明日の2日で4件
  assert.equal(P.minPerDay([course("A", Array.from({ length: 60 }, (_, i) => unit(String(i), "todo", day(0))))], TODAY, []), null);
  assert.equal(P.minPerDay([course("A", [unit("x", "done")])], TODAY, []), 0);
});

test("plan: 入力の異常値（0・負・文字列）でも安全な値に直す", () => {
  const c = [course("A", [unit("1"), unit("2")])];
  assert.equal(P.plan(c, TODAY, { perDay: 0 }).perDay, 1);
  assert.equal(P.plan(c, TODAY, { perDay: "abc" }).perDay, 1);
  assert.equal(P.plan(c, TODAY, { perDay: 999 }).perDay, P.MAX_PER_DAY);
  assert.equal(P.plan(c, TODAY, { offDays: ["x", 9, -1] }).days[0].date, day(0));
});

test("icsText: 改行・セミコロン・カンマ・バックスラッシュを安全にする（プロパティ注入の防止）", () => {
  const evil = "講座\r\nATTENDEE:mailto:x@example.com\nEND:VEVENT;a,b\\c";
  const out = P.icsText(evil);
  assert.ok(!/[\r\n]/.test(out));
  assert.ok(out.includes("\\;") && out.includes("\\,") && out.includes("\\\\"));
});

test("fold: 75オクテットで折り返し、マルチバイト文字の途中では切らない", () => {
  const long = "SUMMARY:" + "あ".repeat(60);
  const folded = P.fold(long);
  const physical = folded.split("\r\n");
  assert.ok(physical.length > 1);
  assert.ok(physical.every((l) => Buffer.byteLength(l) <= 75));
  assert.equal(physical.map((l, i) => (i ? l.slice(1) : l)).join(""), long);
});

test("toICS: 正しい構造（CRLF、イベント数、終日の日付、UTC DTSTAMP）", () => {
  const r = P.plan([course("講座A", [unit("第1回, 視聴", "todo", day(3)), unit("第1回 課題")])], TODAY, { perDay: 1 });
  const ics = P.toICS(r, "学習プラン", new Date(Date.UTC(2026, 9, 29, 3, 0, 0)));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(!/(^|[^\r])\n/.test(ics), "LF単独の改行なし");
  assert.match(ics, /DTSTAMP:20261029T030000Z/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261029/);
  assert.match(ics, /DTEND;VALUE=DATE:20261030/);
  assert.match(ics.replace(/\r\n /g, ""), /SUMMARY:講座A：第1回\\, 視聴/);
  const uids = ics.match(/UID:[^\r]+/g);
  assert.equal(new Set(uids).size, uids.length);
});
