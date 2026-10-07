/**
 * 업체 반품접수 요청 — «두 앱이 같은 글자를 쓰는가»
 *
 * ★ 이 시험이 지키는 것 ★
 *   업체 포털(Partner_WebApp)과 CS웹앱은 **대장 비고를 사이에 두고** 주고받는다.
 *     포털이 적는다 : [yyMMdd HH:mm 업체:이름] 반품접수 요청. 1시간 안에 접수됩니다.
 *     CS가 찾는다   : "반품접수 요청"
 *     CS가 적는다   : [yyMMdd HH:mm CS] 반품접수 완료/실패 …
 *     포털이 본다   : 그 글자를 보고 단추를 감춘다
 *
 *   한쪽 글자만 고치면 **조용히 갈린다** —
 *     · 요청 말이 갈리면 : 업체는 눌렀는데 CS가 못 찾아 영영 접수 안 된다
 *     · 완료 말이 갈리면 : 단추가 다시 나와 **접수가 두 번 나가고 기사가 두 번 온다**
 *   두 파일이 다른 프로젝트에 있어 한 번에 안 보인다. 그래서 여기서 맞대 본다.
 *
 * 실행: node _cspickupreq_test.js
 */
const fs = require("fs");
const path = require("path");

const cs = fs.readFileSync("csPickupRequests.gs", "utf8");
const portal = fs.readFileSync(
  path.join("..", "Partner_WebApp", "prpPickup.gs"), "utf8");
const portalHtml = fs.readFileSync(
  path.join("..", "Partner_WebApp", "portal.html"), "utf8");
const ledger = fs.readFileSync(
  path.join("..", "Partner_WebApp", "prpLedger.gs"), "utf8");
const lotte = fs.readFileSync("csLotteReturn.gs", "utf8");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  const same = got === want;
  same ? pass++ : fail++;
  console.log((same ? "  ok   " : "  FAIL ") + label +
    (same ? "" : "\n        기대 " + JSON.stringify(want) + " / 실제 " + JSON.stringify(got)));
}

console.log("\n[1] ★ 요청 표시가 두 앱에서 같은 글자인가");
{
  const p = (portal.match(/var PRP_PICKUP_MARK_\s*=\s*"([^"]+)"/) || [])[1];
  const c = (cs.match(/var _CPR_REQ_MARK_\s*=\s*"([^"]+)"/) || [])[1];
  ok("포털에 PRP_PICKUP_MARK_ 가 있다", !!p);
  ok("CS에 _CPR_REQ_MARK_ 가 있다", !!c);
  eq("★ 두 값이 같다", p, c);
}

console.log("\n[2] ★ CS가 적는 결과를 포털이 «처리됨»으로 읽는가");
{
  const re = (portal.match(/var PRP_PICKUP_DONE_RE_\s*=\s*(\/.+\/);/) || [])[1];
  ok("포털에 PRP_PICKUP_DONE_RE_ 가 있다", !!re);
  const DONE = eval("(" + re + ")");

  //  csPickupRequests.gs 가 실제로 적는 두 모양
  ok("「반품접수 완료.」 를 처리됨으로 본다", DONE.test("반품접수 완료. 접수번호 261007105757"));
  ok("「반품접수 실패 — …」 를 처리됨으로 본다", DONE.test("반품접수 실패 — 운임이 0 으로 옵니다"));
  //  csLotteReturn.gs 가 적는 모양 (CS가 직접 접수했을 때)
  ok("「회수접수 · 원송장 …」 도 처리됨으로 본다",
     DONE.test("회수접수 · 원송장 451 → 반품송장 452 · 집하 2026-10-07"));

  //  ★ 요청 줄 자체를 처리됨으로 보면 안 된다 ★ 그러면 접수가 영영 안 된다
  ok("★ 「반품접수 요청.」 은 처리됨이 아니다",
     !DONE.test("[261007 17:30 업체:당장드림] 반품접수 요청. 1시간 안에 접수됩니다."));
}

console.log("\n[3] ★ CS가 요청 줄을 찾아내는가");
{
  const c = (cs.match(/var _CPR_REQ_MARK_\s*=\s*"([^"]+)"/) || [])[1];
  const 요청줄 = "[261007 17:30 업체:당장드림] " + c + ". 1시간 안에 접수됩니다.";
  ok("포털이 적는 줄에 CS 표시가 들어 있다", 요청줄.indexOf(c) !== -1);

  const DONE = eval("(" + (cs.match(/var _CPR_DONE_RE_\s*=\s*(\/.+\/);/) || [])[1] + ")");
  ok("★ 요청만 있는 줄은 아직 처리 전이다", !DONE.test(요청줄));
  ok("처리한 뒤에는 다시 안 집는다", DONE.test(요청줄 + "\n[261007 18:05 CS] 반품접수 완료."));
}

console.log("\n[4] 업체 화면에 보이는 모양인가 (포털 타임라인이 거른다)");
{
  //  prpPublicTimeline_ 은 [yyMMdd H:mm 작성자] 꼴만 내보낸다
  const 모양 = /^\[(\d{6})\s+(\d{1,2}:\d{2})\s+([^\]]+)\]\s*(.*)$/;
  ok("★ 요청 줄이 그 모양이다",
     모양.test("[261007 17:30 업체:당장드림] 반품접수 요청. 1시간 안에 접수됩니다."));
  ok("★ CS 결과 줄도 그 모양이다",
     모양.test("[261007 18:05 CS] 반품접수 완료. 접수번호 261007105757"));
  ok("CS가 도장을 찍는다", /\[\" \+ now \+ \" CS\]|\[" \+ now \+ " CS\]/.test(cs));
  ok("포털이 도장을 찍는다", /prpStamp_\(PRP_STAFF_PREFIX/.test(portal));
}

console.log("\n[5] 두 번 나가지 않게 막는가");
{
  ok("서버가 한 번 더 본다 (화면만 믿지 않는다)",
     /prpPickupState_\(ctx\.row, ctx\.col\)/.test(portal));
  ok("누른 직후 단추를 잠근다", /btn\.disabled = true/.test(portalHtml));
  ok("되돌리기 어려운 일이라 한 번 묻는다", /기사가 방문합니다/.test(portalHtml));
  ok("★ 판정은 서버에서 한다 (화면이 따로 안 따진다)",
     /pickupCan:/.test(ledger) && /prpPickupState_/.test(ledger));
}

console.log("\n[6] 1시간 일감에 얹혔는가");
{
  const fill = fs.readFileSync("csLogenSlipFill.gs", "utf8");
  ok("트리거가 csReturnHourlyJob 을 부른다", /newTrigger\("csReturnHourlyJob"\)/.test(fill));
  /*  차례가 중요하다 — 접수가 먼저라야 takeNo 가 생기고, 그 자리에서 송장까지
      붙는 날이 있다. 거꾸로면 늘 한 시간을 더 기다린다.
      («부르는 자리»로 재지 않는다. 둘 다 머리말 주석에 이름이 나와서 주석을
       먼저 집는다 — 합친 일감 함수 «안»에서만 본다.) */
  const 일감 = cs.slice(cs.indexOf("function csReturnHourlyJob"));
  const 접수먼저 = 일감.indexOf("csProcessPickupRequests()");
  const 채우기나중 = 일감.indexOf("csLogenFillReturnSlips(");
  ok("★ 접수가 송장 채우기보다 «먼저» 다",
     접수먼저 >= 0 && 채우기나중 > 접수먼저);
  ok("실패해도 다음 일감은 돈다", /catch \(e\) \{ L\.push\("송장 채우기 실패/.test(cs));
}

console.log("\n[8] ★ 옛 트리거에서 «갈래 없이» 넘어오는가");
{
  const fill = fs.readFileSync("csLogenSlipFill.gs", "utf8");

  /*  ★ 왜 이것을 지키나 ★
      2026-10-07 전 트리거는 csLogenFillReturnSlips 를 바로 불렀다. 코드만 바꾸고
      트리거를 안 바꾸면 «업체 요청을 아무도 집어 가지 않는다» — 요청만 쌓인다.
      반대로 둘이 겹쳐 돌면 로젠 조회가 한 시간에 두 번 나간다(1회 10건 약속).
      그래서 ① 스스로 옮겨 타고 ② 옛 이름은 쓸려 나가야 한다. 둘 중 하나만
      있으면 어느 쪽이 맞는지 모르는 상태가 된다. */

  ok("★ 설치기가 옛 이름도 쓸어낸다",
     /h === "csReturnHourlyJob" \|\| h === "csLogenFillReturnSlips"/.test(fill));
  ok("끄기도 옛 이름을 같이 끈다",
     (fill.match(/h === "csReturnHourlyJob" \|\| h === "csLogenFillReturnSlips"/g) || []).length >= 2);
  ok("★ 옛 트리거가 돌면 설치기를 부른다",
     /getHandlerFunction\(\) === "csLogenFillReturnSlips"/.test(fill) &&
     /csInstallLogenSlipFillTrigger\(\)/.test(fill));

  //  ★ 되돌이에 빠지지 않는가 ★ 설치기 → csReturnHourlyJob → 여기 → 설치기 …
  ok("★ 합친 일감은 그 가지를 건너뛴다", /기존트리거아님: true/.test(cs));
  ok("표가 있으면 훑지 않는다", /if \(!\(opt && opt\.기존트리거아님\)\)/.test(fill));

  //  설치기는 지운 «뒤에» 다시 건다 — 거꾸로면 옛 트리거가 살아남는다
  const 지움 = fill.indexOf('h === "csReturnHourlyJob" || h === "csLogenFillReturnSlips"');
  const 거는곳 = fill.indexOf('newTrigger("csReturnHourlyJob")');
  ok("★ 지운 뒤에 건다", 지움 >= 0 && 거는곳 > 지움);
}

console.log("\n[7] 접수는 CS웹앱 «한 곳»에서만 한다");
{
  /*  주석에는 «왜 안 부르는지»가 적혀 있다. 주석을 걷어내고 «실제 코드»만 본다 —
      안 그러면 설명을 호출로 잘못 읽는다. */
  const 코드만 = portal
    .replace(/\/\*[\s\S]*?\*\//g, "")   // 블록 주석
    .replace(/^\s*\/\/.*$/gm, "");      // 한 줄 주석
  ok("★ 포털은 로젠·롯데를 직접 안 부른다",
     !/UrlFetchApp|registReturnRequest|_lgr_pickupMany_|csLotteReturnPickup/.test(코드만));
  ok("CS가 기존 접수 함수를 그대로 쓴다",
     /csLotteReturnPickupFromCard\(\{ tab:/.test(cs));
  ok("그 함수가 택배사를 가른다 (복사하지 않았다)", /로젠인가/.test(lotte));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
