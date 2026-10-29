"use strict";

/*
 * 保存・検証・型（テンプレート）。
 * 読み込むデータ（localStorage・JSON）は必ず sanitize を通してから使う。
 */
(function (root) {
  const STORAGE_KEY = "learning-tracker:v2";
  const LEGACY_KEY = "learning-tracker:v1";
  const LIMITS = { courses: 50, units: 200, sessions: 3000, name: 60, title: 80, note: 500, fileBytes: 1024 * 1024 };
  const STATUS = { todo: "未着手", doing: "進行中", done: "完了" };

  function newId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  const cleanId = (v) => (typeof v === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : newId());

  function cleanText(value, max, keepNewlines) {
    if (typeof value !== "string") return "";
    const pattern = keepNewlines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g;
    return value.replace(pattern, "").trim().slice(0, max);
  }

  function cleanDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    const d = new Date(value + "T00:00:00");
    if (Number.isNaN(d.getTime())) return "";
    const back = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return back === value ? value : ""; // 2026-02-31 のような存在しない日付を除外
  }

  function cleanMinutes(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= 1 && n <= 1440 ? n : 0;
  }

  function emptyState() {
    return { version: 2, courses: [], sessions: [] };
  }

  /** どんな入力でも、安全な形のデータ（または null）にして返す。v1形式も受け付ける。 */
  function sanitize(input) {
    if (!input || typeof input !== "object" || !Array.isArray(input.courses)) return null;
    const courses = [];
    const seen = new Set();
    for (const c of input.courses.slice(0, LIMITS.courses)) {
      const name = cleanText(c && c.name, LIMITS.name);
      if (!name) continue;
      let id = cleanId(c.id);
      if (seen.has(id)) id = newId();
      seen.add(id);
      const units = [];
      const rawUnits = Array.isArray(c.units) ? c.units.slice(0, LIMITS.units) : [];
      for (const u of rawUnits) {
        const title = cleanText(u && u.title, LIMITS.title);
        if (!title) continue;
        const status = Object.prototype.hasOwnProperty.call(STATUS, u.status) ? u.status : "todo";
        units.push({
          id: newId(),
          title,
          status,
          due: cleanDate(u.due),
          note: cleanText(u.note, LIMITS.note, true),
          doneAt: status === "done" ? cleanDate(u.doneAt) : "",
        });
      }
      courses.push({ id, name, target: cleanDate(c.target), units });
    }
    const sessions = [];
    const rawSessions = Array.isArray(input.sessions) ? input.sessions.slice(0, LIMITS.sessions) : [];
    for (const s of rawSessions) {
      const date = cleanDate(s && s.date);
      const minutes = cleanMinutes(s && s.minutes);
      if (!date || !minutes) continue;
      const courseId = typeof s.courseId === "string" && seen.has(s.courseId) ? s.courseId : "";
      sessions.push({ date, minutes, courseId });
    }
    return { version: 2, courses, sessions };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
      if (!raw) return emptyState();
      return sanitize(JSON.parse(raw)) || emptyState();
    } catch (_) {
      return emptyState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEY); } catch (_) { /* 無視 */ }
  }

  function makeUnit(title) {
    return { id: newId(), title, status: "todo", due: "", note: "", doneAt: "" };
  }

  /** 型: ondemand=各回を「視聴」「課題」に分け、最終課題とアンケートを付ける / simple=回数のみ */
  function buildUnits(template, count) {
    const units = [];
    if (template === "ondemand") {
      for (let i = 1; i <= count; i++) units.push(makeUnit(`第${i}回 視聴`), makeUnit(`第${i}回 課題`));
      units.push(makeUnit("最終課題"), makeUnit("アンケート提出"));
    } else {
      for (let i = 1; i <= count; i++) units.push(makeUnit(`第${i}回`));
    }
    return units.slice(0, LIMITS.units);
  }

  const api = { LIMITS, STATUS, newId, cleanText, cleanDate, cleanMinutes, sanitize, load, save, clear, emptyState, makeUnit, buildUnits };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Store = api;
})(typeof window !== "undefined" ? window : globalThis);
