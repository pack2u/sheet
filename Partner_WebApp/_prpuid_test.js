/**
 * ══════════════════════════════════════════════════════════════
 *  포털의 반품 고유ID — CS 것과 «같은 자»인가
 *  2026-10-04
 *
 *  > "모든 문의 반품 발주관련된 부분에서 항상 고유아이디가 붙게해줘"
 *
 *  ★ 왜 두 벌인가 ★
 *    포털은 CS웹앱과 «다른 스크립트 프로젝트»다. _cs_returnUidNext_ 를
 *    부를 수 없어 베끼는 수밖에 없다.
 *
 *  ★ 왜 시험이 있나 ★
 *    두 벌이 어긋나면 «같은 번호가 두 줄에» 나간다. 그러면 번호로 찾을 때
 *    엉뚱한 건이 섞이고, 세는 숫자가 틀린다. 눈으로는 안 보인다 —
 *    두 파일이 서로 다른 폴더에 있어 나란히 놓고 볼 일이 없다.
 *    그래서 두 파일에서 «떠내» 같은 값인지 센다.
 *
 *  돌리는 법   node Partner_WebApp/_prpuid_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const 뿌리 = path.join(__dirname, "..");
const CS = fs.readFileSync(path.join(뿌리, "CS_WebApp", "csReturnUid.gs"), "utf8");
const PRP = fs.readFileSync(path.join(__dirname, "prpLedger.gs"), "utf8");
const API = fs.readFileSync(path.join(__dirname, "prpApi.gs"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ✔ " + 이름); return; }
  틀린것++;
  console.log("  ✗ " + 이름 + (덧붙임 ? "\n      " + 덧붙임 : ""));
}

/** 함수 하나를 떠낸다 */
function 꺼내(src, 이름) {
  const i = src.indexOf("function " + 이름 + "(");
  if (i < 0) return null;
  const j = src.indexOf("{", i);
  let 깊이 = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") 깊이++;
    else if (src[k] === "}") { 깊이--; if (깊이 === 0) return src.slice(i, k + 1); }
  }
  return null;
}

function 판(src, 이름들, 머리) {
  const ctx = {
    String, Object, parseInt, Math, RegExp, Date, isNaN,
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = (n) => (n < 10 ? "0" : "") + n;
        if (fmt === "MMdd") return p(d.getMonth() + 1) + p(d.getDate());
        return "";
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(머리, ctx);
  for (const n of 이름들) {
    const f = 꺼내(src, n);
    if (!f) { console.log("★ " + n + " 을 못 찾았습니다"); process.exit(1); }
    vm.runInContext(f, ctx);
  }
  return ctx;
}

const cs = 판(CS, ["_cs_ruidMMDD_", "_cs_returnUidNext_"], 'var _CS_RUID_PFX_ = "r";');
const prp = 판(PRP, ["prpRuidMMDD_", "prpReturnUidNext_"], 'var _PRP_RUID_PFX_ = "r";');

const csMMDD = (v) => vm.runInContext("_cs_ruidMMDD_", cs)(v);
const prpMMDD = (v) => vm.runInContext("prpRuidMMDD_", prp)(v);
const cs다음 = (m, t) => vm.runInContext("_cs_returnUidNext_", cs)(m, t);
const prp다음 = (m, t) => vm.runInContext("prpReturnUidNext_", prp)(m, t);

/* ── ① 날짜 읽기가 같은가 ───────────────────────────────── */
console.log("─── ① 접수날짜 → MMDD, 두 벌이 같은 답인가 ───");
for (const v of ["261002", "2026-10-02", "2026.10.2", "10/2", "", "미입고", "3000", "260901"]) {
  const a = csMMDD(v), b = prpMMDD(v);
  ok("「" + (v || "(빈 값)") + "」 → " + JSON.stringify(a), a === b,
    "CS=" + JSON.stringify(a) + " 인데 포털=" + JSON.stringify(b));
}
ok("Date 도 같다", csMMDD(new Date(2026, 9, 2)) === prpMMDD(new Date(2026, 9, 2)));

/* ── ② 번호가 같은가 ───────────────────────────────────── */
console.log("\n─── ② 같은 상황에서 같은 번호를 주는가 ───");
const 상황 = [
  ["빈 장부", {}],
  ["하나 있음", { r1002000001: true }],
  ["띄엄띄엄", { r1002000001: true, r1002000047: true, r1002000012: true }],
  ["다른 날 섞임", { r1001000009: true, r1002000003: true }],
  ["옛 난수 꼴 섞임", { r1002a3f19: true, r1002000003: true }],
];
for (const [이름, 쓴것] of 상황) {
  const a = cs다음("1002", Object.assign({}, 쓴것));
  const b = prp다음("1002", Object.assign({}, 쓴것));
  ok(이름 + " → " + a, a === b, "CS=" + a + " 인데 포털=" + b);
}

//  잇따라 뽑아도 같은 차례인가
console.log("");
let csT = {}, prpT = {};
let 같나 = true;
for (let i = 0; i < 50; i++) if (cs다음("1002", csT) !== prp다음("1002", prpT)) 같나 = false;
ok("★ 50번 잇따라 뽑아도 차례가 같다 ★", 같나,
  "어긋나면 두 쪽이 같은 번호를 서로 다른 건에 준다");

/* ── ③ 준 번호를 스스로 적어 두는가 ──────────────────────── */
console.log("\n─── ③ 같은 실행 안에서 두 번 안 주는가 ───");
const t1 = {};
const 둘 = [prp다음("1002", t1), prp다음("1002", t1)];
ok("포털도 쓴것에 적어 둔다", 둘[0] !== 둘[1] && t1[둘[0]] && t1[둘[1]],
  "안 적어 두면 한 번에 여러 건을 접수할 때 같은 번호가 나간다");

/* ── ④ 쓰는 쪽에 붙어 있는가 ────────────────────────────── */
console.log("\n─── ④ 접수할 때 실제로 매기는가 ───");
ok("prpMapCols_ 가 고유ID 열을 찾는다",
  /col\.uid < 0 && \/\^고유ID\$/.test(PRP));
ok("col 에 uid 자리가 있다", /uid: -1/.test(PRP));
ok("접수할 때 발급한다",
  /row\[col\.uid\] = prpReturnUidNext_\(prpToday_\("MMdd"\), 쓴것\)/.test(API));
ok("열이 없으면 조용히 넘어간다", /if \(col\.uid >= 0\) \{/.test(API),
  "옛 탭에는 칸이 없다. 칸이 없다고 접수를 막으면 업체가 아무것도 못 한다");
ok("이미 쓰인 번호를 먼저 모은다", /쓴것\[uu\] = true/.test(API),
  "안 모으면 늘 1번을 준다");
ok("표식이 r 로 같다", /var _PRP_RUID_PFX_ = "r"/.test(PRP) && /var _CS_RUID_PFX_ = "r"/.test(CS));

/* ── ⑤ 베낀 것임을 적어 두었는가 ────────────────────────── */
console.log("\n─── ⑤ 두 벌임을 코드가 말하는가 ───");
ok("포털 쪽에 「베낀 것」이라고 적혀 있다",
  /csReturnUid\.gs/.test(PRP) && /베낀/.test(PRP),
  "안 적어 두면 한쪽만 고치고 어긋난 줄 모른다");

console.log("\n" + (틀린것 ? "✗ " : "✅ ") + 잰것 + "개 중 " + 틀린것 + "개 틀렸습니다.");
process.exit(틀린것 ? 1 : 0);
