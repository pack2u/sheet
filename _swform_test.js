/**
 * 선우 전용양식 = 준테크 양식
 *
 *  > "선우 전용양식을 cj대한통운 택배양식.xlsx으로 바꿔줘"
 *  > "준테크 양식과 똑같이 하면 되"
 *
 *  ★ 한 값에 주인은 셋이었다 ★
 *    양식의 «칸 이름»은 _PEP_EXCLUSIVE_FORM_HEADERS_ 가,
 *    그 칸에 «무엇을 적을지»는 _PEP_VENDOR_DIRECT_MAP_ 이,
 *    «새 업체 시트를 만들 때»는 _partnerDeploy.gs 의 headerCsv 가 정한다.
 *    하나만 고치면 이름은 받는분성명인데 값은 보내는분우편번호가 들어앉는다.
 *    셋이 늘 같은지 여기서 지킨다.
 *
 *  ★ 자리가 아니라 칸 이름으로 옮긴다 ★
 *    18칸 → 23칸이면서 순서까지 바뀐다(품목명 13→17, 박스타입 17→19).
 *    한 칸씩 미는 식으로는 못 맞춘다.
 *
 *  ★ 49·50 은 자리로 못 박혀 있다 ★
 *    49=엑셀발주(_PEO_MARK_COL_)·50=고유ID. 시트에 열을 끼우면 50·51 로
 *    밀려 통째로 깨진다. 양식 구역(1~48열) 안에서만 다시 쓴다.
 *
 * 실행: node _swform_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const src = fs.readFileSync(path.join(__dirname, "_partnerExclusivePush.gs"), "utf8");
const dep = fs.readFileSync(path.join(__dirname, "_partnerDeploy.gs"), "utf8");
function 꺼내(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

/** _PEP_EXCLUSIVE_FORM_HEADERS_ 에서 한 업체의 칸 이름을 읽어 온다 */
function 양식(pfx) {
  const 시작 = src.indexOf("var _PEP_EXCLUSIVE_FORM_HEADERS_");
  const i = src.indexOf("\n  " + pfx + ": [", 시작);
  if (i < 0) throw new Error(pfx + " 양식을 못 찾음");
  const e = src.indexOf("\n  ],", i);
  return src.slice(i, e).match(/"([^"]*)"/g).map((q) => q.slice(1, -1));
}
/** _PEP_VENDOR_DIRECT_MAP_ 에서 한 업체의 배선을 읽어 온다 */
function 배선(pfx) {
  const 시작 = src.indexOf("var _PEP_VENDOR_DIRECT_MAP_");
  const i = src.indexOf("\n  " + pfx + ": {", 시작);
  if (i < 0) throw new Error(pfx + " 배선을 못 찾음");
  let d = 0, seen = false, e = i;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) { e = k + 1; break; } }
  }
  const 몸 = src.slice(i, e);
  return {
    totalCols: Number((몸.match(/totalCols:\s*(\d+)/) || [])[1]),
    phones: (몸.match(/phoneTargetCols:\s*\[([^\]]*)\]/) || ["", ""])[1]
      .split(",").map((x) => x.trim()).filter(Boolean).join(","),
    쌍: (몸.match(/\{\s*sourceCol:\s*\d+,\s*targetCol:\s*\d+/g) || [])
      .map((m) => m.replace(/\s+/g, "")),
  };
}

const SW = 양식("SW"), JT = 양식("JT");

console.log("\n─── ① 선우 양식이 준테크와 한 글자도 안 다른가 ───");
ok("칸 수가 같다 (23칸)", SW.length === JT.length && SW.length === 23, SW.length + " vs " + JT.length);
let 다른칸 = "";
for (let i = 0; i < Math.max(SW.length, JT.length); i++) {
  if (SW[i] !== JT[i]) { 다른칸 = (i + 1) + "번째 「" + SW[i] + "」 ≠ 「" + JT[i] + "」"; break; }
}
ok("칸 이름이 전부 같다", !다른칸, 다른칸);
ok("1=송장번호 · 2=이슈 (우리 내부 칸)", SW[0] === "송장번호" && SW[1] === "이슈");
ok("3=예약구분 (준테크에만 있던 칸)", SW[2] === "예약구분", SW[2]);
ok("마지막=운임구분", SW[22] === "운임구분", SW[22]);
ok("내품명은 없어졌다", SW.indexOf("내품명") < 0);

console.log("\n─── ② 배선도 준테크와 같은가 (머리글만 고치면 값이 어긋난다) ───");
const bSW = 배선("SW"), bJT = 배선("JT");
ok("totalCols 23 으로 같다", bSW.totalCols === 23 && bJT.totalCols === 23, bSW.totalCols + " vs " + bJT.totalCols);
ok("totalCols 가 칸 수와 맞는다", bSW.totalCols === SW.length, bSW.totalCols + " vs " + SW.length);
ok("전화 칸이 같다", bSW.phones === bJT.phones, bSW.phones + " vs " + bJT.phones);
ok("판매현황→양식 짝이 전부 같다", bSW.쌍.join("|") === bJT.쌍.join("|"),
  bSW.쌍.join("|") + "\n         " + bJT.쌍.join("|"));
ok("받는분성명은 10번째(J)로 간다", bSW.쌍.indexOf("{sourceCol:12,targetCol:9") >= 0);
ok("품목명은 17번째(Q)로 간다", bSW.쌍.indexOf("{sourceCol:4,targetCol:16") >= 0);

console.log("\n─── ③ 새 업체 시트를 만들 때 쓰는 표도 같은가 ───");
const csv = (dep.match(/prefix: "SW", headerCsv: "([^"]*)"/) || [])[1] || "";
ok("_partnerDeploy 의 headerCsv 가 양식과 똑같다", csv === SW.join("|"),
  "\n         시트: " + csv + "\n         코드: " + SW.join("|"));

/* ── 시트 흉내 ───────────────────────────────────────────────── */
const _PEO_MARK_COL_ = 49;
function 가짜탭(줄들) {
  const grid = 줄들.map((r) => { const a = r.slice(); while (a.length < 1000) a.push(""); return a; });
  return {
    _grid: grid,
    getMaxColumns: () => 1000,
    getLastRow: () => grid.length,
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues: () => grid.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
        setValues(v) {
          for (let i = 0; i < v.length; i++) for (let j = 0; j < v[i].length; j++) grid[r - 1 + i][c - 1 + j] = v[i][j];
          return this;
        },
      };
    },
  };
}
const ctx = {
  String, Number, Array, Math, console, _PEO_MARK_COL_,
  _PEP_EXCLUSIVE_FORM_HEADERS_: { SW: SW, JT: JT },
  Logger: { log: () => {} },
  SpreadsheetApp: { flush: () => {} },
  _pep_findExclusiveFormTab_: (ss) => ss.__tab,
};
vm.createContext(ctx);
vm.runInContext(꺼내("_pep_syncExclusiveFormHeader_"), ctx);
const 맞춰 = (탭, pfx) => ctx._pep_syncExclusiveFormHeader_({ __tab: 탭 }, pfx || "SW");

/* 2026-08-25 ~ 09-29 에 쓰던 옛 18칸 양식 */
const 옛양식 = ["송장번호","이슈","보내는분성명","보내는분전화번호","보내는분기타연락처",
  "보내는분우편번호","보내는분주소(전체, 분할)","받는분성명","받는분전화번호",
  "받는분기타연락처","받는분우편번호","받는분주소(전체, 분할)","품목명","내품명",
  "박스수량","배송메세지1","박스타입","운임구분"];

console.log("\n─── ④ 오늘 들어 있는 발주 한 줄이 제자리로 가나 ───");
const 옛줄 = new Array(48).fill("");
옛줄[1] = "0928-2차";                                            // 이슈
옛줄[7] = "위드에프앤에스";                                       // 받는분성명
옛줄[8] = "010-3743-8874";                                       // 받는분전화번호
옛줄[11] = "경기 이천시 마장면 이장로311번길 91 롯데글로벌";        // 받는분주소
옛줄[12] = "미소 8호 1200개";                                     // 품목명
옛줄[14] = 10;                                                    // 박스수량
옛줄[15] = "배송 전에 미리 연락바랍니다.";                          // 배송메세지1
const 탭 = 가짜탭([옛양식.concat(new Array(30).fill("")), 옛줄]);
탭._grid[0][48] = "엑셀발주"; 탭._grid[0][49] = "고유ID";
탭._grid[1][48] = "2026-09-29 9:05"; 탭._grid[1][49] = "2165247835";

const r = 맞춰(탭);
ok("했다고 한다", r.했나 === true, r.왜);
ok("자료 1줄이라고 센다", r.줄수 === 1, String(r.줄수));
ok("옮긴 칸이 있다", r.옮긴칸 > 0, String(r.옮긴칸));

const 새머리 = 탭._grid[0], 새줄 = 탭._grid[1];
let 머리어디 = "";
for (let i = 0; i < SW.length; i++) if (String(새머리[i]) !== SW[i]) { 머리어디 = (i + 1) + "번째 " + 새머리[i]; break; }
ok("머리글 23칸이 코드와 똑같다", !머리어디, 머리어디);
ok("24번째 칸은 비었다", String(새머리[23] || "") === "", String(새머리[23]));

const 자리 = (이름) => SW.indexOf(이름);
ok("이슈는 2번째 그대로", 새줄[1] === "0928-2차", String(새줄[1]));
ok("받는분성명 → 10번째(J)", 새줄[자리("받는분성명")] === "위드에프앤에스", String(새줄[9]));
ok("받는분전화번호 → 11번째(K)", 새줄[자리("받는분전화번호")] === "010-3743-8874", String(새줄[10]));
ok("받는분주소 → 14번째(N)", String(새줄[자리("받는분주소(전체, 분할)")]).indexOf("이천시") >= 0, String(새줄[13]));
ok("품목명 → 17번째(Q)", 새줄[자리("품목명")] === "미소 8호 1200개", String(새줄[16]));
ok("박스수량 → 18번째(R)", 새줄[자리("박스수량")] === 10, String(새줄[17]));
ok("배송메세지1 → 21번째(U)", String(새줄[자리("배송메세지1")]).indexOf("미리 연락") >= 0, String(새줄[20]));
ok("새로 생긴 예약구분은 비어 있다", String(새줄[자리("예약구분")] || "") === "");
ok("새로 생긴 운송장번호는 비어 있다", String(새줄[자리("운송장번호")] || "") === "");
let 샌곳 = "";
for (let i = SW.length; i < 48; i++) if (String(새줄[i] || "") !== "") { 샌곳 = (i + 1) + "번째"; break; }
ok("23칸 뒤 48칸까지는 깨끗하다", !샌곳, 샌곳);

console.log("\n─── ⑤ 49·50 은 꿈쩍도 안 한다 ───");
ok("49 머리글 = 엑셀발주", 탭._grid[0][48] === "엑셀발주", String(탭._grid[0][48]));
ok("50 머리글 = 고유ID", 탭._grid[0][49] === "고유ID", String(탭._grid[0][49]));
ok("49 값이 그대로", 탭._grid[1][48] === "2026-09-29 9:05", String(탭._grid[1][48]));
ok("고유ID 가 그대로", 탭._grid[1][49] === "2165247835", String(탭._grid[1][49]));

console.log("\n─── ⑥ 두 번 돌려도 탈 없다 ───");
const r2 = 맞춰(탭);
ok("이미 같다고 한다", r2.했나 === false && r2.왜 === "이미 같습니다", r2.왜);
ok("받는분성명이 또 안 움직였다", 탭._grid[1][9] === "위드에프앤에스", String(탭._grid[1][9]));

console.log("\n─── ⑦ 잃을 값이 있으면 아예 안 한다 ───");
const 내품명있음 = new Array(48).fill("");
내품명있음[7] = "위드에프앤에스";
내품명있음[13] = "종이컵";                                        // 내품명 — 새 양식엔 없다
const 탭2 = 가짜탭([옛양식.concat(new Array(30).fill("")), 내품명있음]);
const r3 = 맞춰(탭2);
ok("손대지 않는다", r3.했나 === false, r3.왜);
ok("무엇이 걸렸는지 말해 준다", r3.잃을뻔.indexOf("내품명") >= 0, r3.잃을뻔.join("·"));
ok("그 값이 그대로 있다", 탭2._grid[1][13] === "종이컵");
ok("머리글도 옛것 그대로다", 탭2._grid[0][2] === "보내는분성명", String(탭2._grid[0][2]));

console.log("\n─── ⑧ 내품명이 «비어 있으면» 그냥 간다 ───");
const 탭3 = 가짜탭([옛양식.concat(new Array(30).fill("")), 옛줄.slice()]);
ok("내품명 칸이 비었다", String(탭3._grid[1][13] || "") === "");
ok("옮긴다", 맞춰(탭3).했나 === true);

console.log("\n─── ⑨ 머리글 없는 칸에 값이 흘러 있으면 안 한다 ───");
const 샌탭 = 가짜탭([옛양식.concat(new Array(30).fill("")), new Array(48).fill("")]);
샌탭._grid[1][30] = "어쩌다 들어간 값";
const r4 = 맞춰(샌탭);
ok("손대지 않는다", r4.했나 === false, r4.왜);
ok("몇 번째 칸인지 말해 준다", /31번째/.test(r4.왜), r4.왜);
ok("그 값이 그대로 있다", 샌탭._grid[1][30] === "어쩌다 들어간 값");

console.log("\n─── ⑩ 코드에 없는 업체 ───");
const r5 = 맞춰(가짜탭([["가"], [""]]), "없는업체");
ok("코드에 양식이 없다고 한다", r5.했나 === false && /양식이 없/.test(r5.왜), r5.왜);

console.log("\n─── ⑪ 허브 「업체전용양식마스터」도 코드를 따라오나 ───");
{
  function 꺼내D(name) {
    const i = dep.indexOf("function " + name + "(");
    if (i < 0) throw new Error(name + " 를 못 찾음");
    let d = 0, seen = false;
    for (let k = i; k < dep.length; k++) {
      if (dep[k] === "{") { d++; seen = true; }
      else if (dep[k] === "}") { d--; if (seen && d === 0) return dep.slice(i, k + 1); }
    }
    throw new Error(name + " 본문이 안 닫힘");
  }
  //  코드 내장표를 그대로 읽어 온다 — 시험이 표를 따로 베껴 두면 갈라진다
  const 표시작 = dep.indexOf("var EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_");
  const 내장 = dep.slice(표시작, dep.indexOf("\n];", 표시작))
    .match(/\{[^{}]*label:[^{}]*headerCsv:[^{}]*\}/g)
    .map((m) => ({
      label: m.match(/label: "([^"]*)"/)[1],
      headerCsv: m.match(/headerCsv: "([^"]*)"/)[1],
      //  옛이름도 같이 읽는다 — 이것을 빼먹으면 시험만 옛 이름을 못 찾는다
      옛이름: (m.match(/옛이름:\s*\[([^\]]*)\]/) || ["", ""])[1]
        .split(",").map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean),
    }));
  ok("내장표를 읽었다", 내장.length > 10, String(내장.length));

  const mctx = {
    String, Number, Array, Math, console,
    EMBEDDED_VENDOR_EXCLUSIVE_MASTER_ROWS_: 내장,
    VENDOR_EXCLUSIVE_TEMPLATE_MASTER_SHEET_NAME: "업체전용양식마스터",
    Logger: { log: () => {} },
    SpreadsheetApp: { flush: () => {} },
    normHubMappingHeader_: (v) => String(v == null ? "" : v).replace(/\s/g, ""),
  };
  vm.createContext(mctx);
  vm.runInContext(꺼내D("normVendorExclusiveTemplateKey_"), mctx);
  vm.runInContext(꺼내D("resolveVendorExclusiveTemplateColumns_"), mctx);
  vm.runInContext(꺼내D("_pep_templateRowNames_"), mctx);
  vm.runInContext(꺼내D("parseVendorExclusiveHeaderCsv_"), mctx);
  vm.runInContext(꺼내D("loadVendorExclusiveTemplateHeadersFromEmbedded_"), mctx);
  vm.runInContext(꺼내D("_pep_syncTemplateMasterFromCode_"), mctx);

  function 가짜마스터(줄들) {
    const grid = 줄들.map((r) => r.slice());
    const sh = {
      _grid: grid,
      getSheetByName: (n) => (n === "업체전용양식마스터" ? sh : null),
      getLastRow: () => grid.length,
      getLastColumn: () => 3,
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        return {
          getValues: () => grid.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
          setValues(v) {
            for (let i = 0; i < v.length; i++) for (let j = 0; j < v[i].length; j++) grid[r - 1 + i][c - 1 + j] = v[i][j];
            return this;
          },
        };
      },
    };
    return sh;
  }
  const 내장의 = (이름) => 내장.filter((x) => x.label === 이름)[0].headerCsv;

  /*  2026-09-29 아침에 C17 에 실제로 들어 있던 글자 */
  const 옛CSV = "송장번호|적요|사용안함|보내는분성명|보내는분전화번호|보내는분기타연락처|" +
    "보내는분우편번호|보내는분주소(전체, 분할)|받는분성명|받는분전화번호|받는분기타연락처|" +
    "받는분우편번호|받는분주소(전체, 분할)|품목명|내품명|박스수량|배송메세지1|박스타입|운임구분";
  const 마 = 가짜마스터([
    ["맞춤양식명", "품목접두(참고)", "전용양식헤더CSV(| 또는 탭 구분)"],
    ["올팩", "AP", 내장의("올팩")],
    ["선우", "SW", 옛CSV],
    ["누가손으로넣음", "", "가|나|다"],
  ]);
  const m = mctx._pep_syncTemplateMasterFromCode_(마);
  ok("한 줄 고쳤다고 한다", m.고친것.length === 1, m.고친것.join(" · ") + " / " + m.왜);
  ok("선우 줄이라고 말해 준다", /선우/.test(m.고친것[0] || ""), m.고친것[0]);
  ok("3행 C열이라고 말해 준다", /3행 C열/.test(m.고친것[0] || ""), m.고친것[0]);
  ok("19칸 → 23칸이라고 말해 준다", /19칸 → 23칸/.test(m.고친것[0] || ""), m.고친것[0]);
  ok("선우 칸이 양식과 똑같아졌다", 마._grid[2][2] === SW.join("|"), 마._grid[2][2]);
  ok("이미 맞던 올팩은 그대로", 마._grid[1][2] === 내장의("올팩"));
  ok("코드에 없는 줄은 손대지 않는다", 마._grid[3][2] === "가|나|다", 마._grid[3][2]);
  ok("머리글 줄은 안 건드린다", 마._grid[0][2] === "전용양식헤더CSV(| 또는 탭 구분)");
  ok("맞춤양식명 칸은 안 건드린다", 마._grid[2][0] === "선우" && 마._grid[2][1] === "SW");

  const m2 = mctx._pep_syncTemplateMasterFromCode_(마);
  ok("두 번 돌리면 이미 같다고 한다", m2.고친것.length === 0 && m2.왜 === "이미 같습니다", m2.왜);

  const 없는 = 가짜마스터([["맞춤양식명", "x", "헤더CSV"]]);
  없는.getSheetByName = () => null;
  ok("탭이 없으면 말해 준다", /탭이 없습니다/.test(mctx._pep_syncTemplateMasterFromCode_(없는).왜));
  ok("허브가 없으면 말해 준다", /허브 시트가 없/.test(mctx._pep_syncTemplateMasterFromCode_(null).왜));

  /*  뉴파츠 — 시트는 「뉴파츠」, 코드는 「뉴파츠_NEW」라 짝이 안 맞았다 (2026-09-30) */
  const 옛뉴="송장번호|적요|일자|순번|거래처코드|거래처명|담당자|출하창고|거래유형|통화|환율|참조|"+
    "결제조건|유효기간|납기일자|검색창내용|배송방식|수령인|수령인연락처|배송지주소|적요(배송메시지)|"+
    "품목코드|품목명|규격|수량|단가|금액1|외화금액|공급가액|부가세|납기일자|적요";
  const 뉴 = 가짜마스터([
    ["맞춤양식명", "품목접두(참고)", "전용양식헤더CSV(| 또는 탭 구분)"],
    ["뉴파츠", "HR", 옛뉴],
  ]);
  const mn = mctx._pep_syncTemplateMasterFromCode_(뉴);
  ok("뉴파츠도 짝이 맞는다", mn.고친것.length === 1, mn.고친것.join(" · ") + " / " + mn.왜);
  ok("뉴파츠 칸이 코드와 같아졌다", 뉴._grid[1][2] === 내장의("뉴파츠"), 뉴._grid[1][2]);
  ok("2번째가 이슈로", 뉴._grid[1][2].split("|")[1] === "이슈");
  ok("22·23번째가 변환품목코드·변환품목명으로",
    뉴._grid[1][2].split("|")[21] === "변환품목코드" && 뉴._grid[1][2].split("|")[22] === "변환품목명");
  ok("32칸 그대로다", 뉴._grid[1][2].split("|").length === 32, String(뉴._grid[1][2].split("|").length));

  //  옛이름으로 물어도 같은 양식이 나와야 한다 — 어딘가 설정에 남아 있을 수 있다
  const 새이름 = mctx.loadVendorExclusiveTemplateHeadersFromEmbedded_("뉴파츠");
  const 옛이름 = mctx.loadVendorExclusiveTemplateHeadersFromEmbedded_("뉴파츠_NEW");
  ok("새 이름으로 찾힌다", !!새이름 && 새이름.length === 32, String(새이름 && 새이름.length));
  ok("옛 이름으로도 찾힌다", !!옛이름 && 옛이름.length === 32, String(옛이름 && 옛이름.length));
  ok("둘이 같은 양식이다", (새이름||[]).join("|") === (옛이름||[]).join("|"));
  ok("없는 이름은 안 찾힌다", mctx.loadVendorExclusiveTemplateHeadersFromEmbedded_("없는양식") === null);
  ok("선우도 그대로 찾힌다", (mctx.loadVendorExclusiveTemplateHeadersFromEmbedded_("선우")||[]).join("|") === SW.join("|"));
}

console.log("\n─── ⑫ 「1행 글자만」 고치는 쪽이 49·50 을 안 지우나 ───");
const 수리 = 꺼내("partnerRepairExclusiveFormHeaders");
ok("지우는 범위를 _PEO_MARK_COL_ 앞에서 끊는다", /_PEO_MARK_COL_[^;]*\) - 1\)/.test(수리));
ok("lc 끝까지 쓸지 않는다", 수리.indexOf("1, lc - headers.length") < 0);

console.log("\n" + (fail ? "❌" : "✅") + "  맞음 " + pass + " · 틀림 " + fail + "\n");
process.exit(fail ? 1 : 0);
