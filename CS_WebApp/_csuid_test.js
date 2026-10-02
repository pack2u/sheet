/**
 * ══════════════════════════════════════════════════════════════
 *  반품 고유ID — 「r1002000003」
 *
 *  > "모든 문의 반품 발주관련된 부분에서 항상 고유아이디가 붙게해줘..
 *  >  다 연결되어 연동..찾기가 가능하고 추적가능하게"
 *
 *  ★ 왜 시험이 있나 ★
 *    번호가 겹치면 그 줄은 «아무 말 없이» 빠진다. 2026-09-21 에 난수
 *    넉 자를 쓰다 나흘에 한 번꼴로 겹쳤고, 사장님이 반복해서 말한
 *    「수집했는데 하나가 빠졌어」가 그것이었다.
 *    규칙이 흔들렸는지는 눈으로 안 보인다. 그래서 센다.
 *
 *  돌리는 법   node CS_WebApp/_csuid_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const GS = fs.readFileSync(path.join(__dirname, "csReturnUid.gs"), "utf8");
const OS = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");
const HTML = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ✔ " + 이름); return; }
  틀린것++;
  console.log("  ✗ " + 이름 + (덧붙임 ? "\n      " + 덧붙임 : ""));
}

/** 함수 하나를 떠내 돌릴 수 있게 한다 */
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

const ctx = {
  String, Object, parseInt, Math, console, Date,
  //  GAS 의 Utilities 를 흉내 낸다 — 서울 시각으로 MMdd
  Utilities: {
    formatDate: function (d, tz, fmt) {
      const p = (n) => (n < 10 ? "0" : "") + n;
      if (fmt === "MMdd") return p(d.getMonth() + 1) + p(d.getDate());
      if (fmt === "yyMMdd") return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate());
      return "";
    },
  },
};
vm.createContext(ctx);
["_cs_ruidMMDD_", "_cs_returnUidNext_", "_cs_isUidHeader_"].forEach((n) => {
  const f = 꺼내(GS, n);
  if (!f) { console.log("★ " + n + " 을 못 찾음"); process.exit(1); }
  vm.runInContext(f, ctx);
});
vm.runInContext("var _CS_RUID_PFX_ = 'r';", ctx);
const MMDD = (v) => vm.runInContext("_cs_ruidMMDD_", ctx)(v);
const 다음 = (mmdd, 쓴것) => vm.runInContext("_cs_returnUidNext_", ctx)(mmdd, 쓴것);

/* ── ① 날짜를 읽는다 ──────────────────────────────────────── */
console.log("─── ① 접수날짜에서 MMDD 를 읽는다 ───");
ok("261002 → 1002", MMDD("261002") === "1002");
ok("2026-10-02 → 1002", MMDD("2026-10-02") === "1002");
ok("2026.10.2 → 1002", MMDD("2026.10.2") === "1002");
ok("10/2 → 1002", MMDD("10/2") === "1002");
ok("Date → 1002", MMDD(new Date(2026, 9, 2)) === "1002");
ok("빈 값은 빈 값", MMDD("") === "" && MMDD(null) === "");
//  엉뚱한 글자를 날짜로 읽으면 번호가 엉뚱한 날에 붙는다
ok("「미입고」는 날짜가 아니다", MMDD("미입고") === "");
ok("「3000」은 날짜가 아니다", MMDD("3000") === "",
  "반품비가 접수날짜 칸에 잘못 들어와도 날짜로 읽으면 안 된다");

/* ── ② 번호표 — 겹치지 않는다 ───────────────────────────── */
console.log("\n─── ② 그날의 번호표 ───");
let 쓴것 = {};
ok("비었으면 1번부터", 다음("1002", 쓴것) === "r1002000001");
ok("다음은 2번", 다음("1002", 쓴것) === "r1002000002");
ok("★ 준 번호를 스스로 적어 둔다 ★", 쓴것["r1002000001"] === true && 쓴것["r1002000002"] === true,
  "안 적어 두면 같은 실행 안에서 같은 번호를 두 번 준다");

쓴것 = { "r1002000001": true, "r1002000047": true, "r1002000012": true };
ok("가장 큰 번호 다음으로", 다음("1002", 쓴것) === "r1002000048",
  "빈 번호를 줍지 않는다 — 지난 줄이 걷혀도 되돌아가지 않아야 한다");

쓴것 = { "r1002000001": true, "r1003000009": true };
ok("날이 다르면 따로 센다", 다음("1003", 쓴것) === "r1003000010");
ok("새 날은 1번부터", 다음("1004", 쓴것) === "r1004000001");

//  옛 난수 ID 가 섞여 있어도 숫자 여섯 자만 센다
쓴것 = { "r1002a3f19": true, "r1002000003": true };
ok("옛 난수 꼴은 안 센다", 다음("1002", 쓴것) === "r1002000004");

//  1000건이 넘어도 안 겹친다
쓴것 = {};
const 많이 = {};
for (let i = 0; i < 1200; i++) 많이[다음("1002", 쓴것)] = true;
ok("1,200건을 뽑아도 겹침 0", Object.keys(많이).length === 1200,
  "난수였다면 여기서 겹친다 — 그래서 번호표로 바꿨다");
ok("마지막이 1200번", 많이["r1002001200"] === true);

/* ── ③ 머리글을 알아본다 ────────────────────────────────── */
console.log("\n─── ③ 머리글 ───");
const 머리 = (h) => vm.runInContext("_cs_isUidHeader_", ctx)(h);
ok("고유ID", 머리("고유ID") === true);
ok("고유 ID (띄어쓰기)", 머리("고유 ID") === true);
ok("고유아이디", 머리("고유아이디") === true);
ok("uid 소문자", 머리("uid") === true);
ok("「고유ID확인」은 아니다", 머리("고유ID확인") === false,
  "느슨하면 엉뚱한 칸을 고유ID 로 읽는다");

/* ── ④ 다른 번호와 안 겹친다 ────────────────────────────── */
console.log("\n─── ④ 발주(d)·전화주문(p)과 한 집안이면서 안 겹친다 ───");
ok("반품 표식은 r", /var _CS_RUID_PFX_ = "r"/.test(GS));
ok("모양이 같다 — 표식+MMDD+여섯 자",
  /^r\d{4}\d{6}$/.test(다음("1002", {})),
  "d1002000047 · p1002000047 과 같은 모양이어야 사람이 한눈에 읽는다");

/* ── ⑤ 쓰는 쪽·읽는 쪽·찾는 쪽이 이어져 있나 ────────────── */
console.log("\n─── ⑤ 발급 · 읽기 · 찾기 ───");
ok("반품을 기록할 때 발급한다",
  /row\[col\.uid\] = _cs_returnUidNext_\(mmdd, 쓴것\)/.test(OS));
ok("열이 없으면 조용히 넘어간다", /if \(col\.uid >= 0\) \{/.test(OS),
  "열을 만들기 전에도 기록은 돼야 한다");
ok("머리글로 고유ID 열을 찾는다", /col\.uid < 0 && \/\^고유ID\$/.test(OS));
ok("카드로 돌려준다", /uid: col\.uid >= 0 \? String\(row\[col\.uid\]/.test(OS));
ok("★ 번호로 찾을 수 있다 ★", /c\.uid$/m.test(HTML) && /returnSearchHaystack/.test(HTML),
  "찾을 수 없으면 번호를 매긴 뜻이 없다");
ok("카드 상세에 번호가 보인다", /retCaseRowHtml\('고유ID', c\.uid\)/.test(HTML));

console.log("\n" + (틀린것 ? "✗ " : "✅ ") + 잰것 + "개 중 " + 틀린것 + "개 틀렸습니다.");
process.exit(틀린것 ? 1 : 0);
