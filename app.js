"use strict";

/*
 * 学習進捗トラッカー（画面）
 * - データはブラウザの localStorage にのみ保存。外部への送信は一切なし（CSPでも禁止）。
 * - 画面への描画は textContent / createElement(NS) のみ。innerHTML は使わない（XSS対策）。
 * - 読み込んだデータは Store.sanitize で形式・長さ・件数を検証してから採用する。
 */
(function () {
  const { Stats, Store } = window;
  const { LIMITS, STATUS } = Store;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const APP_TITLE = "学習進捗トラッカー";
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  let state = Store.load();
  const filter = { status: "all", q: "" };
  const $ = (id) => document.getElementById(id);
  const now = () => new Date();

  // ---------- 小さな部品 ----------
  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, val] of Object.entries(props || {})) {
      if (key === "text") node.textContent = val;
      else if (key === "class") node.className = val;
      else node.setAttribute(key, val);
    }
    (children || []).forEach((child) => node.appendChild(child));
    return node;
  }

  function svg(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, val] of Object.entries(attrs || {})) node.setAttribute(key, String(val));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showMsg(text, isError) {
    const box = $("msg");
    box.textContent = text;
    box.className = isError ? "msg err" : "msg";
  }

  function persist() {
    if (!Store.save(state)) showMsg("ブラウザに保存できませんでした。JSONで書き出してバックアップしてください。", true);
  }

  function fmtMinutes(min) {
    if (min < 60) return `${min}分`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}時間${m}分` : `${h}時間`;
  }

  function setBar(barEl, fillEl, pct) {
    fillEl.style.width = pct + "%";
    fillEl.classList.toggle("complete", pct === 100);
    barEl.setAttribute("aria-valuenow", String(pct));
  }

  // ---------- 描画 ----------
  function render() {
    renderSummary();
    renderStats();
    renderTimerCourses();
    renderDeadlines();
    renderCourses();
  }

  function renderSummary() {
    const all = state.courses.flatMap((c) => c.units);
    const pct = Stats.percent(all);
    setBar($("overall-bar"), $("overall-fill"), pct);
    const done = all.filter((u) => u.status === "done").length;
    $("overall-text").textContent = all.length === 0
      ? "まだ項目がありません。講座を追加するか、サンプルを読み込んでください。"
      : `${done} / ${all.length} 件完了（${pct}%）`;
  }

  function renderStats() {
    const today = now();
    const week = Stats.weekMinutes(state.sessions, today);
    $("kpi-streak").textContent = `${Stats.streak(state.sessions, today)}日`;
    $("kpi-week").textContent = fmtMinutes(week.reduce((s, d) => s + d.minutes, 0));
    $("kpi-total").textContent = fmtMinutes(Stats.totalMinutes(state.sessions));
    renderWeekChart(week);
    renderHeatmap(today);
  }

  function renderWeekChart(week) {
    const W = 336, H = 150, PAD_TOP = 18, PAD_BOTTOM = 22, BAR_W = 30, GAP = 18;
    const max = Math.max(30, ...week.map((d) => d.minutes));
    const plotH = H - PAD_TOP - PAD_BOTTOM;
    const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", class: "chart-svg",
      "aria-label": "直近7日の学習時間: " + week.map((d) => `${d.date} ${d.minutes}分`).join("、") });
    chart.appendChild(svg("line", { x1: 0, y1: H - PAD_BOTTOM, x2: W, y2: H - PAD_BOTTOM, class: "axis" }));
    week.forEach((d, i) => {
      const x = 8 + i * (BAR_W + GAP);
      const h = Math.round((d.minutes / max) * plotH);
      const rect = svg("rect", { x, y: H - PAD_BOTTOM - h, width: BAR_W, height: h, rx: 3, class: "bar-rect" });
      rect.appendChild(svg("title", {}, `${d.date}: ${d.minutes}分`));
      chart.appendChild(rect);
      if (d.minutes > 0) chart.appendChild(svg("text", { x: x + BAR_W / 2, y: H - PAD_BOTTOM - h - 4, class: "chart-val" }, String(d.minutes)));
      chart.appendChild(svg("text", { x: x + BAR_W / 2, y: H - 6, class: "chart-label" }, WEEKDAYS[Stats.parse(d.date).getDay()]));
    });
    $("week-chart").replaceChildren(chart);
  }

  function renderHeatmap(today) {
    const box = $("heatmap");
    box.replaceChildren();
    for (const c of Stats.heatmap(state.sessions, today, 12)) {
      box.appendChild(el("div", { class: `cell l${c.level}`, title: `${c.date}: ${c.minutes}分` }));
    }
  }

  function renderTimerCourses() {
    const select = $("timer-course");
    const keep = select.value;
    select.replaceChildren(el("option", { value: "", text: "指定なし（全体）" }));
    for (const c of state.courses) select.appendChild(el("option", { value: c.id, text: c.name }));
    select.value = state.courses.some((c) => c.id === keep) ? keep : "";
  }

  function renderDeadlines() {
    const list = $("deadlines");
    list.replaceChildren();
    const items = [];
    for (const c of state.courses) {
      for (const u of c.units) if (u.due && u.status !== "done") items.push({ course: c.name, title: u.title, due: u.due });
    }
    items.sort((a, b) => a.due.localeCompare(b.due));
    if (items.length === 0) {
      list.appendChild(el("li", { class: "muted", text: "締切つきの未完了項目はありません。" }));
      return;
    }
    for (const item of items.slice(0, 8)) {
      const d = Stats.daysBetween(now(), Stats.parse(item.due));
      let label = `あと${d}日`;
      let cls = "";
      if (d < 0) { label = `${-d}日超過`; cls = "tag-over"; }
      else if (d === 0) { label = "今日"; cls = "tag-soon"; }
      else if (d <= 3) cls = "tag-soon";
      list.appendChild(el("li", { class: "deadline" }, [
        el("span", { text: `${item.course}：${item.title}` }),
        el("span", { class: cls, text: `${item.due}（${label}）` }),
      ]));
    }
  }

  function forecastText(course) {
    const f = Stats.forecast(course, now());
    switch (f.state) {
      case "complete": return { text: "修了済みです。", cls: "ok" };
      case "unknown": return { text: "完了ペースがまだ測れません。項目を完了すると、終了予定日を見積もります。", cls: "" };
      case "noTarget": return { text: `このペースだと ${f.finish} ごろ完了の見込みです。`, cls: "" };
      case "ontrack": return { text: `順調です。${f.finish} ごろ完了の見込み（目標 ${f.target}）。`, cls: "ok" };
      default: {
        const need = f.requiredPerDay === null ? "" : `目標に間に合わせるには1日あたり約${f.requiredPerDay.toFixed(1)}項目が必要です。`;
        return { text: `遅れ気味です。完了見込みは ${f.finish}（目標より${f.delayDays}日遅れ）。${need}`, cls: "late" };
      }
    }
  }

  function unitMatches(unit) {
    if (filter.status === "open" && unit.status === "done") return false;
    if (filter.status !== "all" && filter.status !== "open" && unit.status !== filter.status) return false;
    if (filter.q) {
      const q = filter.q.toLowerCase();
      if (!unit.title.toLowerCase().includes(q) && !unit.note.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  function renderCourses() {
    const root = $("courses");
    root.replaceChildren();
    for (const course of state.courses) root.appendChild(courseCard(course));
  }

  function courseCard(course) {
    const pct = Stats.percent(course.units);
    const fill = el("div", { class: "bar-fill" });
    const bar = el("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, [fill]);
    setBar(bar, fill, pct);

    const delCourse = el("button", { type: "button", class: "danger small", text: "講座を削除" });
    delCourse.addEventListener("click", () => {
      if (!confirm(`「${course.name}」を削除しますか？`)) return;
      state.courses = state.courses.filter((c) => c.id !== course.id);
      state.sessions = state.sessions.map((s) => (s.courseId === course.id ? { ...s, courseId: "" } : s));
      persist(); render();
    });

    const head = el("div", { class: "course-head" }, [
      el("h3", { text: course.name }),
      el("span", { class: "pct", text: `${pct}%` }),
      delCourse,
    ]);

    const target = el("input", { type: "date", "aria-label": "修了目標日", value: course.target });
    target.addEventListener("change", () => {
      course.target = Store.cleanDate(target.value);
      persist(); renderCourses(); renderDeadlines();
    });
    const fc = forecastText(course);
    const meta = el("div", { class: "course-meta" }, [
      el("label", { class: "inline" }, [el("span", { text: "修了目標日" }), target]),
      el("p", { class: "forecast " + fc.cls, text: fc.text }),
    ]);

    const minutes = state.sessions.filter((s) => s.courseId === course.id).reduce((sum, s) => sum + s.minutes, 0);
    const study = el("p", { class: "muted", text: `この講座の学習時間: ${fmtMinutes(minutes)}` });

    const list = el("ul", { class: "plain" });
    const visible = course.units.filter(unitMatches);
    for (const unit of visible) list.appendChild(unitRow(course, unit));
    if (visible.length === 0) list.appendChild(el("li", { class: "muted", text: "該当する項目がありません。" }));

    const input = el("input", { type: "text", maxlength: String(LIMITS.title), placeholder: "項目を追加（例: 振り返り）", "aria-label": "項目名" });
    const addForm = el("form", { class: "add-unit" }, [input, el("button", { type: "submit", class: "ghost small", text: "追加" })]);
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const title = Store.cleanText(input.value, LIMITS.title);
      if (!title) return;
      if (course.units.length >= LIMITS.units) { showMsg(`1講座あたり${LIMITS.units}件までです。`, true); return; }
      course.units.push(Store.makeUnit(title));
      persist(); render();
    });

    return el("section", { class: "card" }, [head, bar, meta, study, list, addForm]);
  }

  function unitRow(course, unit) {
    const select = el("select", { "aria-label": "状態" });
    for (const [value, label] of Object.entries(STATUS)) {
      const opt = el("option", { value, text: label });
      if (unit.status === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      unit.status = select.value;
      unit.doneAt = unit.status === "done" ? Stats.ymd(now()) : "";
      persist(); render();
    });

    const due = el("input", { type: "date", "aria-label": "締切", value: unit.due });
    due.addEventListener("change", () => { unit.due = Store.cleanDate(due.value); persist(); renderDeadlines(); renderCourses(); });

    const del = el("button", { type: "button", class: "ghost small", text: "削除", "aria-label": "項目を削除" });
    del.addEventListener("click", () => {
      course.units = course.units.filter((u) => u.id !== unit.id);
      persist(); render();
    });

    const note = el("textarea", { rows: "3", maxlength: String(LIMITS.note), "aria-label": "メモ", placeholder: "つまずいた点・次にやること など" });
    note.value = unit.note;
    const summary = el("summary", { text: unit.note ? "メモあり" : "メモ" });
    note.addEventListener("change", () => {
      unit.note = Store.cleanText(note.value, LIMITS.note, true);
      summary.textContent = unit.note ? "メモあり" : "メモ";
      persist();
    });

    return el("li", { class: "unit" + (unit.status === "done" ? " done" : "") }, [
      el("div", { class: "unit-main" }, [el("span", { class: "title", text: unit.title }), select, due, del]),
      el("details", { class: "note" }, [summary, note]),
    ]);
  }

  // ---------- 学習ログ ----------
  function addSession(minutes, date, courseId) {
    if (state.sessions.length >= LIMITS.sessions) state.sessions.shift();
    state.sessions.push({ date, minutes, courseId });
    persist();
    renderStats();
    renderCourses();
  }

  $("log-date").value = Stats.ymd(now());
  $("log-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const minutes = Store.cleanMinutes($("log-minutes").value);
    const date = Store.cleanDate($("log-date").value);
    if (!minutes || !date) { showMsg("分数（1〜1440）と日付を確認してください。", true); return; }
    addSession(minutes, date, $("timer-course").value);
    showMsg(`${minutes}分を記録しました。`);
  });

  // ---------- タイマー ----------
  const timer = { running: false, endAt: 0, remaining: 0, total: 0, id: null };

  function clock(sec) {
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  }

  function showClock() {
    $("timer-display").textContent = clock(timer.remaining);
    document.title = timer.running ? `${clock(timer.remaining)} ・ ${APP_TITLE}` : APP_TITLE;
  }

  function setIdle() {
    clearInterval(timer.id);
    timer.running = false;
    timer.total = Math.max(1, Math.min(180, parseInt($("timer-minutes").value, 10) || 25));
    timer.remaining = timer.total * 60;
    $("timer-start").textContent = "開始";
    showClock();
  }

  function finishTimer() {
    const minutes = timer.total;
    setIdle();
    addSession(minutes, Stats.ymd(now()), $("timer-course").value);
    showMsg(`${minutes}分の学習を記録しました。おつかれさまです。`);
  }

  function tick() {
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
    showClock();
    if (timer.remaining <= 0) finishTimer();
  }

  $("timer-start").addEventListener("click", () => {
    if (timer.running) {
      clearInterval(timer.id);
      timer.running = false;
      $("timer-start").textContent = "再開";
      showClock();
      return;
    }
    if (timer.remaining <= 0) setIdle();
    timer.endAt = Date.now() + timer.remaining * 1000;
    timer.running = true;
    timer.id = setInterval(tick, 250);
    $("timer-start").textContent = "一時停止";
  });
  $("timer-reset").addEventListener("click", setIdle);
  $("timer-minutes").addEventListener("change", () => { if (!timer.running) setIdle(); });

  // ---------- 講座の追加・絞り込み ----------
  $("course-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = Store.cleanText($("course-name").value, LIMITS.name);
    if (!name) return;
    if (state.courses.length >= LIMITS.courses) { showMsg(`講座は${LIMITS.courses}件までです。`, true); return; }
    const count = Math.max(0, Math.min(100, parseInt($("course-count").value, 10) || 0));
    state.courses.push({
      id: Store.newId(), name, target: Store.cleanDate($("course-target").value),
      units: Store.buildUnits($("course-template").value, count),
    });
    $("course-name").value = "";
    persist(); render(); showMsg("");
  });

  $("filter-status").addEventListener("change", () => { filter.status = $("filter-status").value; renderCourses(); });
  $("filter-q").addEventListener("input", () => { filter.q = Store.cleanText($("filter-q").value, 40); renderCourses(); });

  // ---------- データ管理 ----------
  function sampleData() {
    const today = now();
    const day = (n) => Stats.ymd(Stats.addDays(today, n));
    const sessions = [];
    for (let i = 0; i < 40; i++) {
      const minutes = [0, 25, 50, 0, 75, 30, 100][(i * 3) % 7];
      if (minutes) sessions.push({ date: day(-i), minutes, courseId: i % 2 ? "sample-b" : "sample-a" });
    }
    return Store.sanitize({
      courses: [
        { id: "sample-a", name: "サンプル講座A（架空）", target: day(24), units: [
          { title: "第1回 視聴", status: "done", doneAt: day(-12) },
          { title: "第1回 課題", status: "done", doneAt: day(-11) },
          { title: "第2回 視聴", status: "done", doneAt: day(-7) },
          { title: "第2回 課題", status: "done", doneAt: day(-5) },
          { title: "第3回 視聴", status: "done", doneAt: day(-2) },
          { title: "第3回 課題", status: "doing", due: day(2), note: "演習2の途中。次は式の整理から。" },
          { title: "第4回 視聴", status: "todo", due: day(9) },
          { title: "第4回 課題", status: "todo", due: day(12) },
          { title: "最終課題", status: "todo", due: day(21) },
          { title: "アンケート提出", status: "todo", due: day(24) },
        ] },
        { id: "sample-b", name: "サンプル資格B（架空）", target: day(40), units: [
          { title: "テキスト1章", status: "done", doneAt: day(-9) },
          { title: "テキスト2章", status: "doing" },
          { title: "テキスト3章", status: "todo" },
          { title: "模擬試験", status: "todo", due: day(30) },
        ] },
      ],
      sessions,
    });
  }

  $("btn-sample").addEventListener("click", () => {
    if ((state.courses.length || state.sessions.length) && !confirm("現在のデータはサンプルで置き換わります。よろしいですか？")) return;
    state = sampleData();
    persist(); render(); showMsg("架空のサンプルを読み込みました。");
  });

  $("btn-export").addEventListener("click", () => {
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

  $("file-import").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > LIMITS.fileBytes) { showMsg("ファイルが大きすぎます（1MBまで）。", true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = Store.sanitize(JSON.parse(String(reader.result)));
        if (!parsed) throw new Error("format");
        if ((state.courses.length || state.sessions.length) && !confirm("現在のデータは読み込んだ内容で置き換わります。よろしいですか？")) return;
        state = parsed;
        persist(); render(); showMsg("読み込みました。");
      } catch (_) {
        showMsg("読み込めませんでした。このアプリで書き出したJSONを選んでください。", true);
      }
    };
    reader.readAsText(file);
  });

  $("btn-reset").addEventListener("click", () => {
    if (!confirm("このブラウザに保存された全データを削除します。よろしいですか？")) return;
    state = Store.emptyState();
    Store.clear();
    render(); showMsg("削除しました。");
  });

  setIdle();
  render();
})();
