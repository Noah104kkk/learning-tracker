"use strict";

/*
 * 遅れを取り戻すプランナー（画面・保存に依存しない純粋関数）。
 *  - 未完了の項目を「締切の早い順」に、1日あたりの上限数ずつ日ごとに割り当てる
 *  - 締切に間に合わない項目、間に合わせるのに必要な最低ペースを出す
 *  - カレンダー（.ics）に書き出す。外部サービスには何も送らない
 */
(function (root) {
  const S = typeof module !== "undefined" && module.exports ? require("./stats.js") : root.Stats;
  const MAX_PER_DAY = 20;
  const HORIZON_DAYS = 365;

  /** 未完了項目を、締切の早い順（締切なしは最後）、同じなら元の並び順で返す。 */
  function pendingItems(courses) {
    const items = [];
    let order = 0;
    for (const c of courses) {
      for (const u of c.units) {
        if (u.status !== "done") items.push({ course: c.name, title: u.title, due: u.due || "", order: order++ });
      }
    }
    return items.sort((a, b) => {
      if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
      if (a.due && !b.due) return -1;
      if (!a.due && b.due) return 1;
      return a.order - b.order;
    });
  }

  function cleanOpts(opts) {
    const o = opts || {};
    const perDay = Math.max(1, Math.min(MAX_PER_DAY, Math.round(Number(o.perDay)) || 1));
    const offDays = new Set((Array.isArray(o.offDays) ? o.offDays : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
    return { perDay, offDays: offDays.size >= 7 ? new Set() : offDays }; // 全曜日休みは無効
  }

  /** 日ごとの割り当て。today は Date。 */
  function plan(courses, today, opts) {
    const { perDay, offDays } = cleanOpts(opts);
    const items = pendingItems(courses);
    const days = [];
    const late = [];
    let idx = 0;
    for (let n = 0; n < HORIZON_DAYS && idx < items.length; n++) {
      const date = S.addDays(today, n);
      if (offDays.has(date.getDay())) continue;
      const dayItems = [];
      while (dayItems.length < perDay && idx < items.length) {
        const item = { ...items[idx++], date: S.ymd(date), daysLate: 0 };
        if (item.due && item.date > item.due) {
          item.daysLate = S.daysBetween(S.parse(item.due), S.parse(item.date));
          late.push(item);
        }
        dayItems.push(item);
      }
      days.push({ date: S.ymd(date), weekday: date.getDay(), items: dayItems });
    }
    const unscheduled = items.slice(idx);
    return {
      perDay, total: items.length, days, late, unscheduled,
      finishDate: days.length ? days[days.length - 1].date : "",
      feasible: late.length === 0 && unscheduled.length === 0,
    };
  }

  /** 締切に全部間に合う、1日あたりの最低項目数。20でも無理なら null。 */
  function minPerDay(courses, today, offDays) {
    if (!pendingItems(courses).length) return 0;
    for (let p = 1; p <= MAX_PER_DAY; p++) {
      if (plan(courses, today, { perDay: p, offDays }).feasible) return p;
    }
    return null;
  }

  // ---------- カレンダー（iCalendar / RFC 5545） ----------
  /** 値の中の制御文字（改行を含む）を除き、区切り文字をエスケープする。プロパティ注入を防ぐ。 */
  function icsText(value) {
    return String(value)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .trim();
  }

  /** 75オクテットを超える行を折り返す（マルチバイト文字の途中では切らない）。 */
  function fold(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = "";
    let bytes = 0;
    let limit = 75;
    for (const ch of line) {
      const len = enc.encode(ch).length;
      if (bytes + len > limit) { out.push(cur); cur = ""; bytes = 0; limit = 74; }
      cur += ch;
      bytes += len;
    }
    out.push(cur);
    return out.join("\r\n ");
  }

  const compact = (ymd) => ymd.replace(/-/g, "");

  function toICS(result, calendarName, nowDate) {
    const d = nowDate || new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//learning-tracker//JA", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(calendarName || "学習プラン")}`];
    let n = 0;
    for (const day of result.days) {
      for (const item of day.items) {
        n += 1;
        const next = S.ymd(S.addDays(S.parse(day.date), 1));
        lines.push(
          "BEGIN:VEVENT",
          `UID:plan-${compact(day.date)}-${n}@learning-tracker.local`,
          `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${compact(day.date)}`,
          `DTEND;VALUE=DATE:${compact(next)}`,
          `SUMMARY:${icsText(`${item.course}：${item.title}`)}`,
          `DESCRIPTION:${icsText(item.due ? `締切 ${item.due}${item.daysLate ? `（${item.daysLate}日超過の見込み）` : ""}` : "締切なし")}`,
          "TRANSP:TRANSPARENT",
          "END:VEVENT"
        );
      }
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  const api = { MAX_PER_DAY, pendingItems, plan, minPerDay, icsText, fold, toICS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof window !== "undefined" ? window : globalThis);
