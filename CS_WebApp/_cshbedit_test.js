/**
 * 로컬 검증: 커뮤니티 보드 글 수정
 *
 *  > "반품 카드나 CS커뮤니티 보드에서 올린 내용이 수정가능하게 해줘"
 *
 *  여태 카드는 올리고 나면 못 고쳤다. 오타 하나에 카드를 지우고 다시 올리면
 *  전달내역·읽음·첨부가 같이 날아간다.
 *
 *  지켜야 할 것
 *    · 본인이 올린 것만 고친다 — 남의 글을 고칠 수 있으면 보드를 못 믿는다
 *    · 고친 흔적을 반드시 남긴다 — 이미 읽은 사람이 모르면 더 위험하다
 *    · 안 넘어온 칸은 그대로 둔다 — 빈 문자열로 지우지 않는다
 *    · 전달내역 줄은 «원문 그대로»로 찾는다 — 번째로 찾으면 엉뚱한 줄을 고친다
 *
 * 실행: node CS_WebApp/_cshbedit_test.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const 뿌리 = __dirname;
const src = fs.readFileSync(path.join(뿌리, "csHandoffBoard.gs"), "utf8");

function grab(name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
function grabVar(name, open, close) {
  const at = src.indexOf("var " + name + " = " + open);
  let d = 0;
  for (let i = src.indexOf(open, at); i < src.length; i++) {
    if (src[i] === open) d++;
    else if (src[i] === close) { d--; if (d === 0) return src.slice(at, i + 1) + ";"; }
  }
  throw new Error(name + " 가 안 닫힘");
}

/* ── 가짜 시트 ─────────────────────────────── */
function 가짜탭(row) {
  const 쓴것 = {};
  return {
    _row: row, _쓴것: 쓴것,
    getRange(r, c) {
      return { setValue(v) { 쓴것[c] = v; row[c - 1] = v; } };
    },
  };
}

const ctx = {
  Utilities: {
    formatDate: () => "260914 22:30",
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: {},
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext([
  grabVar("_CS_HB_COL_", "{", "}"),
  grabVar("_CS_HB_LEVELS_", "[", "]"),
  grab("_cs_hb_now_"),
  grab("_cs_hb_stamp_"),
  grab("_cs_hb_normLevel_"),
  grab("_cs_hb_staff_"),
  grab("_cs_hb_appendNoteLine_"),
  grab("_cs_hb_parseNotes_"),
  //  접근 검사와 캐시 비우기는 여기선 통과시킨다
  "function _cs_ac_guard_() { return null; }",
  "function _cs_pulse_bust_() {}",
  //  카드 한 장을 물고 콜백에 넘겨 주는 시늉
  "var _테스트카드_ = null;",
  "function _cs_hb_withCard_(ref, fn) { return fn(_테스트카드_.tab, 2, _테스트카드_.row); }",
  grab("csEditHandoffCard"),
  grab("csEditHandoffNote"),
  grab("csDeleteHandoffNote"),
].join("\n"), ctx);

const C = ctx._CS_HB_COL_;
function 카드(o) {
  const row = [];
  for (let i = 0; i < 20; i++) row[i] = "";
  row[C.id] = "HB001";
  row[C.author] = o.author || "홍길동";
  row[C.level] = o.level || "일반";
  row[C.title] = o.title || "옛 제목";
  row[C.body] = o.body || "옛 내용";
  row[C.link] = o.link || "";
  row[C.notes] = o.notes || "";
  row[C.read] = o.read || "홍길동, 김철수";
  ctx._테스트카드_ = { tab: 가짜탭(row), row: row };
  return ctx._테스트카드_;
}

console.log("\n[카드 수정] 본인 것만");
{
  카드({ author: "홍길동" });
  const r = ctx.csEditHandoffCard({ id: "HB001", staff: "김철수", title: "새 제목" });
  check("★ 남의 글은 거절", r.ok, false);
  check("작성자를 알려 준다", /홍길동/.test(r.error), true);
  check("★ 거절했으면 아무것도 안 썼다", ctx._테스트카드_.tab._쓴것, {});
}
{
  const c = 카드({ author: "홍길동" });
  const r = ctx.csEditHandoffCard({ id: "HB001", staff: "홍길동", title: "새 제목" });
  check("★ 본인 글은 고쳐진다", r.ok, true);
  check("제목이 바뀌었다", c.row[C.title], "새 제목");
  check("★ 안 넘어온 내용은 그대로", c.row[C.body], "옛 내용");
}

console.log("\n[카드 수정] 고친 흔적을 남긴다");
{
  const c = 카드({ author: "홍길동", notes: "[260914 10:00 김철수] 확인했습니다" });
  ctx.csEditHandoffCard({ id: "HB001", staff: "홍길동", title: "새 제목", body: "새 내용" });
  const notes = ctx._cs_hb_parseNotes_(c.row[C.notes]);
  check("★ 전달내역에 한 줄이 붙었다", notes.length, 2);
  check("★ 무엇을 고쳤는지 적는다", notes[1].text, "✏ 제목·내용 고침");
  check("옛 줄은 그대로", notes[0].text, "확인했습니다");
  check("★★ 읽음이 작성자만 남는다 (다시 읽게)", c.row[C.read], "홍길동");
}

console.log("\n[카드 수정] 손대지 않아야 할 때");
{
  const c = 카드({ author: "홍길동", title: "같은 제목" });
  const r = ctx.csEditHandoffCard({ id: "HB001", staff: "홍길동", title: "같은 제목" });
  check("★ 같은 값이면 아무 일도 안 한다", ctx._테스트카드_.tab._쓴것, {});
  check("그렇다고 말해 준다", /바뀐 것이 없/.test(r.message || ""), true);
}
{
  카드({ author: "홍길동" });
  const r = ctx.csEditHandoffCard({ id: "HB001", staff: "홍길동", title: "   " });
  check("★ 제목은 비울 수 없다", r.ok, false);
}
{
  카드({ author: "홍길동" });
  const r = ctx.csEditHandoffCard({ id: "HB001", staff: "홍길동" });
  check("★ 고칠 것이 없으면 거절", r.ok, false);
}
{
  카드({ author: "홍길동" });
  const r = ctx.csEditHandoffCard({ id: "HB001", title: "새 제목" });
  check("★ 담당자를 안 고르면 거절", r.ok, false);
}

console.log("\n[전달내역 수정] 줄을 원문으로 찾는다");
const 두줄 = "[260914 10:00 홍길동] 첫 줄\n[260914 11:00 김철수] 둘째 줄";
{
  const c = 카드({ author: "홍길동", notes: 두줄 });
  const r = ctx.csEditHandoffNote({
    id: "HB001", staff: "홍길동",
    raw: "[260914 10:00 홍길동] 첫 줄", text: "고친 첫 줄",
  });
  check("★ 본인 줄은 고쳐진다", r.ok, true);
  const n = ctx._cs_hb_parseNotes_(c.row[C.notes]);
  check("★ 머리(시각·작성자)는 그대로", n[0].by + " " + n[0].at.slice(-5), "홍길동 10:00");
  check("★ ✏ 표시가 붙는다", n[0].text, "✏ 고친 첫 줄");
  check("★ 다른 줄은 안 건드린다", n[1].text, "둘째 줄");
}
{
  카드({ author: "홍길동", notes: 두줄 });
  const r = ctx.csEditHandoffNote({
    id: "HB001", staff: "홍길동",
    raw: "[260914 11:00 김철수] 둘째 줄", text: "남의 줄",
  });
  check("★ 남이 쓴 줄은 거절", r.ok, false);
  check("작성자를 알려 준다", /김철수/.test(r.error), true);
}
{
  카드({ author: "홍길동", notes: 두줄 });
  const r = ctx.csEditHandoffNote({
    id: "HB001", staff: "홍길동", raw: "[260914 10:00 홍길동] 없는 줄", text: "x",
  });
  check("★ 못 찾으면 «못 찾았다»고 한다", r.ok, false);
  check("새로고침을 권한다", /새로고침/.test(r.error), true);
}
{
  //  똑같은 줄이 둘이면 어느 것인지 알 수 없다
  카드({ author: "홍길동", notes: "[260914 10:00 홍길동] 같은 줄\n[260914 10:00 홍길동] 같은 줄" });
  const r = ctx.csEditHandoffNote({
    id: "HB001", staff: "홍길동", raw: "[260914 10:00 홍길동] 같은 줄", text: "x",
  });
  check("★ 똑같은 줄이 둘이면 손대지 않는다", r.ok, false);
}
{
  //  머리가 없는 옛 줄 — 누가 썼는지 모른다
  카드({ author: "홍길동", notes: "머리 없는 옛 줄" });
  const r = ctx.csEditHandoffNote({
    id: "HB001", staff: "홍길동", raw: "머리 없는 옛 줄", text: "x",
  });
  check("★ 작성자를 모르는 줄은 안 고친다", r.ok, false);
}
{
  //  이미 고친 줄을 또 고쳐도 ✏ 가 겹치지 않는다
  const c = 카드({ author: "홍길동", notes: "[260914 10:00 홍길동] ✏ 한 번 고침" });
  ctx.csEditHandoffNote({
    id: "HB001", staff: "홍길동",
    raw: "[260914 10:00 홍길동] ✏ 한 번 고침", text: "✏ 두 번째 고침",
  });
  check("★ ✏ 가 겹쳐 쌓이지 않는다",
    ctx._cs_hb_parseNotes_(c.row[C.notes])[0].text, "✏ 두 번째 고침");
}
{
  카드({ author: "홍길동", notes: 두줄 });
  const r = ctx.csEditHandoffNote({
    id: "HB001", staff: "홍길동", raw: "[260914 10:00 홍길동] 첫 줄", text: "  ",
  });
  check("★ 내용을 비울 수 없다 (지우기는 따로)", r.ok, false);
}


console.log("\n[전달내역 삭제] 흔적 없이 사라지지 않는다");
{
  const 두줄2 = "[260914 10:00 홍길동] 첫 줄\n[260914 11:00 김철수] 둘째 줄";
  const c = 카드({ author: "홍길동", notes: 두줄2 });
  const r = ctx.csDeleteHandoffNote({
    id: "HB001", staff: "홍길동", raw: "[260914 10:00 홍길동] 첫 줄",
  });
  check("★ 본인 줄은 지워진다", r.ok, true);
  const n = ctx._cs_hb_parseNotes_(c.row[C.notes]);
  check("★ 줄 자체는 남는다 (본 사람과 안 본 사람이 갈리지 않게)", n.length, 2);
  check("★ 내용은 지워지고 자국만", n[0].text, "🗑 지운 글");
  check("★ 누가 언제 썼는지는 남는다", n[0].by, "홍길동");
  check("★ 다른 줄은 안 건드린다", n[1].text, "둘째 줄");
}
{
  카드({ author: "홍길동", notes: "[260914 11:00 김철수] 둘째 줄" });
  const r = ctx.csDeleteHandoffNote({
    id: "HB001", staff: "홍길동", raw: "[260914 11:00 김철수] 둘째 줄",
  });
  check("★ 남이 쓴 줄은 못 지운다", r.ok, false);
}
{
  카드({ author: "홍길동", notes: "[260914 10:00 홍길동] 🗑 지운 글" });
  const r = ctx.csDeleteHandoffNote({
    id: "HB001", staff: "홍길동", raw: "[260914 10:00 홍길동] 🗑 지운 글",
  });
  check("★ 이미 지운 줄을 또 지워도 탈 없다", r.ok, true);
  check("그렇다고 말해 준다", /이미 지운/.test(r.message || ""), true);
}
{
  카드({ author: "홍길동", notes: "머리 없는 옛 줄" });
  const r = ctx.csDeleteHandoffNote({ id: "HB001", staff: "홍길동", raw: "머리 없는 옛 줄" });
  check("★ 작성자를 모르는 줄은 안 지운다", r.ok, false);
}


console.log("\n[빠르기] 한 번 누르면 한 번만 다녀온다");
{
  //  > "CS웹앱이 바로 반응을 안하고 한박자 느린데" / "클릭시 반응 자체가 느려"
  const hb = fs.readFileSync(path.join(뿌리, "csHandoffBoard.gs"), "utf8");
  const home = fs.readFileSync(path.join(뿌리, "home.html"), "utf8");

  check("★ 쓰기가 «바뀐 카드»를 함께 돌려준다",
    hb.includes("res.card = _cs_hb_rowToCard_(after, sheetRow);"), true);
  check("★ 한 곳(_cs_hb_withCard_)에 둔다 — 부르는 쪽마다 붙이면 하나는 빠진다",
    (hb.match(/res.card = _cs_hb_rowToCard_/g) || []).length, 1);
  check("★★ 지운 카드는 되읽지 않는다 (옆 카드가 올라온다)",
    hb.includes("if (res && res.ok && !res.deleted) {") && hb.includes("deleted: true,"), true);

  check("★ 화면은 그 한 장만 갈아 끼운다",
    home.includes("function hbApplyCard(card) {"), true);
  check("★ 못 갈아 끼우면 옛길(전체 새로고침)로 간다",
    home.includes("if (!hbApplyCard(res && res.card)) hbReloadBoards();"), true);
  check("★ 전체 새로고침은 뒤에서 조용히",
    home.includes("loadHandoffBoard(false, true);   // silent"), true);
  check("★ 연달아 눌러도 마지막 한 번만 돈다",
    home.includes("if (HB_RELOAD_T) clearTimeout(HB_RELOAD_T);"), true);
  check("★ 카드 «삭제»는 빠른 길을 안 탄다",
    home.includes("hbReloadBoards();   // 카드가 통째로 사라졌다"), true);

  const 토글전체 = home.slice(home.indexOf("function toggleHbCard("),
    home.indexOf("function toggleHbCard(") + 2000);
  //  클릭 즉시 도는 부분만 본다. 그 뒤(읽음 기록 성공 처리)는 서버를 다녀온
  //  뒤라 클릭 반응과 상관이 없고, 거기선 읽음 표시가 실제로 바뀐다.
  const 토글 = 토글전체.slice(0, 토글전체.indexOf("if (wasOpen) return;"));
  check("★★ 카드를 열 때 목록을 다시 안 그린다",
    토글.indexOf("hbRenderCardModal();") >= 0 && 토글.indexOf("hbRenderBoards();") < 0, true);
  check("★ 필터 토글은 목록이 실제로 바뀌니 전체 렌더가 맞다",
    home.includes("      HB_UNREAD = !HB_UNREAD;"), true);
  check("★ 목록 렌더러는 HB_OPEN_ID 를 안 본다 (그래서 다시 그릴 까닭이 없다)",
    home.slice(home.indexOf("function renderHandoffBoard()"),
      home.indexOf("function renderHandoffBoard()") + 6000).includes("HB_OPEN_ID"), false);
}

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
