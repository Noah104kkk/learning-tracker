"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

function boot() {
  const html = read("index.html").replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const w = dom.window;
  w.confirm = () => true;
  for (const f of ["stats.js", "store.js", "planner.js", "app.js"]) w.eval(read(f));
  return w;
}

const submit = (w, id) => w.document.getElementById(id).dispatchEvent(new w.Event("submit", { cancelable: true }));

function addCourse(w, name, count, template) {
  const d = w.document;
  d.getElementById("course-name").value = name;
  d.getElementById("course-count").value = String(count);
  d.getElementById("course-template").value = template || "ondemand";
  submit(w, "course-form");
}

test("HTMLを含む講座名・メモは文字として表示され、要素として実行されない", () => {
  const w = boot();
  addCourse(w, "<img src=x onerror=alert(1)>", 1);
  assert.equal(w.document.querySelector("#courses img"), null);
  assert.ok(w.document.querySelector("#courses h3").textContent.includes("<img"));
});

test("オンデマンド講座型: 3回なら 6+2=8項目", () => {
  const w = boot();
  addCourse(w, "テスト", 3);
  assert.equal(w.document.querySelectorAll(".unit").length, 8);
});

test("完了にすると進捗・予測が更新され、localStorage に保存される", () => {
  const w = boot();
  addCourse(w, "テスト", 2);
  const select = w.document.querySelector(".unit select");
  select.value = "done";
  select.dispatchEvent(new w.Event("change"));
  assert.match(w.document.getElementById("overall-text").textContent, /1 \/ 6/);
  assert.ok(w.localStorage.getItem("learning-tracker:v2"));
});

test("手動の学習記録がグラフ・KPIに反映される", () => {
  const w = boot();
  const d = w.document;
  d.getElementById("log-minutes").value = "45";
  submit(w, "log-form");
  assert.equal(d.getElementById("kpi-week").textContent, "45分");
  assert.equal(d.getElementById("kpi-streak").textContent, "1日");
  assert.ok(d.querySelector("#week-chart svg rect.bar-rect"));
  assert.ok(d.querySelectorAll("#heatmap .cell").length > 77);
});

test("サンプル読み込み: 締切・予測・ヒートマップが表示される", () => {
  const w = boot();
  w.document.getElementById("btn-sample").click();
  const d = w.document;
  assert.ok(d.querySelectorAll("#deadlines .deadline").length > 0);
  assert.ok(d.querySelector(".forecast"));
  assert.ok(d.querySelectorAll("#heatmap .cell.l2, #heatmap .cell.l3, #heatmap .cell.l4").length > 0);
  assert.ok(d.querySelectorAll(".card h3").length >= 2);
});

test("絞り込み: 状態と検索で項目が絞られる", () => {
  const w = boot();
  w.document.getElementById("btn-sample").click();
  const d = w.document;
  const before = d.querySelectorAll(".unit").length;
  d.getElementById("filter-status").value = "open";
  d.getElementById("filter-status").dispatchEvent(new w.Event("change"));
  const open = d.querySelectorAll(".unit").length;
  assert.ok(open < before);
  d.getElementById("filter-q").value = "最終課題";
  d.getElementById("filter-q").dispatchEvent(new w.Event("input"));
  assert.equal(d.querySelectorAll(".unit").length, 1);
});

test("全データ削除で空に戻り、保存データも消える", () => {
  const w = boot();
  addCourse(w, "テスト", 2);
  w.document.getElementById("btn-reset").click();
  assert.equal(w.document.querySelectorAll(".unit").length, 0);
  assert.equal(w.localStorage.getItem("learning-tracker:v2"), null);
});

test("セキュリティ: CSPが外部接続を禁止し、危険なAPIをソースで使っていない", () => {
  const html = read("index.html");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "インラインスクリプトなし");
  assert.doesNotMatch(html, /https?:\/\//, "外部URLの読み込みなし");
  for (const f of ["app.js", "store.js", "stats.js"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\.innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, f);
  }
});

test("プランナー: 計画を作り、.ics ボタンが有効になる。講座名のHTMLは要素にならない", () => {
  const w = boot();
  addCourse(w, "<b>x</b>", 2);
  w.document.getElementById("plan-perday").value = "3";
  assert.equal(w.document.getElementById("plan-ics").disabled, true);
  submit(w, "plan-form");
  assert.ok(w.document.querySelectorAll("#plan-result .plan-days > li").length >= 1);
  assert.equal(w.document.querySelector("#plan-result b"), null);
  assert.equal(w.document.getElementById("plan-ics").disabled, false);
});

test("プランナー: 未完了がなければその旨を表示する", () => {
  const w = boot();
  submit(w, "plan-form");
  assert.match(w.document.getElementById("plan-result").textContent, /未完了の項目はありません/);
});
