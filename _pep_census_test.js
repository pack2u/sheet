/**
 * 로컬 검증: 대리공급 푸시의 「원본 대조」
 *
 *  > "대리공급 푸시시 구번젼 세트분리의 대리발송탭의 주문건이 누락되는 경우가
 *  >  있었어 금요일에.. 푸시시 세트분리 대리발송 텝의 업체별 갯수와 푸시된
 *  >  갯수를 확인하여 결과값을 알려주는 기능을 추가해줘"
 *
 *  Push 건수만 보면 「많이 나갔네」로 끝난다. 원본이 몇이었는지를 모르니
 *  덜 나간 것을 알 길이 없다. 금요일에 그렇게 묻혔다.
 *
 *  지켜야 할 것
 *    · 원본을 세는 눈과 푸시하는 눈이 같아야 한다 (_pep_rowPrefix_ 한 군데)
 *    · 까닭이 있는 스킵과 «까닭 없이 빠진 줄»이 갈려 보여야 한다
 *    · 미확인 줄은 숫자만이 아니라 줄번호·코드·품목명까지 나와야 한다
 *
 * 실행: node _pep_census_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const src = fs.readFileSync("_partnerExclusivePush.gs", "utf8");

function grabFn(name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext([
  "var _PEP_CODE_COL = 3, _PEP_ITEM_COL = 4, _PEP_VENDOR_CODE_COL = 19;",
  "var _PEP_VENDOR_DIRECT_MAP_ = { JT: {}, HR: {}, TY: {} };",
  "var _PEP_VENDOR_LABELS_ = { JT: '제이티', HR: '한라', TY: '태영', NK: '엔케이' };",
  "var _PEP_PREFIX_ALIAS_ = { JH: 'JT', BF: 'JT', NS: 'JT' };",
  "function _pep_resolvePrefixAlias_(p) { return _PEP_PREFIX_ALIAS_[p] || p; }",
  grabFn("_pep_rowPrefix_"),
  grabFn("_pep_censusSource_"),
  grabFn("_pep_reconcile_"),
].join("\n"), ctx);

//  D열(3)=코드, E열(4)=품목명
const 줄 = (code, name) => { const r = []; r[3] = code; r[4] = name; return r; };

console.log("\n[접두 읽기] 한 눈으로 본다");
check("코드 앞 두 자", ctx._pep_rowPrefix_(줄("HR001", "한라 족발")).pfx, "HR");
check("보조 접두는 대표로 환산 (JH→JT)", ctx._pep_rowPrefix_(줄("JH900", "실링")).pfx, "JT");
check("코드가 없으면 품목명 앞 영문 두 자", ctx._pep_rowPrefix_(줄("", "TY 미니탕")).pfx, "TY");
check("품목명 앞 한글·대괄호는 건너뛴다", ctx._pep_rowPrefix_(줄("", "[샘플] BF 실링")).pfx, "JT");
check("모르는 접두는 빈칸", ctx._pep_rowPrefix_(줄("ZZ001", "없는업체")).pfx, "");
check("코드도 품목명도 없으면 빈 줄", ctx._pep_rowPrefix_(줄("", "")).빈줄, true);

console.log("");
console.log("[업체코드 칸] 사람이 적은 것이 짐작보다 앞선다");
//  T열(19) = 업체코드. 세트분리 「대리발송품목」에 적은 값이 여기까지 온다
const 줄V = (code, name, vc) => { const r = 줄(code, name); r[19] = vc; return r; };
check("우리 코드여도 적은 업체로 간다", ctx._pep_rowPrefix_(줄V("A100", "감자탕", "HR")).pfx, "HR");
check("적힌 것이 짐작을 이긴다", ctx._pep_rowPrefix_(줄V("HR001", "한라 족발", "TY")).pfx, "TY");
check("적은 코드도 보조 접두 환산 (JH→JT)", ctx._pep_rowPrefix_(줄V("A100", "감자탕", "JH")).pfx, "JT");
check("소문자로 적어도 된다", ctx._pep_rowPrefix_(줄V("A100", "감자탕", "hr")).pfx, "HR");
check("모르는 업체코드면 종전대로 코드로", ctx._pep_rowPrefix_(줄V("HR001", "한라 족발", "ZZ")).pfx, "HR");
check("칸이 비면 종전 그대로", ctx._pep_rowPrefix_(줄V("HR001", "한라 족발", "")).pfx, "HR");

console.log("\n[원본 세기] 대리발송 탭을 업체별로");
const 원본 = [
  줄("HR001", "한라 족발"),   // 0
  줄("HR002", "한라 보쌈"),   // 1
  줄("JH900", "실링 191470"), // 2  → JT
  줄("TY010", "태영 탕"),     // 3
  줄("ZZ999", "모르는업체"),  // 4  → 접두없음
  줄("", ""),                 // 5  → 빈 줄
];
const 센 = ctx._pep_censusSource_(원본);
check("업체별 건수", 센.byPfx, { HR: 2, JT: 1, TY: 1 });
check("접두 못 읽은 줄", 센.접두없음, 1);
check("빈 줄은 안 센다", 센.빈줄, 1);
check("빈 줄은 총계에서도 뺀다", 센.총, 5);

console.log("\n[대조] 까닭 있는 스킵과 «까닭 없이 빠진 줄»을 가른다");
{
  //  HR 두 줄 중 하나만 나가고, 하나는 «아무 표시도 없다» = 미확인
  const 결과 = { 0: "푸시", 2: "푸시", 3: "이미" };
  const r = ctx._pep_reconcile_(센, 결과, 원본);
  const HR = r.rows.filter((x) => x.접두 === "HR")[0];
  check("HR 원본 2", HR.원본, 2);
  check("HR 푸시 1", HR["푸시"], 1);
  check("★ HR 미확인 1 — 이것이 금요일에 묻혔던 것", HR.미확인, 1);
  check("미확인 합계", r.미확인, 1);
  check("미확인 줄을 이름째로 적는다", r.미확인줄, ["R2 [HR] HR002 한라 보쌈"]);
  check("접두 없는 줄은 표에 안 올린다", r.rows.map((x) => x.접두), ["HR", "JT", "TY"]);
}

console.log("\n[대조] 까닭이 다 있으면 미확인은 0");
{
  const 결과 = { 0: "푸시", 1: "이미", 2: "겹침", 3: "매핑없음" };
  const r = ctx._pep_reconcile_(센, 결과, 원본);
  check("미확인 없음", r.미확인, 0);
  check("미확인 줄도 없음", r.미확인줄.length, 0);
}

console.log("\n[대조] 아직 안 지나간 줄은 사고가 아니다");
{
  //  이어달리기: 앞 조각이 처리한 줄과, 시간이 다 돼 못 간 줄
  const 결과 = { 0: "앞서처리", 1: "앞서처리", 2: "푸시", 3: "아직" };
  const r = ctx._pep_reconcile_(센, 결과, 원본);
  check("★ 미확인 0 — 이어달리기는 사고가 아니다", r.미확인, 0);
  const HR = r.rows.filter((x) => x.접두 === "HR")[0];
  check("앞서처리도 세어 둔다", HR["앞서처리"], 2);
  const TY = r.rows.filter((x) => x.접두 === "TY")[0];
  check("아직 안 간 줄도 세어 둔다", TY["아직"], 1);
}

console.log("\n[대조] 모르는 사유는 미확인으로 샌다");
{
  //  누군가 새 사유 이름을 적고 사유 목록에 안 넣으면, 조용히 사라지면 안 된다
  const 결과 = { 0: "푸시", 1: "새로운사유", 2: "푸시", 3: "푸시" };
  const r = ctx._pep_reconcile_(센, 결과, 원본);
  check("★ 목록에 없는 사유는 미확인", r.미확인, 1);
}

console.log("\n[소스 코드] 푸시가 같은 눈을 쓰는가");
{
  check("★ 루프가 _pep_rowPrefix_ 를 쓴다",
    src.includes("var _pfxInfo_ = _pep_rowPrefix_(row);"), true);
  check("★ 인라인으로 접두를 다시 읽던 코드는 사라졌다",
    src.includes("rawCode.length >= 2 ? _pep_resolvePrefixAlias_(rawCode.substring(0, 2)) : \"\";\n    var namePfx"), false);
  check("★ 푸시 전에 원본을 센다",
    src.includes("var _원본센_ = _pep_censusSource_(srcAll);"), true);
  check("★ 줄마다 사유를 적는다", (src.match(/_줄결과_\[ri\]/g) || []).length >= 8, true);
  check("★ 안 지나간 줄에도 이름을 붙인다",
    src.includes("_줄결과_[_nz] = \"앞서처리\";") && src.includes("_줄결과_[_nz] = \"아직\";"), true);
  check("★ 요약 화면에 대조표가 있다",
    src.includes("원본 대조 (대리발송 탭 ↔ Push)"), true);
  check("★ 조용히 돌 때도 말로 남긴다 (트리거)",
    src.includes("var _대조글_ = \"\";") && src.includes("_대조글_ +"), true);
  check("★ 미확인이 있으면 붉게 칠한다", src.includes("class=\\\"alarm\\\""), true);
}

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
