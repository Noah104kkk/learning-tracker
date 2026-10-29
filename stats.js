"use strict";

/*
 * 統計ロジック（画面・保存に依存しない純粋関数）。
 * 「今日」は引数で受け取るため、テストで日付を固定できます。
 */
(function (root) {
  const DAY_MS = 86400000;

  const pad = (n) => String(n).padStart(2, "0");
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => new Date(s + "T00:00:00");
  const daysBetween = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);

  function percent(units) {
    if (!units.length) return 0;
    return Math.round((units.filter((u) => u.status === "done").length / units.length) * 100);
  }

  /** 日付 → 学習分数 */
  function minutesByDate(sessions) {
    const map = new Map();
    for (const s of sessions) map.set(s.date, (map.get(s.date) || 0) + s.minutes);
    return map;
  }

  /** 直近7日（古い順、今日を含む） */
  function weekMinutes(sessions, today) {
    const map = minutesByDate(sessions);
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const date = ymd(addDays(today, -i));
      out.push({ date, minutes: map.get(date) || 0 });
    }
    return out;
  }

  function level(minutes) {
    if (minutes <= 0) return 0;
    if (minutes < 30) return 1;
    if (minutes < 60) return 2;
    if (minutes < 120) return 3;
    return 4;
  }

  /** 日曜始まりの週単位ヒートマップ。未来のマスは含めない。 */
  function heatmap(sessions, today, weeks) {
    const map = minutesByDate(sessions);
    const t = startOfDay(today);
    const start = addDays(t, -((weeks - 1) * 7 + t.getDay()));
    const cells = [];
    for (let d = start; d <= t; d = addDays(d, 1)) {
      const date = ymd(d);
      const minutes = map.get(date) || 0;
      cells.push({ date, minutes, level: level(minutes) });
    }
    return cells;
  }

  /** 連続学習日数。今日まだ学習していなければ昨日までを数える。 */
  function streak(sessions, today) {
    const map = minutesByDate(sessions);
    let d = startOfDay(today);
    if (!(map.get(ymd(d)) > 0)) d = addDays(d, -1);
    let n = 0;
    while (map.get(ymd(d)) > 0) { n += 1; d = addDays(d, -1); }
    return n;
  }

  function totalMinutes(sessions) {
    return sessions.reduce((sum, s) => sum + s.minutes, 0);
  }

  /**
   * 完了ペースから終了予定日を見積もる。
   * state: complete / unknown / noTarget / ontrack / behind
   */
  function forecast(course, today, windowDays) {
    const win = windowDays || 14;
    const remainingUnits = course.units.filter((u) => u.status !== "done");
    if (course.units.length > 0 && remainingUnits.length === 0) return { state: "complete" };
    if (remainingUnits.length === 0) return { state: "unknown", remaining: 0 };

    const from = addDays(today, -(win - 1));
    const recentDone = course.units.filter(
      (u) => u.status === "done" && u.doneAt && parse(u.doneAt) >= from && parse(u.doneAt) <= startOfDay(today)
    ).length;
    const pace = recentDone / win;

    const dues = remainingUnits.filter((u) => u.due).map((u) => u.due).sort();
    const target = course.target || (dues.length ? dues[dues.length - 1] : "");
    const daysLeft = target ? daysBetween(today, parse(target)) : null;
    const requiredPerDay = daysLeft === null ? null : remainingUnits.length / Math.max(1, daysLeft);

    if (pace === 0) return { state: "unknown", remaining: remainingUnits.length, target, requiredPerDay };

    const finish = addDays(today, Math.ceil(remainingUnits.length / pace));
    const result = { remaining: remainingUnits.length, pace, finish: ymd(finish), target, requiredPerDay };
    if (!target) return { state: "noTarget", ...result };
    const delay = daysBetween(parse(target), finish);
    return { state: delay > 0 ? "behind" : "ontrack", delayDays: Math.max(0, delay), ...result };
  }

  const api = { percent, minutesByDate, weekMinutes, heatmap, level, streak, totalMinutes, forecast, ymd, parse, addDays, daysBetween };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== "undefined" ? window : globalThis);
