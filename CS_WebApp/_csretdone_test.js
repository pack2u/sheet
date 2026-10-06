/**
 * 반품 검색 — 완료된 건도 찾는다 (45일)
 *
 *  > "반품 검색시 완료된건은 아나와서 접수가 안된거로 파악이 되서
 *  >  다시 만드는경우가 생기네.. 검색에서 완료된것도 보이면 좋겠어..
 *  >  최대 기한이 45일로 하면 어떨까?"
 *
 *  ★ 목록과 검색은 다른 일을 한다 ★
 *    목록(검색 없을 때) = 할 일 → 진행 30일만. 완료를 늘 섞으면 할 일이 묻힌다.
 *    검색             = 찾기   → 완료 45일까지 함께 뒤진다.
 *
 *  ★ RETURN_ALL_ROWS 에 섞지 않는다 ★
 *    여러 곳에서 그 길이를 「진행 건수」로 센다(뱃지·요약·집중보기).
 *    완료를 섞으면 그 숫자가 다 틀어진다. 그래서 RETURN_DONE_ROWS 를 따로 두고
 *    검색할 때만 이어 붙인다.
 *
 * 실행: node _csretdone_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
const gs = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");
function 꺼내(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

console.log("\n─── ① 45일이 한 곳에서만 정해지는가 ───");
ok("_CS_RETURN_DONE_DAYS_ 가 45", /var _CS_RETURN_DONE_DAYS_ = 45;/.test(gs));
ok("서버가 그 값을 화면에 내려 준다", /doneDays: _CS_RETURN_DONE_DAYS_/.test(gs));
ok("화면이 서버 값으로 갈아 쓴다", /if \(res\.doneDays\) RETURN_DONE_DAYS = res\.doneDays;/.test(html));
ok("화면에 박힌 45 는 대비값 하나뿐",
  (html.match(/RETURN_DONE_DAYS = 45/g) || []).length === 1,
  "박힌 자리: " + (html.match(/RETURN_DONE_DAYS = 45/g) || []).length);

console.log("\n─── ② 서버가 완료 목록을 따로 내려 주는가 ───");
const 함수 = 꺼내(gs, "csListActiveReturnCases");
/*  ★ 「완료만」에서 「목록에 없는 줄」로 넓혔다 ★  (2026-10-06)

    완료만 담으면 «진행인데 30일보다 오래된» 줄이 두 묶음 어디에도 없어
    검색으로 영영 못 찾았다 — rows 는 진행 30일이고 이 목록은 완료만이었다.
    실측: 202608 의 45일 안 96건 가운데 진행 36건이 그랬다.

    넓히면서도 «두 번 보여 주지 않는» 성질은 지켜야 한다 — 그래서
    (탭, 행) 으로 목록에 이미 있는지 가린다.                           */
ok("목록에 «없는» 줄을 담는다 (완료 + 오래된 진행)",
  /목록에있나\[/.test(함수) && /if \(!목록에있나\[/.test(함수),
  "「완료만」으로 담으면 오래된 진행 건이 검색에서 사라진다");
ok("(탭, 행) 으로 가려 두 번 담지 않는다",
  /목록에있나\[String\(rows\[k\]\.tab\) \+ "\|" \+ String\(rows\[k\]\.row\)\] = true/.test(함수),
  "열쇠가 없으면 같은 줄이 목록과 검색에 둘 다 들어간다");
ok("완료만 담던 옛 줄은 없다",
  !/if \(!allRows\[i\]\.active\) doneRows\.push/.test(함수));
ok("doneRows 로 돌려준다", /doneRows: doneRows,/.test(함수));
ok("넓은 쪽 기간으로 «한 번만» 읽는다",
  /var wideDays = Math\.max\(days, _CS_RETURN_DONE_DAYS_\);/.test(함수) &&
  /_cs_loadReturnLedgerCases_\(wideDays, false, refresh\)/.test(함수));
ok("진행 목록은 따로 30일 그대로", /_cs_loadReturnLedgerCases_\(days, true, refresh\)/.test(함수));
ok("진행 건을 doneRows 에 또 담지 않는다", !/doneRows\.push\(rows/.test(함수));

console.log("\n─── ③ 접수 건수가 안 틀어졌는가 ───");
/*  기간을 30 → 45 로 넓혔다. 오늘·어제만 세므로 숫자는 같아야 한다.  */
ok("오늘·어제만 센다",
  /if \(ymd === todayYmd\) intakeToday\+\+;/.test(함수) &&
  /else if \(ymd === ydayYmd\) intakeYesterday\+\+;/.test(함수));
ok("기간으로 세지 않는다", !/intakeToday \+= /.test(함수));

/* ── 화면 흉내 ───────────────────────────────────────────────── */
const ctx = {
  /*  ★ 단계 거르기 ★  (2026-10-04)
      renderReturnActiveList 이 RETURN_STAGE_FILTER 를 보게 된 뒤 이 시험은
      ReferenceError 로 터져 ④부터 통째로 안 돌았다. 빈 값은 «안 거른다»는
      뜻이라, 진행/완료 가름을 재는 이 시험의 전제와 맞는다.  */
  RETURN_STAGE_FILTER: "",
  /*  ★ 담당자 거르기·단계 칩 ★  (2026-10-04)
      같은 까닭으로 둘 더 생겼다. 그리는 쪽 일이라 이 시험의 것이 아니다 —
      빈 값·아무 일 안 하는 것으로 둔다. 거르기 자체는 ④~⑤가 따로 잰다.  */
  RETURN_STAFF_FILTER: "",
  retFillStaffPick: () => {},
  retStageChipsHtml: () => "",
  console, JSON, String, Number, Array, Math,
  RETURN_ALL_ROWS: [], RETURN_DONE_ROWS: [], RETURN_DONE_DAYS: 45,
  RETURN_QUERY: "", RETURN_ACTIVE_ROWS: [], RETURN_SORT: "new", RETURN_SHOW_LIMIT: 30,
  RET_PHOTO_PEND: {},
  //  걸러기·정렬은 이 시험의 일이 아니다 — 있는 그대로 흘려보낸다
  filterReturnRows: (rows, q) => !q ? rows.slice()
    : rows.filter((r) => String(r.name || "").indexOf(q) >= 0),
  sortReturnRows: (rows) => rows.slice(),
  clearReturnFocus: () => {},
  esc: (v) => String(v == null ? "" : v),
  setReturnStatus: (h) => { ctx.찍힌상태 = h; },
  retCardsHtml: () => "",
  csSyncScrollbars: () => {},
  찍힌머리: "", 찍힌상태: "",
};
ctx.document = {
  getElementById: (id) => {
    if (id === "returnActiveList") return { innerHTML: "", scrollTop: 0 };
    if (id === "returnHeadLabel") return { set textContent(v) { ctx.찍힌머리 = v; }, get textContent() { return ctx.찍힌머리; } };
    if (id === "retSort") return { value: "new" };
    return null;
  },
};
vm.createContext(ctx);
/*  renderReturnActiveList 는 카드 그리기까지 하니, 앞 절반(고르는 부분)만
    떼어 돌린다 — 「무엇을 뒤지나」가 이 시험이 볼 것이다.  */
const 본문 = 꺼내(html, "renderReturnActiveList");
const 자른것 = 본문.slice(0, 본문.indexOf("if (!filtered.length) {")) + "\n}";
vm.runInContext(자른것, ctx);

const 줄 = (name, active, tab) => ({ name: name, active: active, tab: tab || "202609", row: 2 });

console.log("\n─── ④ 검색이 없으면 진행 건만 ───");
ctx.RETURN_DONE_ROWS = [줄("김완료", false), 줄("이완료", false)];
ctx.RETURN_QUERY = "";
ctx.renderReturnActiveList([줄("박진행", true), 줄("최진행", true)]);
ok("진행 2건만 보인다", ctx.RETURN_ACTIVE_ROWS.length === 2, String(ctx.RETURN_ACTIVE_ROWS.length));
ok("완료가 안 섞였다", ctx.RETURN_ACTIVE_ROWS.every((r) => r.active === true));
ok("머리글은 「진행 중 반품」", /진행 중 반품 \(2건\)/.test(ctx.찍힌머리), ctx.찍힌머리);
ok("검색하면 완료도 찾는다고 알려 준다", /검색하면 완료된 건도 찾습니다\(45일\)/.test(ctx.찍힌상태), ctx.찍힌상태);

console.log("\n─── ⑤ 검색하면 완료까지 뒤진다 ───");
ctx.RETURN_QUERY = "완료";
ctx.renderReturnActiveList([줄("박진행", true), 줄("최진행", true)]);
ok("완료 2건을 찾았다", ctx.RETURN_ACTIVE_ROWS.length === 2, String(ctx.RETURN_ACTIVE_ROWS.length));
ok("찾은 것이 완료 건이다", ctx.RETURN_ACTIVE_ROWS.every((r) => r.active === false));
ok("머리글이 완료 수를 말해 준다", /반품 검색 2건 \(완료 2\)/.test(ctx.찍힌머리), ctx.찍힌머리);
ok("상태줄이 45일을 말해 준다", /완료 2건 포함 \(45일\)/.test(ctx.찍힌상태), ctx.찍힌상태);

ctx.RETURN_QUERY = "진행";
ctx.renderReturnActiveList([줄("박진행", true), 줄("최진행", true)]);
ok("진행만 맞으면 완료 수는 안 적는다", !/완료/.test(ctx.찍힌머리), ctx.찍힌머리);
ok("그때 상태줄에도 안 적는다", !/완료/.test(ctx.찍힌상태), ctx.찍힌상태);

console.log("\n─── ⑥ RETURN_ALL_ROWS 를 건드리지 않는다 ───");
/*  여러 곳에서 이 길이를 「진행 건수」로 센다. 검색이 그 수를 바꾸면 안 된다.  */
ctx.RETURN_QUERY = "완료";
ctx.renderReturnActiveList([줄("박진행", true), 줄("최진행", true)]);
ok("진행 목록은 2건 그대로", ctx.RETURN_ALL_ROWS.length === 2, String(ctx.RETURN_ALL_ROWS.length));
ok("진행 목록에 완료가 안 들어갔다", ctx.RETURN_ALL_ROWS.every((r) => r.active === true));
ok("머리글이 진행 건수를 따로 말해 준다", /진행 2건 중/.test(ctx.찍힌머리), ctx.찍힌머리);

console.log("\n─── ⑦ 완료 목록이 비었을 때 ───");
ctx.RETURN_DONE_ROWS = [];
ctx.RETURN_QUERY = "진행";
ctx.renderReturnActiveList([줄("박진행", true)]);
ok("탈 없이 돈다", ctx.RETURN_ACTIVE_ROWS.length === 1, String(ctx.RETURN_ACTIVE_ROWS.length));
ok("이어 붙이지 않는다", /RETURN_QUERY && RETURN_DONE_ROWS\.length/.test(html));

console.log("\n─── ⑧ 완료 카드를 한눈에 알아보게 ───");
ok("카드에 ret-closed 를 붙인다", /\(c\.active === false \? ' ret-closed' : ''\)/.test(html));
ok("「완료」 딱지를 붙인다", /ret-closed-tag">완료<\/span>/.test(html));
ok("두 모양 다 CSS 가 있다",
  /\.ret-card\.ret-closed \{/.test(html) && /\.ret-closed-tag \{/.test(html));
ok("지우지 않고 가라앉힌다 (읽을 수는 있다)", /opacity: \.72/.test(html));

console.log("\n─── ⑨ 완료 카드를 손대도 안 깨진다 ───");
/*  카드 동작은 RETURN_ACTIVE_ROWS(=검색 결과)를 쓰니 완료 카드도 제 줄을 가리킨다.
    낙관적 갱신만 RETURN_ALL_ROWS 를 뒤지는데, 못 찾으면 false 로 옛 길로 간다.  */
const loc = 꺼내(html, "retLocate");
ok("retLocate 는 진행 목록만 뒤진다", /RETURN_ALL_ROWS\.length/.test(loc) && !/RETURN_DONE_ROWS/.test(loc));
ok("왜 그런지 적혀 있다", /검색에 나온 «완료» 카드는 여기서 -1 이 된다/.test(html));
const opt = 꺼내(html, "retOptimistic");
ok("못 찾으면 false 로 옛 길로 간다", /var i = retLocate\(key\);\s*\r?\n\s*if \(i < 0\) return false;/.test(opt));
ok("카드 동작은 검색 결과를 쓴다",
  (html.match(/RETURN_ACTIVE_ROWS\[(idx|cardIdx)\]/g) || []).length >= 8,
  "쓰는 자리 " + (html.match(/RETURN_ACTIVE_ROWS\[(idx|cardIdx)\]/g) || []).length);

console.log("\n" + (fail ? "❌" : "✅") + "  맞음 " + pass + " · 틀림 " + fail + "\n");
process.exit(fail ? 1 : 0);
