/**
 * 반품비 — 그리고 ★ 두 벌이 된 판정 함수가 어긋나지 않는지 ★
 * 2026-09-08
 *
 *   node _csreturnfee_test.js
 *
 * 원본은 세트분리V2/core.js 의 ssFerryMatch·ssReturnFee 다.
 * Apps Script 프로젝트가 달라 함수를 못 부르므로 CS 웹앱에 같은 규칙을 옮겨 놨다.
 * **베낀 것을 감추지 않는다** — 여기서 두 구현을 같은 주소로 돌려 비교한다.
 * 한쪽만 고치면 이 시험이 깨진다. 어긋남은 곧 청구액 차이라 조용히 두면 안 된다.
 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + got + "\n       want " + want); }
};

// ── CS 웹앱 쪽 구현을 떼어 온다 (GAS 전역 API 는 흉내 낸다) ──
const gs = fs.readFileSync(path.join(__dirname, "csReturnFee.gs"), "utf8");
const FERRY = [
  { 시군: "통영시", 읍면동: "욕지면", 리: [], 료: 4000, 권역: "도서" },
  { 시군: "통영시", 읍면동: "산양읍", 리: ["연곡리", "저림리", "추도리"], 료: 4000, 권역: "도서" },
  { 시군: "제주",   읍면동: "우도면", 리: [], 료: 4000, 권역: "제주" },
  { 시군: "제주",   읍면동: "추자면", 리: [], 료: 5000, 권역: "제주" },
];
const sandbox = {
  Logger: { log() {} },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  SpreadsheetApp: { openById: () => { throw new Error("시험에서는 시트를 안 읽는다"); } },
};
const cs = new Function(
  "Logger", "CacheService", "SpreadsheetApp",
  gs + "\n; return { csReturnFeeFor, _crf_match_, _crf_isJeju_, _CRF_BOX_, _CRF_AIR_JEJU_ };"
)(sandbox.Logger, sandbox.CacheService, sandbox.SpreadsheetApp);

// 표를 못 읽는 자리를 시험용 표로 바꿔 끼운다
function feeOf(addr) {
  const hit = cs._crf_match_(addr, FERRY);
  const 도선료 = hit ? hit.료 : 0;
  const 항공료 = cs._crf_isJeju_(addr, hit) ? cs._CRF_AIR_JEJU_ : 0;
  return 항공료 + 도선료 + cs._CRF_BOX_;
}

// ── 원본(core.js) ──
const C = require(path.join(__dirname, "..", "세트분리V2", "core.js"));

console.log("\n[1] ★ 두 구현이 같은 답을 내는가 ★");
const 주소들 = [
  "서울 강남구 테헤란로 1",
  "경남 통영시 욕지면 동항리 100",
  "경남 통영시 산양읍 연곡리 12",
  "경남 통영시 산양읍 삼덕리 5",
  "경기 화성시 남면 1",
  "제주특별자치도 제주시 노형동 1",
  "제주특별자치도 제주시 우도면 연평리 1",
  "제주특별자치도 제주시 추자면 대서리 1",
  "제주특별자치도 서귀포시 중문동 1",
];
for (const a of 주소들) {
  const zone = /제주|서귀포/.test(a) ? "제주" : "";
  const 원본 = C.ssReturnFee(a, zone, FERRY).합계;
  eq(a.slice(0, 30).padEnd(30) + " " + 원본.toLocaleString() + "원", feeOf(a), 원본);
}

console.log("\n[2] 요율 상수가 같은가 — 한쪽만 올리면 청구가 갈라진다");
eq("항공료", cs._CRF_AIR_JEJU_, C.SS_AIR_FEE_JEJU);
eq("박스비", cs._CRF_BOX_, C.SS_RETURN_BOX_FEE);

console.log("\n[3] 금액 자체");
eq("육지 반품은 박스비만", feeOf("서울 강남구 1"), 1000);
eq("욕지면 4,000 + 1,000", feeOf("통영시 욕지면 동항리 1"), 5000);
eq("제주 본섬 3,000 + 1,000", feeOf("제주시 노형동 1"), 4000);
eq("★ 우도면 3,000 + 4,000 + 1,000 ★", feeOf("제주시 우도면 연평리 1"), 8000);
eq("★ 추자면 3,000 + 5,000 + 1,000 ★", feeOf("제주시 추자면 대서리 1"), 9000);

console.log("\n[4] 리조건 — 그 읍·면 전체가 대상은 아니다");
eq("산양읍 연곡리는 대상", feeOf("통영시 산양읍 연곡리 12"), 5000);
eq("산양읍 삼덕리는 아님", feeOf("통영시 산양읍 삼덕리 5"), 1000);
eq("같은 「남면」 이름 오인 방지", feeOf("경기 화성시 남면 1"), 1000);

console.log("\n[5] 표를 못 읽어도 접수를 막지 않는다");
// 표가 비면 도선료는 0 이지만 박스비는 남는다. 0원으로 적히는 것보다 낫다.
eq("표가 비어도 박스비는 붙는다", (() => {
  const hit = cs._crf_match_("통영시 욕지면 1", []);
  return (hit ? hit.료 : 0) + cs._CRF_BOX_;
})(), 1000);

console.log("\n[6] 화면이 쓰는 함수가 있는가");
eq("csReturnFeeFor 있음", typeof cs.csReturnFeeFor, "function");
eq("편집기 점검 함수", gs.indexOf("function csReturnFeeSelfTest") > -1, true);
eq("표는 세트분리 시트에서 읽는다", gs.indexOf("1JuwZjorbBG7tOa92xfAy07eUV") > -1, true);
eq("★ 표를 베껴 오지 않았다 ★", gs.indexOf("욕지면") === -1 || gs.indexOf("['경남'") === -1, true);

console.log("\n[7] 화면 — 채워 놓되 고칠 수 있어야 한다 (사장님 지시)");
const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
eq("반품비 칸이 있다", html.indexOf('id="ledgerFee"') > -1, true);
eq("★ 잠그지 않는다 (readonly·disabled 아님) ★",
   /<input id="ledgerFee"[^>]*(readonly|disabled)/.test(html), false);
eq("모달을 열면 채운다", html.indexOf("ledgerFillFee(r)") > -1, true);
eq("계산은 서버가 한다", html.indexOf(".csReturnFeeFor(addr)") > -1, true);
eq("★ 사람이 적어 둔 값을 안 덮는다 ★",
   /if \(String\(el\.value \|\| ''\)\.trim\(\)\) return;/.test(html), true);
eq("응답이 늦게 와도 안 덮는다",
   /그 사이 사람이 적었으면[\s\S]{0,120}return;/.test(html), true);
eq("왜 그 금액인지 보여준다", html.indexOf('id="ledgerFeeWhy"') > -1, true);
eq("표를 못 읽으면 그렇다고 말한다", html.indexOf("도선료 표를 못 읽어 박스비만") > -1, true);
eq("기록에 실어 보낸다", /fee: document\.getElementById\('ledgerFee'\)/.test(html), true);
eq("여러 건에도 실어 보낸다", /account: account, fee: fee,/.test(html), true);
eq("임시저장에도 들어간다", /'ledgerPickup', 'ledgerFee'/.test(html), true);
eq("주소가 없으면 그렇다고 말한다", html.indexOf("주소가 없어 자동 계산을 못 했습니다") > -1, true);

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
