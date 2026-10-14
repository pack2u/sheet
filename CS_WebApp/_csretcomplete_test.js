/**
 * 반품관리 — 「완료」 상태와 완료처리 단추
 *
 *  > "웹앱의 반품관리 상태값 완료를 추가해서 완료처리 버튼을 눌러
 *  >  완료처리되게 해줘"
 *  > "이카운트 ok 를 완료로 보면되고 이카운트 입력이 필요없는 경우가
 *  >  있어서 처리완료 버튼이 필요한거야"
 *
 *  ★ 「완료」는 이카운트OK 의 «다음»이 아니라 나란한 끝이다 ★
 *    이카운트에 넣을 것이 없는 건을 닫는 말이다.
 *
 *  ★ 낱말이 적힌 자리가 셋이다 ★ 서버 표 · 화면 대비값 · 시트 드롭다운.
 *    하나라도 갈라지면 단추가 멈추거나 시트가 쓰기를 거절한다.
 *
 *  ★ 드롭다운은 달 탭마다 한 번만 건다 ★ 그래서 목록만 늘리면 이미 걸린
 *    탭은 옛 규칙 그대로라 「완료」를 거절한다. 열쇠 이름을 올려야 한다.
 *
 * 실행: node _csretcomplete_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; } else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const HTML = path.join(__dirname, "home.html");
const GS = path.join(__dirname, "csOrderSearch.gs");

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

/*  화면 쪽을 진짜 돌린다 — 글자 맞춰보기가 아니다.
    고친 소스를 넣어 깨 볼 수 있게 html·gs 를 받는다.  */
function 틀(html, gs) {
  const 부름 = { submit: [], toast: [], confirm: [] };
  const 칸 = { value: "접수" };          // 상태 <select> 흉내
  let 목록 = null;                        // 이 select 가 받아들이는 값들

  const ctx = {
    console,
    RETURN_ACTIVE_ROWS: [],
    returnStaffName: () => "김CS",
    toast: (m) => 부름.toast.push(String(m)),
    confirm: (m) => { 부름.confirm.push(String(m)); return ctx.__예; },
    submitReturnCompose: (i, mode) => 부름.submit.push(i + ":" + mode),
    document: {
      getElementById: (id) => (/^ret-status-/.test(id) ? 셀렉트 : null),
    },
    __예: true,
    __부름: 부름,
    __칸: 칸,
  };
  /*  ★ 진짜 <select> 처럼 군다 ★ 목록에 없는 값을 넣으면 «조용히 안 먹는다».
      이것이 바로 막으려는 함정이라, 흉내도 그렇게 내야 시험이 뜻이 있다.  */
  const 셀렉트 = {
    get value() { return 칸.value; },
    set value(v) { if (!목록 || 목록.indexOf(String(v)) >= 0) 칸.value = String(v); },
  };
  vm.createContext(ctx);

  /*  화면 대비값 — 이것이 곧 select 가 받아들이는 목록이다  */
  const i = html.indexOf("    var RETURN_STATUS_OPTS = [");
  const j = html.indexOf("];", i);
  vm.runInContext(html.slice(i, j + 2), ctx);
  목록 = ctx.RETURN_STATUS_OPTS.slice();

  ["isReturnCardDone", "retDoneBtnHtml", "retCompleteNow"].forEach((n) => {
    vm.runInContext(꺼내(html, n), ctx);
  });
  return ctx;
}

const html0 = fs.readFileSync(HTML, "utf8");
const gs0 = fs.readFileSync(GS, "utf8");

function 재보기(html, gs) {
  const 운것 = [];
  try {
    const ctx = 틀(html, gs);

    /* ① 세 자리가 안 갈라졌나 */
    if (ctx.RETURN_STATUS_OPTS.indexOf("완료") < 0) 운것.push("①화면대비값에완료");
    if (!/_CS_RETURN_STATUS_OPTS_ = \[[^\]]*"완료"[^\]]*\]/.test(gs)) 운것.push("①서버표에완료");
    if (ctx.RETURN_STATUS_OPTS.join("·") !==
      "접수·반품송장·입고검수·이카운트OK·완료") 운것.push("①두목록이같다");

    /* ② 시트 드롭다운을 다시 걸게 했나 — 안 올리면 시트가 거절한다 */
    if (!/_CS_RET_DV_PROP_ = "CS_RET_DV2_"/.test(gs)) 운것.push("②DV열쇠올림");
    if (!/requireValueInList\(_CS_RETURN_STATUS_OPTS_/.test(gs)) 운것.push("②규칙이표를쓴다");

    /* ③ 단추가 단추줄에 붙었나
       ★ 「부르는 자리」를 집는다 ★ 함수 «정의»에도 같은 글자가 있어서
         retDoneBtnHtml(idx, c) 만 찾으면 단추줄에서 빼도 정의가 걸려
         늘 통과했다 — 깨 보고 알았다 (2026-10-14). 뒤의 ' +' 가 부르는 자리다. */
    if (!/retDoneBtnHtml\(idx, c\) \+/.test(html)) 운것.push("③단추줄에붙음");

    /* ④ 진행 중인 건에는 단추가 나온다 */
    const 열린것 = { name: "홍길동", status: "입고검수" };
    if (!/완료처리/.test(ctx.retDoneBtnHtml(0, 열린것))) 운것.push("④진행건에단추");

    /* ⑤ 이미 끝난 건에는 안 나온다 */
    if (ctx.retDoneBtnHtml(0, { name: "A", status: "이카운트OK" }) !== "") 운것.push("⑤이카운트OK건");
    if (ctx.retDoneBtnHtml(0, { name: "A", status: "완료" }) !== "") 운것.push("⑤완료건");

    /* ⑥ 누르면 — 확인을 묻고, 상태 길로 보낸다 */
    ctx.RETURN_ACTIVE_ROWS = [열린것];
    ctx.__예 = true; ctx.__칸.value = "접수";
    ctx.__부름.submit.length = 0; ctx.__부름.confirm.length = 0;
    ctx.retCompleteNow(0);
    if (ctx.__부름.confirm.length !== 1) 운것.push("⑥확인을묻는다");
    if (!/홍길동/.test(ctx.__부름.confirm[0] || "")) 운것.push("⑥누구건인지말한다");
    if (ctx.__칸.value !== "완료") 운것.push("⑥상태를완료로");
    if (ctx.__부름.submit.join() !== "0:status") 운것.push("⑥상태길로보낸다");

    /* ⑦ 아니오를 누르면 아무 일도 없다 */
    ctx.__예 = false; ctx.__칸.value = "접수";
    ctx.__부름.submit.length = 0;
    ctx.retCompleteNow(0);
    if (ctx.__부름.submit.length !== 0) 운것.push("⑦아니오면안보냄");
    if (ctx.__칸.value !== "접수") 운것.push("⑦아니오면안바꿈");

    /* ⑧ ★ 목록에 「완료」가 없으면 멈춘다 ★
       옛 배포가 내려 준 목록에는 넷뿐이다. 그때 대입이 안 먹는데 그대로
       보내면 «누른 적 없는 상태»가 저장된다. */
    const 옛 = 틀(html.replace(
      /var RETURN_STATUS_OPTS = \[[^\]]*\]/,
      "var RETURN_STATUS_OPTS = ['접수','반품송장','입고검수','이카운트OK']"), gs);
    옛.RETURN_ACTIVE_ROWS = [열린것];
    옛.__예 = true; 옛.__칸.value = "접수";
    옛.retCompleteNow(0);
    if (옛.__부름.submit.length !== 0) 운것.push("⑧완료없으면안보냄");
    if (!/완료.*없습니다|배포/.test(옛.__부름.toast.join(" "))) 운것.push("⑧왜멈췄는지말함");

    /* ⑨ 담당자가 없으면 멈춘다 */
    const 무명 = 틀(html, gs);
    무명.returnStaffName = () => "";
    vm.runInContext("returnStaffName = function(){return '';}", 무명);
    무명.RETURN_ACTIVE_ROWS = [열린것];
    무명.__예 = true;
    무명.retCompleteNow(0);
    if (무명.__부름.submit.length !== 0) 운것.push("⑨담당자없으면안보냄");
    if (무명.__부름.confirm.length !== 0) 운것.push("⑨담당자없으면안묻음");

    /* ⑩ 서버·화면이 완료를 «완료»로 읽는다 */
    if (!ctx.isReturnCardDone({ status: "완료" })) 운것.push("⑩화면이완료로읽음");
    if (!/if \(s === "완료" \|\| s\.indexOf\("완료"\) === 0\) return true;/.test(gs))
      운것.push("⑩서버가완료로읽음");
    if (!/\/완료\|환불\/\.test\(s\)\) return 3;/.test(gs)) 운것.push("⑩단계가3");
  } catch (e) {
    운것.push("터짐:" + e.message);
  }
  return 운것;
}

console.log("─ 반품 완료처리 ─\n");
const 운것 = 재보기(html0, gs0);
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) { pass = 24; }
console.log((fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과"));

/*  ═══ 일부러 깨 본다 ═══  */
console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const 깨기 = [
  ["화면 대비값에서 완료를 뺀다", (h, g) => [h.replace(
    /var RETURN_STATUS_OPTS = \[[^\]]*\]/,
    "var RETURN_STATUS_OPTS = ['접수','반품송장','입고검수','이카운트OK']"), g]],
  ["서버 표에서 완료를 뺀다", (h, g) => [h, g.replace(
    '"접수", "반품송장", "입고검수", "이카운트OK", "완료"',
    '"접수", "반품송장", "입고검수", "이카운트OK"')]],
  ["DV 열쇠를 안 올린다", (h, g) => [h, g.replace('_CS_RET_DV_PROP_ = "CS_RET_DV2_"', '_CS_RET_DV_PROP_ = "CS_RET_DV_"')]],
  ["단추를 단추줄에서 뺀다", (h, g) => [h.replace("retDoneBtnHtml(idx, c) +", ""), g]],
  ["끝난 건에도 단추를 낸다", (h, g) => [h.replace(
    "if (!c || isReturnCardDone(c)) return '';", "if (!c) return '';"), g]],
  ["확인을 안 묻는다", (h, g) => [h.replace(/if \(!confirm\('「' \+ 누구[\s\S]*?return;/, ""), g]],
  ["안 먹었는지 확인하지 않는다", (h, g) => [h.replace(
    /if \(String\(sel\.value \|\| ''\)\.trim\(\) !== '완료'\) \{[\s\S]*?\n      \}/, ""), g]],
  ["담당자 확인을 뺀다", (h, g) => {
    const i = h.indexOf("function retCompleteNow(");
    const j = h.indexOf("var 누구", i);
    const k = h.indexOf("if (!returnStaffName())", i);
    if (i < 0 || j < 0 || k < 0 || k > j) return [h, g];
    return [h.slice(0, k) + h.slice(j), g];
  }],
];

let 안움 = 0;
for (const [이름, f] of 깨기) {
  const [h, g] = f(html0, gs0);
  if (h === html0 && g === gs0) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운 = 재보기(h, g);
  if (운.length) console.log("  ✔ 울었다 [" + 운.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(fail || 안움 ? 1 : 0);
