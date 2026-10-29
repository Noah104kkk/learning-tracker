"use strict";

/*
 * 学習進捗トラッカー
 * - データはブラウザの localStorage にのみ保存。外部への送信は一切なし（CSPでも禁止）。
 * - 画面への描画は textContent / createElement のみ。innerHTML は使わない（XSS対策）。
 * - 読み込んだJSONは形式・長さ・件数を検証してから採用する。
 */

const STORAGE_KEY = "learning-tracker:v1";
const LIMITS = { courses: 50, units: 200, name: 60, title: 80, fileBytes: 1024 * 1024 };
const STATUS = { todo: "未着手", doing: "進行中", done: "完了" };

let state = { version: 1, courses: [] };

// ---------- 保存・読み込み ----------
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = sanitize(JSON.parse(raw));
    if (parsed) state = parsed;
  } catch (_) {
    /* 読めない場合は空の状態で開始 */
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    showMsg("ブラウザに保存できませんでした。書き出しでバックアップしてください。", true);
  }
}

// ---------- 検証 ----------
function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}

function cleanDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return Number.isNaN(Date.parse(value + "T00:00:00")) ? "" : value;
}

function sanitize(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.courses)) return null;
  const courses = [];
  for (const c of input.courses.slice(0, LIMITS.courses)) {
    const name = cleanText(c && c.name, LIMITS.name);
    if (!name) continue;
    const units = [];
    const rawUnits = Array.isArray(c.units) ? c.units.slice(0, LIMITS.units) : [];
    for (const u of rawUnits) {
      const title = cleanText(u && u.title, LIMITS.title);
      if (!title) continue;
      units.push({
        id: newId(),
        title,
        status: Object.prototype.hasOwnProperty.call(STATUS, u.status) ? u.status : "todo",
        due: cleanDate(u.due),
      });
    }
    courses.push({ id: newId(), name, units });
  }
  return { version: 1, courses };
}

// ---------- 画面部品 ----------
function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (key === "text") node.textContent = val;
      else if (key === "class") node.className = val;
      else node.setAttribute(key, val);
    }
  }
  (children || []).forEach((child) => node.appendChild(child));
  return node;
}

function showMsg(text, isError) {
  const box = document.getElementById("msg");
  box.textContent = text;
  box.className = isError ? "msg err" : "msg";
}

function percent(units) {
  if (units.length === 0) return 0;
  return Math.round((units.filter((u) => u.status === "done").length / units.length) * 100);
}

function setBar(barEl, fillEl, pct) {
  fillEl.style.width = pct + "%";
  fillEl.classList.toggle("complete", pct === 100);
  barEl.setAttribute("aria-valuenow", String(pct));
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + "T00:00:00") - today) / 86400000);
}

// ---------- 描画 ----------
function render() {
  renderSummary();
  renderDeadlines();
  renderCourses();
}

function renderSummary() {
  const all = state.courses.flatMap((c) => c.units);
  const pct = percent(all);
  setBar(document.getElementById("overall-bar"), document.getElementById("overall-fill"), pct);
  const done = all.filter((u) => u.status === "done").length;
  document.getElementById("overall-text").textContent =
    all.length === 0 ? "まだ項目がありません。講座を追加するか、サンプルを読み込んでください。"
                     : `${done} / ${all.length} 件完了（${pct}%）`;
}

function renderDeadlines() {
  const list = document.getElementById("deadlines");
  list.replaceChildren();
  const items = [];
  for (const c of state.courses) {
    for (const u of c.units) {
      if (u.due && u.status !== "done") items.push({ course: c.name, title: u.title, due: u.due });
    }
  }
  items.sort((a, b) => a.due.localeCompare(b.due));
  if (items.length === 0) {
    list.appendChild(el("li", { class: "muted", text: "締切つきの未完了項目はありません。" }));
    return;
  }
  for (const item of items.slice(0, 8)) {
    const d = daysUntil(item.due);
    let label = `あと${d}日`;
    let cls = "";
    if (d < 0) { label = `${-d}日超過`; cls = "tag-over"; }
    else if (d === 0) { label = "今日"; cls = "tag-soon"; }
    else if (d <= 3) { cls = "tag-soon"; }
    list.appendChild(el("li", { class: "deadline" }, [
      el("span", { text: `${item.course}：${item.title}` }),
      el("span", { class: cls, text: `${item.due}（${label}）` }),
    ]));
  }
}

function renderCourses() {
  const root = document.getElementById("courses");
  root.replaceChildren();
  for (const course of state.courses) root.appendChild(courseCard(course));
}

function courseCard(course) {
  const pct = percent(course.units);
  const fill = el("div", { class: "bar-fill" });
  const bar = el("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, [fill]);
  setBar(bar, fill, pct);

  const delCourse = el("button", { type: "button", class: "danger small", text: "講座を削除" });
  delCourse.addEventListener("click", () => {
    if (!confirm(`「${course.name}」を削除しますか？`)) return;
    state.courses = state.courses.filter((c) => c.id !== course.id);
    save(); render();
  });

  const head = el("div", { class: "course-head" }, [
    el("h3", { text: course.name }),
    el("span", { class: "pct", text: `${pct}%` }),
    delCourse,
  ]);

  const list = el("ul", { class: "plain" });
  for (const unit of course.units) list.appendChild(unitRow(course, unit));

  const input = el("input", { type: "text", maxlength: String(LIMITS.title), placeholder: "項目を追加（例: 最終課題）", "aria-label": "項目名" });
  const addBtn = el("button", { type: "submit", class: "ghost small", text: "追加" });
  const addForm = el("form", { class: "add-unit" }, [input, addBtn]);
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = cleanText(input.value, LIMITS.title);
    if (!title) return;
    if (course.units.length >= LIMITS.units) { showMsg(`1講座あたり${LIMITS.units}件までです。`, true); return; }
    course.units.push({ id: newId(), title, status: "todo", due: "" });
    save(); render();
  });

  return el("section", { class: "card" }, [head, bar, list, addForm]);
}

function unitRow(course, unit) {
  const select = el("select", { "aria-label": "状態" });
  for (const [value, label] of Object.entries(STATUS)) {
    const opt = el("option", { value, text: label });
    if (unit.status === value) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => { unit.status = select.value; save(); render(); });

  const due = el("input", { type: "date", "aria-label": "締切", value: unit.due });
  due.addEventListener("change", () => { unit.due = cleanDate(due.value); save(); renderDeadlines(); });

  const del = el("button", { type: "button", class: "ghost small", text: "削除", "aria-label": "項目を削除" });
  del.addEventListener("click", () => {
    course.units = course.units.filter((u) => u.id !== unit.id);
    save(); render();
  });

  return el("li", { class: "unit" + (unit.status === "done" ? " done" : "") }, [
    el("span", { class: "title", text: unit.title }), select, due, del,
  ]);
}

// ---------- 型（テンプレート） ----------
function makeUnit(title) {
  return { id: newId(), title, status: "todo", due: "" };
}

function buildUnits(template, count) {
  const units = [];
  if (template === "ondemand") {
    // 各回を「視聴」と「課題」に分け、最後に最終課題とアンケートを付ける
    for (let i = 1; i <= count; i++) {
      units.push(makeUnit(`第${i}回 視聴`), makeUnit(`第${i}回 課題`));
    }
    units.push(makeUnit("最終課題"), makeUnit("アンケート提出"));
  } else {
    for (let i = 1; i <= count; i++) units.push(makeUnit(`第${i}回`));
  }
  return units.slice(0, LIMITS.units);
}

// ---------- 操作 ----------
document.getElementById("course-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("course-name");
  const name = cleanText(nameInput.value, LIMITS.name);
  if (!name) return;
  if (state.courses.length >= LIMITS.courses) { showMsg(`講座は${LIMITS.courses}件までです。`, true); return; }
  const count = Math.max(0, Math.min(100, parseInt(document.getElementById("course-count").value, 10) || 0));
  const template = document.getElementById("course-template").value;
  const units = buildUnits(template, count);
  state.courses.push({ id: newId(), name, units });
  nameInput.value = "";
  save(); render(); showMsg("");
});

document.getElementById("btn-sample").addEventListener("click", () => {
  if (state.courses.length && !confirm("現在のデータはサンプルで置き換わります。よろしいですか？")) return;
  const plus = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  state = sanitize({
    courses: [
      { name: "サンプル講座A（架空）", units: [
        { title: "第1回 イントロダクション", status: "done" },
        { title: "第2回 基礎", status: "done" },
        { title: "第3回 演習", status: "doing", due: plus(2) },
        { title: "第4回 応用", status: "todo", due: plus(9) },
        { title: "最終課題", status: "todo", due: plus(21) },
      ] },
      { name: "サンプル資格B（架空）", units: [
        { title: "テキスト1章", status: "done" },
        { title: "テキスト2章", status: "doing" },
        { title: "模擬試験", status: "todo", due: plus(14) },
      ] },
    ],
  });
  save(); render(); showMsg("架空のサンプルを読み込みました。");
});

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "learning-tracker.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showMsg("JSONを書き出しました。");
});

document.getElementById("file-import").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > LIMITS.fileBytes) { showMsg("ファイルが大きすぎます（1MBまで）。", true); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = sanitize(JSON.parse(String(reader.result)));
      if (!parsed) throw new Error("format");
      if (state.courses.length && !confirm("現在のデータは読み込んだ内容で置き換わります。よろしいですか？")) return;
      state = parsed;
      save(); render(); showMsg("読み込みました。");
    } catch (_) {
      showMsg("読み込めませんでした。このアプリで書き出したJSONを選んでください。", true);
    }
  };
  reader.readAsText(file);
});

document.getElementById("btn-reset").addEventListener("click", () => {
  if (!confirm("このブラウザに保存された全データを削除します。よろしいですか？")) return;
  state = { version: 1, courses: [] };
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* 無視 */ }
  render(); showMsg("削除しました。");
});

load();
render();
