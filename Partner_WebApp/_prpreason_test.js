/**
 * 업체 포털 반품 접수 — 귀책·사유 · 세 화면이 갈라지지 않는가
 *
 *  > "당장드림 반품 현황도 위 사유에 대한 내용이 적용되야 할꺼 같아"
 *
 *  ★ 접수하는 자리가 셋이다 ★
 *    CS 반품탭 「+ 반품 접수」          CS_WebApp/home.html   RET_*
 *    CS 주문송장조회 「반품대장 기록」   같은 파일, 같은 표
 *    업체 포털 「새로 만들기」          Partner_WebApp/prpConfig.gs  PRP_RETURN_*
 *    셋이 «한 대장»(반품관리대장)에 적는다. 낱말이 갈라지면 나중에 세지도
 *    못하고 견주지도 못한다.
 *
 *  ★ 스크립트 프로젝트가 달라 변수를 나눠 쓸 수 없다 ★
 *    CS웹앱과 포털은 서로 다른 Apps Script 프로젝트다. 표를 두 벌 두는 것을
 *    피할 수 없다. 그래서 이 시험이 «두 파일의 표를 글자까지 견준다» —
 *    한쪽만 고치면 여기서 틀린다. 그것이 이 시험의 첫 일이다.
 *
 *  ★ 2026-09-30 에 업체 유형을 CS 와 맞췄다 ★
 *    전: 단순반품·교환·불량반품·오배송·부분반품 (5개)  →  후: CS 와 같은 8개
 *    없어진 두 낱말은 갈 곳이 있다 —
 *      불량반품 → 유형 「반품」 + 사유 「불량」(판매자 귀책)
 *      부분반품 → 유형 「반품」 + 전달 사항에 어느 품목인지
 *
 * 실행: node _prpreason_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const 여기 = __dirname;
const CS = path.join(여기, "..", "CS_WebApp");
const cfg = fs.readFileSync(path.join(여기, "prpConfig.gs"), "utf8");
const api = fs.readFileSync(path.join(여기, "prpApi.gs"), "utf8");
const led = fs.readFileSync(path.join(여기, "prpLedger.gs"), "utf8");
const portal = fs.readFileSync(path.join(여기, "portal.html"), "utf8");
const csHtml = fs.readFileSync(path.join(CS, "home.html"), "utf8");
const csGs = fs.readFileSync(path.join(CS, "csOrderSearch.gs"), "utf8");

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
/** 소스에서 `var 이름 = [..]` 또는 `= {..}` 를 뽑아 값으로 만든다 */
function 값(src, 이름, 닫는) {
  const i = src.indexOf("var " + 이름 + " = " + (닫는 === "}" ? "{" : "["));
  if (i < 0) throw new Error(이름 + " 를 못 찾음");
  const e = src.indexOf(닫는 + ";", i);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(i, e + 2), ctx);
  return ctx[이름];
}

const P_TYPES = 값(cfg, "PRP_RETURN_TYPES", "]");
const P_FAULTS = 값(cfg, "PRP_RETURN_FAULTS", "]");
const P_REASONS = 값(cfg, "PRP_RETURN_REASONS", "}");
const C_TYPES = 값(csHtml, "RET_TYPES", "]");
const C_FAULTS = 값(csHtml, "RET_FAULTS", "]");
const C_REASONS = 값(csHtml, "RET_REASONS", "}");

console.log("\n─── ① 포털과 CS웹앱의 표가 «글자까지» 같은가 ───");
/*  이 시험이 틀리면 한쪽만 고친 것이다. 두 곳을 같이 고친다 —
    CS_WebApp/home.html 의 RET_* · Partner_WebApp/prpConfig.gs 의 PRP_RETURN_*  */
ok("유형 8개가 같다", P_TYPES.join("·") === C_TYPES.join("·"),
  "\n         포털: " + P_TYPES.join("·") + "\n         CS  : " + C_TYPES.join("·"));
ok("귀책이 같다", P_FAULTS.join("·") === C_FAULTS.join("·"),
  "포털 " + P_FAULTS.join("·") + " / CS " + C_FAULTS.join("·"));
ok("사유 표의 귀책 열쇠가 같다",
  Object.keys(P_REASONS).sort().join("·") === Object.keys(C_REASONS).sort().join("·"),
  Object.keys(P_REASONS).join("·") + " / " + Object.keys(C_REASONS).join("·"));
Object.keys(C_REASONS).forEach((f) => {
  ok(f + " 사유가 같다", (P_REASONS[f] || []).join("·") === C_REASONS[f].join("·"),
    "\n         포털: " + (P_REASONS[f] || []).join("·") + "\n         CS  : " + C_REASONS[f].join("·"));
});

console.log("\n─── ② 사장님이 말한 낱말 그대로인가 ───");
const 시킨것 = {
  구매자: ["자동반품", "단순변심", "오입력"],
  판매자: ["오배송", "제품파손", "사고", "불량",
    "배송지연", "정보불일치", "중복출고", "품절", "상품하자"],
};
Object.keys(시킨것).forEach((f) => {
  ok(f + " " + 시킨것[f].length + "개", (P_REASONS[f] || []).join("·") === 시킨것[f].join("·"),
    (P_REASONS[f] || []).join("·"));
});
/*  물건이 깨지거나 늦은 것은 «우리(또는 택배사) 탓»이다 — 구매자 쪽에 두면
    반품비를 고객에게 물리게 된다. 귀책이 곧 돈이라 이 가름이 값을 정한다.  */
ok("오배송·파손·사고·불량·배송지연은 판매자 쪽이다", ["오배송", "제품파손", "사고", "불량", "배송지연"]
  .every((w) => P_REASONS.판매자.indexOf(w) >= 0 && P_REASONS.구매자.indexOf(w) < 0));
ok("구매자 쪽은 셋뿐 — 자동반품·단순변심·오입력",
  P_REASONS.구매자.join("·") === "자동반품·단순변심·오입력", P_REASONS.구매자.join("·"));
ok("두 목록에 겹치는 낱말이 없다",
  P_REASONS.구매자.filter((x) => P_REASONS.판매자.indexOf(x) >= 0).length === 0);

console.log("\n─── ③ 없어진 업체 낱말 ───");
/*  이미 대장에 적힌 옛 낱말은 그대로 둔다. 고르는 목록만 바뀐다. */
["불량반품", "부분반품"].forEach((w) => {
  ok("「" + w + "」은 고르는 목록에서 빠졌다", P_TYPES.indexOf(w) < 0, P_TYPES.join("·"));
});
ok("「불량」이 사유에 있다 (불량반품이 갈 곳)", P_REASONS.판매자.indexOf("불량") >= 0);
ok("바뀐 까닭이 적혀 있다", /불량반품 → 유형은 「반품」/.test(cfg));

console.log("\n─── ④ 서버가 화면에 내려 주는가 ───");
ok("faults 를 내려 준다", /faults: PRP_RETURN_FAULTS/.test(api));
ok("reasons 를 내려 준다", /reasons: PRP_RETURN_REASONS/.test(api));
ok("화면이 서버 것으로 갈아 쓴다",
  /if \(res\.faults && res\.faults\.length\) FAULTS = res\.faults;/.test(portal) &&
  /if \(res\.reasons\) REASONS = res\.reasons;/.test(portal));
ok("서버가 안 줄 때의 대비값이 있다", /var FAULTS = \['구매자', '판매자'\];/.test(portal));
/*  ★ 넷째 자리 ★  (2026-09-30)
    portal.html 의 대비값도 «낱말을 적어 둔 자리»다. 2026-09-30 에 사유를
    다시 가를 때 prpConfig 만 고치고 이것을 빠뜨렸다 — 여기서 걸렸다.  */
ok("화면의 대비값이 서버 표와 같다", (function () {
  const i = portal.indexOf("    var REASONS = {");
  const ctx2 = {};
  vm.createContext(ctx2);
  vm.runInContext(portal.slice(i, portal.indexOf("};", i) + 2), ctx2);
  return Object.keys(P_REASONS).every((f) =>
    (ctx2.REASONS[f] || []).join("·") === P_REASONS[f].join("·"));
})(), "prpConfig 와 portal.html 의 대비값이 갈라졌다");

/* ── 화면 흉내 ───────────────────────────────────────────────── */
const hctx = { console, esc: (v) => String(v == null ? "" : v) };
vm.createContext(hctx);
["FAULTS", "REASONS"].forEach((n) => {
  const i = portal.indexOf("    var " + n + " = ");
  const e = portal.indexOf(n === "FAULTS" ? "];" : "};", i);
  vm.runInContext(portal.slice(i, e + 2), hctx);
});
vm.runInContext(꺼내(portal, "fillReasons"), hctx);
function 가짜화면(귀책값, 사유값) {
  const 칸 = {
    nFault: { value: 귀책값 === undefined ? "" : 귀책값 },
    nReason: { value: 사유값 === undefined ? "" : 사유값, innerHTML: "" },
  };
  hctx.el = (id) => 칸[id] || null;
  return 칸;
}
const 고를수있는것 = (el) =>
  (el.innerHTML.match(/value="([^"]*)"/g) || []).map((m) => m.slice(7, -1));

console.log("\n─── ⑤ 귀책을 고르면 사유 목록이 바뀐다 ───");
let 칸 = 가짜화면("구매자");
hctx.fillReasons();
let 것 = 고를수있는것(칸.nReason);
ok("맨 앞은 빈 값 (비워 둘 수 있다)", 것[0] === "", JSON.stringify(것[0]));
ok("빈칸 안내가 보인다", /비워도 됩니다/.test(칸.nReason.innerHTML));
ok("구매자 8개", 것.slice(1).join("·") === 시킨것.구매자.join("·"), 것.slice(1).join("·"));
칸.nFault.value = "판매자";
hctx.fillReasons();
ok("판매자 3개", 고를수있는것(칸.nReason).slice(1).join("·") === 시킨것.판매자.join("·"),
  고를수있는것(칸.nReason).slice(1).join("·"));

console.log("\n─── ⑥ 잘못 눌렀다 되돌려도 적은 것이 안 날아간다 ───");
칸 = 가짜화면("구매자", "단순변심");
hctx.fillReasons();
ok("같은 귀책이면 그대로", 칸.nReason.value === "단순변심", 칸.nReason.value);
칸.nFault.value = "판매자";
hctx.fillReasons();
ok("없는 낱말이면 비워진다", 칸.nReason.value === "", 칸.nReason.value);
칸 = 가짜화면("아무거나", "단순변심");
hctx.fillReasons();
ok("모르는 귀책이면 빈 목록만", 고를수있는것(칸.nReason).join("·") === "");
ok("칸이 사라지면 조용히 돌아간다", (function () {
  hctx.el = () => null;
  try { hctx.fillReasons(); return true; } catch (e) { return false; }
})());

console.log("\n─── ⑦ 목록에 없는 사유는 대장에 안 적는다 ───");
/*  업체 화면을 손보면 아무 글자나 보낼 수 있다. 서버가 목록으로 걸러야
    대장 낱말이 지켜진다. 자유 글은 「전달 사항」이 받는다. */
ok("사유를 목록으로 걸러 낸다", /if \(!있나\) reasonIn = "";/.test(api));
ok("귀책도 목록으로 걸러 낸다",
  /PRP_RETURN_FAULTS\.indexOf\(faultIn\) === -1\) faultIn = "";/.test(api));
ok("사유가 비면 귀책도 안 적는다", /if \(faultIn && reasonIn\)/.test(api));
/*  ★ 소스 글자를 집는 단정은 «다듬기»에 약하다 ★  (2026-10-04)
    아래 넷은 코드 한 줄을 글자 그대로 찾는다. 2026-10-02 에 그 줄들이
    「발생원인 한 칸」 설계(prpParseCause_·prpMakeCause_)로 바뀌면서
    넷 다 안 맞게 됐다 — 동작은 멀쩡한데 시험만 빨갰다.
    지금 코드에 맞추되 공백·줄바꿈에는 덜 매이게 적는다.  */
ok("전용 열이 있으면 열에 적는다",
  /if \(col\.fault >= 0 && faultIn\) row\[col\.fault\] = faultIn;/.test(api));
ok("없으면 비고에 남긴다", /faultToNotice = " 귀책: " \+ faultIn/.test(api));
ok("비고 줄에 태운다", /faultToNotice \+/.test(api));

console.log("\n─── ⑧ 적는 글자 모양이 CS웹앱과 같은가 ───");
/*  적는 데가 둘(CS·포털)인데 읽는 규칙은 하나여야 한다.  */
const gctx = { String, console };
vm.createContext(gctx);
vm.runInContext(꺼내(led, "prpFaultFromNotice_"), gctx);
vm.runInContext(꺼내(csGs, "_cs_faultFromNotice_"), gctx);
ok("두 되읽기 규칙이 같은 정규식이다",
  꺼내(led, "prpFaultFromNotice_").indexOf("귀책\\s*[:：]\\s*(구매자|판매자)") > 0 &&
  꺼내(csGs, "_cs_faultFromNotice_").indexOf("귀책\\s*[:：]\\s*(구매자|판매자)") > 0);
[["판매자", "오배송"], ["구매자", "오주문"]].forEach((쌍) => {
  const 포털줄 = "[260930 당장드림] 업체 포털 접수. [출처 확인됨] 장부에서 확인. 귀책: " +
    쌍[0] + " (" + 쌍[1] + "). 뚜껑이 깨졌습니다";
  ok("포털이 적은 줄을 포털이 읽는다 — " + 쌍[0],
    gctx.prpFaultFromNotice_(포털줄) === 쌍[0], gctx.prpFaultFromNotice_(포털줄));
  ok("포털이 적은 줄을 CS 도 읽는다 — " + 쌍[0],
    gctx._cs_faultFromNotice_(포털줄) === 쌍[0], gctx._cs_faultFromNotice_(포털줄));
  const CS줄 = "[260930 10:00 김진수] 고객 요청\n귀책: " + 쌍[0] + " (" + 쌍[1] + ")";
  ok("CS 가 적은 줄을 포털도 읽는다 — " + 쌍[0],
    gctx.prpFaultFromNotice_(CS줄) === 쌍[0], gctx.prpFaultFromNotice_(CS줄));
});
ok("귀책이 없으면 빈 값", gctx.prpFaultFromNotice_("업체 포털 접수. 고유ID p0930000012.") === "");
ok("빈 비고도 탈 없다", gctx.prpFaultFromNotice_("") === "" && gctx.prpFaultFromNotice_(null) === "");
ok("모르는 낱말은 안 받는다", gctx.prpFaultFromNotice_("귀책: 택배사") === "");

console.log("\n─── ⑨ 대장 열 지도 ───");
vm.runInContext(꺼내(led, "prpMapCols_"), gctx);
let c = gctx.prpMapCols_(["반품접수날짜", "접수자", "주문지", "고객명",
  "교환반품구분", "반품사유", "상태값"]);
ok("귀책 열이 없으면 -1", c.fault === -1, String(c.fault));
ok("사유는 찾는다", c.reason === 5, String(c.reason));
c = gctx.prpMapCols_(["반품접수날짜", "접수자", "주문지", "고객명",
  "교환반품구분", "반품사유", "귀책", "상태값"]);
ok("「귀책」 열이 생기면 찾는다", c.fault === 6, String(c.fault));
ok("사유가 귀책에 안 먹힌다", c.reason === 5, String(c.reason));
c = gctx.prpMapCols_(["반품귀책사유"]);
ok("「반품귀책사유」는 귀책으로 안 간다 (좁게 잡는다)", c.fault === -1, String(c.fault));
c = gctx.prpMapCols_(["귀책구분", "반품사유"]);
ok("「귀책구분」은 귀책 · 그 뒤 사유도 따로", c.fault === 0 && c.reason === 1,
  c.fault + "/" + c.reason);

console.log("\n─── ⑩ 업체 카드로 돌려주고 보여 준다 ───");
/*  귀책을 찾는 차례가 셋이다 — 전용 열 · 발생원인 앞부분 · 비고 표시.
    가운데 한 자리가 빠지면 협의된 배열에서 귀책이 통째로 사라진다. */
ok("귀책은 전용 열 → 발생원인 앞 → 비고, 세 자리를 차례로 본다",
  /fault: col\.fault >= 0[\s\S]*?prpParseCause_\(row\[col\.reason\]\)\.귀책[\s\S]*?prpFaultFromNotice_\(notice\)/.test(led));
ok("카드가 귀책을 낸다", (portal.match(/esc\(귀책\) \+ ' 귀책<\/em>/g) || []).length === 2,
  "사유와 함께 · 귀책만 — 두 갈래 다 있어야 한다");
ok("사유가 없고 귀책만 있어도 낸다", /} else if \(귀책\) \{/.test(portal));

console.log("\n─── ⑪ 화면이 서버로 같이 보낸다 ───");
ok("fault 를 보낸다", /fault: el\('nFault'\)\.value/.test(portal));
ok("reason 을 보낸다", /reason: el\('nReason'\)\.value/.test(portal));
ok("귀책을 바꾸면 사유를 다시 채운다",
  /el\('nFault'\)\.addEventListener\('change', fillReasons\);/.test(portal));
ok("두 select 에 <option> 이 박혀 있지 않다", (function () {
  return ["nFault", "nReason", "nType"].every((id) => {
    const i = portal.indexOf('<select id="' + id + '"');
    return i > 0 && !/<option/.test(portal.slice(i, portal.indexOf("</select>", i)));
  });
})());
ok("화면 열 때 귀책을 정한 뒤 사유를 채운다", (function () {
  const i = portal.indexOf("el('nFault').value = FAULTS[0]");
  const j = portal.indexOf("fillReasons();", i);
  return i > 0 && j > i;
})());
ok("유형 기본값도 화면에 안 박았다", /var TYPE_DEFAULT = '단순반품';/.test(portal) &&
  /if \(res\.types && res\.types\.length\) TYPE_DEFAULT = res\.types\[0\];/.test(portal));
ok("전달 사항 안내가 사유와 겹치지 않는다",
  !/placeholder="반품 사유, 특이사항/.test(portal), "옛 안내 글이 남아 있다");

console.log("\n─── ⑫ 사유도 비고 길을 탄다 · 두 프로젝트가 같게 읽는가 ───");
/*  202609 탭 실측(2026-09-30) — 대장에 「반품사유」 열이 «없다».
    적는 데가 둘(CS·포털)이고 읽는 데도 둘이다. 넷이 한 글자 모양을 써야 한다.  */
vm.runInContext(꺼내(led, "prpReasonFromNotice_"), gctx);
vm.runInContext(꺼내(csGs, "_cs_reasonFromNotice_"), gctx);
ok("사유는 발생원인 칸을 가르고, 칸이 없으면 비고에서 읽는다",
  /reason: col\.reason >= 0[\s\S]*?prpParseCause_\(row\[col\.reason\]\)\.사유[\s\S]*?prpReasonFromNotice_\(notice\)/.test(led));
/*  else-if 차례가 「귀책이 있으면 귀책 줄, 없으면 사유 줄」을 말한다.
    둘을 다 적으면 비고에 같은 말이 두 줄 쌓인다. */
ok("귀책이 비었을 때만 「사유: …」를 따로 적는다",
  /\} else if \(faultIn && reasonIn\) \{[\s\S]*?\} else if \(reasonIn\) \{[\s\S]*?사유: /.test(api));
[["귀책: 판매자 (오배송)", "판매자", "오배송"],
 ["[260930 당장드림] 업체 포털 접수. [출처 확인됨] 장부에서 확인. 귀책: 구매자 (단순변심). 뚜껑 깨짐", "구매자", "단순변심"],
 ["[260930 10:00 김진수] 고객 요청\n귀책: 판매자 (불량)", "판매자", "불량"],
 ["업체 포털 접수. 사유: 중복출고.", "", "중복출고"],
 ["반품송장: 600622029800", "", ""],
 ["", "", ""]].forEach(function (t) {
  const cf = gctx._cs_faultFromNotice_(t[0]), cr = gctx._cs_reasonFromNotice_(t[0]);
  const pf = gctx.prpFaultFromNotice_(t[0]), pr2 = gctx.prpReasonFromNotice_(t[0]);
  ok("「" + (t[0] || "(빈 비고)").replace(/\n/g, " ").slice(0, 30) + "…」 넷이 같게 읽는다",
    cf === t[1] && pf === t[1] && cr === t[2] && pr2 === t[2],
    "CS[" + cf + "/" + cr + "] 포털[" + pf + "/" + pr2 + "] 기대[" + t[1] + "/" + t[2] + "]");
});
ok("두 사유 읽기가 같은 정규식이다", (function () {
  const a = 꺼내(led, "prpReasonFromNotice_"), b = 꺼내(csGs, "_cs_reasonFromNotice_");
  const 뽑 = (s) => (s.match(/\/[^/\n]*귀책[^/\n]*\//g) || []).join("|");
  return 뽑(a) === 뽑(b) && 뽑(a).length > 0;
})());

console.log("\n" + (fail ? "❌" : "✅") + "  맞음 " + pass + " · 틀림 " + fail + "\n");
process.exit(fail ? 1 : 0);
