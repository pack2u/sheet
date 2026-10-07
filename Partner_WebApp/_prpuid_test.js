/**
 * ══════════════════════════════════════════════════════════════
 *  포털은 반품 고유ID 를 «짓지 않는다»
 *  2026-10-04 에 만들었다가  ·  2026-10-07 에 뒤집었다
 *
 *  > "주문건의 고유아이디를 넣어 달라고한건데. 반품관련 고유아이디를 따로
 *  >  만드는거로 착각한듯..."
 *
 *  ★ 무슨 일이 있었나 ★
 *    10/04 에 포털이 반품 제 번호(r1004000003)를 발급하게 했다. 뜻을 잘못
 *    읽은 것이다 — 반품대장의 그 칸은 «원래 주문»의 고유ID 다.
 *    하나의 번호로 주문·송장·반품을 다 찾으려면 같은 번호가 세 곳에 있어야
 *    한다. 반품에 따로 번호를 지으면 오히려 끊긴다.
 *    CS 쪽은 같은 날 그 길을 걷었다(csReturnUid.gs 가 «쓰지 않음» 껍데기다).
 *
 *    포털만 남았다. 그것도 반쪽으로 —
 *      prpApi.gs 는 prpReturnUidNext_ 를 «부르는데» 그 정의가 어디에도 없었다.
 *      1b268fe 가 발급기를 보관만 하고 본체에 안 넣었다.
 *      col.uid 가 있는 탭에서 업체가 접수하는 순간 ReferenceError 로 터진다 —
 *      업체가 아무것도 못 하게 된다. 2026-10-07 배포 견주기가 이것을 세웠다.
 *
 *  ★ 그래서 이 시험이 지키는 것 ★
 *    「포털은 그 칸을 비워 둔다」. 되돌아가면 여기서 운다.
 *    비워 두면 CS웹앱 csReturnOrderUidFill 이 원송장으로 찾아 넣는다 —
 *    지어 넣어도 그쪽이 덮으므로, 지어 넣는 것은 틀린 값을 잠깐 두는 것일 뿐이다.
 *
 *  돌리는 법   node Partner_WebApp/_prpuid_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");

const 뿌리 = path.join(__dirname, "..");
const API = fs.readFileSync(path.join(__dirname, "prpApi.gs"), "utf8");
const LED = fs.readFileSync(path.join(__dirname, "prpLedger.gs"), "utf8");
const CSUID = fs.readFileSync(
  path.join(뿌리, "CS_WebApp", "csReturnUid.gs"), "utf8");
const CSROU = fs.readFileSync(
  path.join(뿌리, "CS_WebApp", "csReturnOrderUid.gs"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ✔ " + 이름); return; }
  틀린것++;
  console.log("  ✗ " + 이름 + (덧붙임 ? "\n      " + 덧붙임 : ""));
}

/* ── [1] 포털이 번호를 «안» 짓는다 ───────────────────────── */
console.log("\n[1] 포털은 반품 번호를 짓지 않는다");

ok("★ 발급기를 부르지 않는다", !/prpReturnUidNext_\s*\(/.test(API),
  "정의가 어디에도 없다 — 부르면 업체 접수가 ReferenceError 로 터진다");
ok("★ 발급기 정의도 없다 (반쪽으로 남기지 않는다)",
  !/function prpReturnUidNext_\s*\(/.test(API + LED));
/*  ★ 「안 적는다」가 아니라 「안 짓는다」다 ★  (시험을 쓰다 걸렸다)
    그 칸에 적기는 적는다 — 업체가 조회로 «고른 주문»의 고유ID 를 그대로 옮긴다.
    그것이 그 칸의 본뜻이다. 막아야 할 것은 포털이 번호를 «지어내는» 것뿐이다.
    둘을 뭉뚱그려 「칸을 비워라」로 못 박았다가 멀쩡한 줄을 지울 뻔했다.         */
ok("★ 고유ID 는 «받은 것»만 적는다 (지어내지 않는다)",
  /if \(col\.uid >= 0 && uid\) row\[col\.uid\] = uid;/.test(API),
  "조회를 안 거친 건은 uid 가 비어 칸도 빈다");
const uid쓰는곳 = (API.match(/row\[col\.uid\]\s*=/g) || []).length;
ok("★ 그 칸에 적는 자리는 한 곳뿐이다  (" + uid쓰는곳 + "곳)", uid쓰는곳 === 1,
  "두 곳이 되면 어느 것이 맞는지 모른다");
ok("  r 접두 상수도 안 남겼다", !/_PRP_RUID_PFX_/.test(API + LED));

/*  ★ 왜 비워 두는지 코드에 적혀 있나 ★
    까닭이 없으면 다음 사람이 「빠졌네」 하고 도로 넣는다. 실제로 10/04 에
    그렇게 들어왔다 — 「업체가 접수한 반품은 번호 없이 남았다」가 그 말이었다. */
ok("★ 왜 비워 두는지 적어 두었다",
  /«원래 주문»의 고유ID/.test(API) && /csReturnOrderUidFill/.test(API),
  "까닭이 없으면 다음 사람이 도로 넣는다");

/* ── [2] CS 쪽과 «같은» 약속인가 ─────────────────────────── */
console.log("\n[2] CS 와 같은 약속 — 한쪽만 걷으면 또 갈린다");

ok("★ CS 의 r 번호 발급기는 막혀 있다",
  /쓰지 않음/.test(CSUID) && /_csruid_막힘_/.test(CSUID));
ok("  CS 도 그 칸을 «원래 주문» 것이라 적어 두었다",
  /«원래 주문»의 고유ID/.test(CSUID));

/* ── [3] 그럼 누가 채우나 ────────────────────────────────── */
console.log("\n[3] 비워 두면 CS 가 원송장으로 찾아 넣는다");

ok("★ 채우는 쪽이 살아 있다 (csReturnOrderUidFill)",
  /function csReturnOrderUidFill\s*\(/.test(CSROU),
  "이것이 없으면 비워 두는 것이 그냥 빠뜨리는 것이 된다");
ok("  미리보기도 있다 (바꾸기 전에 본다)",
  /csReturnOrderUid_미리보기/.test(CSROU));

/* ── [4] 접수 자체는 멀쩡한가 ────────────────────────────── */
console.log("\n[4] 칸을 안 쓴다고 접수가 막히면 안 된다");
/*  옛 탭에는 고유ID 칸이 아예 없다. 그때도 접수는 돼야 한다 —
    「칸이 없다고 접수를 막으면 업체가 아무것도 못 한다」가 본래 뜻이었다. */
ok("★ 접수 줄은 여전히 만든다", /var row = \[\];/.test(API));
ok("  접수날짜는 오늘로 적는다", /row\[col\.date\] = prpToday_\("yyMMdd"\)/.test(API));
ok("  상태도 적는다", /row\[col\.status\] = PRP_INITIAL_STATUS/.test(API));
ok("  업체 이름도 적는다", /row\[col\.vendor\] = sess\.vendor/.test(API));

console.log("");
console.log(틀린것 ? "실패 " + 틀린것 + "건 / 통과 " + (잰것 - 틀린것)
                  : "모두 통과 (" + 잰것 + "건)");
process.exit(틀린것 ? 1 : 0);
