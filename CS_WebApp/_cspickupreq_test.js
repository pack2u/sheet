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

console.log("\n[9] ★ 밖에서 볼 수 있는가 (편집기를 안 열고)");
{
  const fill = fs.readFileSync("csLogenSlipFill.gs", "utf8");

  /*  이 일감은 사람 없이 1시간마다 돈다. 남는 것이 Logger.log 뿐이면
      「돌았나 · 바뀌었나」를 물을 때마다 사람이 편집기를 열어야 한다.
      특히 트리거가 옮겨 탔는지는 «일이 도는 것»으로 안 가려진다 —
      옛 트리거도 송장 채우기는 똑같이 하기 때문이다. */

  ok("점검 탭에 적는다", /var _CPR_OPS_TAB_ = "/.test(cs));
  ok("★ 돌았다는 것을 남긴다", /_cpr_ops_\(ss2, "반품 1시간 일감"/.test(cs));
  ok("★ 지금 걸린 트리거를 «그대로» 적는다 (짐작하지 않는다)",
     /_cpr_ops_\(ss2, "지금 걸린 트리거", _cpr_triggerNames_\(\)\)/.test(cs) &&
     /getHandlerFunction\(\)\)/.test(cs));
  ok("★ 옮겨 탄 그 한 번도 남긴다", /"트리거 옮겨탐"/.test(fill));
  ok("요청 처리 결과도 남긴다", /_cpr_ops_\(ss, "업체 반품접수 요청"/.test(cs));

  //  ★ 달 탭으로 잘못 읽히면 대장을 훑는 코드가 이 탭까지 뒤진다 ★
  const 탭 = (cs.match(/var _CPR_OPS_TAB_ = "([^"]+)"/) || [])[1];
  ok("★ 달 탭 이름이 아니다", 탭 && !/^\d{6}$/.test(탭));

  //  ★ 적다가 실패해도 접수·채우기는 돌아야 한다 ★
  ok("점검 기록은 제 일을 막지 않는다",
     /catch \(e\) \{ \/\* 적지 못해도 제 일은 한다 \*\/ \}/.test(cs));
  ok("쌓이지 않는다 (항목마다 한 줄, 제자리에 덮는다)",
     /setValues\(\[\[String\(값\), 때\]\]\)/.test(cs));
}

console.log("\n[10] ★ 실패 줄을 «해결됨»으로 고쳐 적는다");
{
  /*  ★ 왜 ★ 비고는 쌓이기만 한다. 한 번 실패하면 나중에 접수가 되어도 실패 줄이
      그대로 남아, CS 카드도 업체 화면도 「실패했다」고 보여 준다. 사람이 다시
      누르면 중복 접수가 나간다. 2026-10-08 에 실제로 그랬다 — 운임 때문에 실패한
      건이 고쳐서 접수된 뒤에도 「거래처계약정보 조회 오류」로 보였다. */
  const vm = require("vm");
  const ctx = { console, String, Number, Array, Math, JSON };
  vm.createContext(ctx);
  vm.runInContext(cs.slice(cs.indexOf("function _cpr_resolveFailLines_")), ctx);
  const 고친다 = (n, t) => vm.runInContext(
    "_cpr_resolveFailLines_(" + JSON.stringify(n) + "," + JSON.stringify(t) + ")", ctx);

  const 실제 = "[261008 10:06 업체:당장드림] 반품접수 요청. 1시간 안에 접수됩니다.\n" +
    "[261008 10:12 CS] 반품접수 실패 — 45311894913 — 거래처계약정보 조회 오류 ( 거래처코드 : 348782 )";
  const 후 = 고친다(실제, "261008109134");
  ok("★ 실패 줄에 결말이 붙는다", /→ 해결됨 \(접수 261008109134\)/.test(후));
  ok("★ 지우지 않는다 (왜 실패했는지가 남는다)", /거래처계약정보 조회 오류/.test(후));
  ok("요청 줄은 안 건드린다", /반품접수 요청\. 1시간 안에 접수됩니다\.$/m.test(후));
  ok("★ 두 번 붙지 않는다 (1시간마다 도는 일이다)",
     (고친다(후, "261008109134").match(/→ 해결됨/g) || []).length === 1);
  ok("실패가 없으면 그대로 둔다",
     고친다("[261008 10:00 CS] 잘 됐습니다", "T1") === "[261008 10:00 CS] 잘 됐습니다");
  ok("접수번호를 모르면 꼬리만 붙인다", /→ 해결됨$/m.test(고친다("반품접수 실패 — 이유", "")));
  ok("「회수 접수 실패」 꼴도 집는다", /→ 해결됨/.test(고친다("회수 접수 실패 — 이유", "T1")));

  ok("★ 성공할 때 부른다 (요청 처리기)", /if \(성공\) \{[\s\S]{0,200}_cpr_resolveFailCell_/.test(cs));
  const fill = fs.readFileSync("csLogenSlipFill.gs", "utf8");
  ok("★ 송장을 채울 때도 부른다 (두 경로 다)",
     (fill.match(/_cpr_resolveFailCell_/g) || []).length >= 4);
  /*  ★ 송장이 아니라 «접수번호»가 나온 순간 고친다 ★ 송장이 늦게 나오는 건은
      그 사이 내내 「실패」로 보인다. 202610!36 이 접수 상태로 멈춰 그랬다. */
  ok("★ 접수번호만 나와도 고친다 (송장을 안 기다린다)",
     /if \(고른\.takeNo\) \{[\s\S]{0,140}_cpr_resolveFailCell_/.test(fill));
  ok("안 바뀌었으면 시트를 안 건드린다", /if \(후 === 전\) return false;/.test(cs));
}

console.log("\n[11] ★ 「/ 택배사」만 있는 칸은 «비어 있는» 것이다");
{
  /*  대장 반품송장 칸은 「번호 / 택배사」 꼴이다. 번호 없이 택배사만 남는 일이
      있다 — 202610!36 의 "/ 로젠택배". 칸이 비었는지로 보면 «차 있다»로 읽혀
      그 줄은 영영 안 채워지고, 지난 실패 줄도 영영 안 고쳐진다.
      모르는 것과 비어 있는 것은 다르다 — 그 뒤집힌 꼴이다. */
  const fill = fs.readFileSync("csLogenSlipFill.gs", "utf8");
  const vm2 = require("vm");
  const c2 = { console, String, Number, Array, Math, JSON,
    _cs_splitLedgerInvoice_: (cell) => {
      const s2 = String(cell == null ? "" : cell).trim();
      const at = s2.lastIndexOf("/");
      if (at < 0) return { 번호: s2, 택배사: "" };
      return { 번호: s2.slice(0, at).trim(), 택배사: s2.slice(at + 1).trim() };
    } };
  vm2.createContext(c2);
  vm2.runInContext(fill.slice(fill.indexOf("function _lsf_hasInvoiceNo_")), c2);
  const 있나 = (v) => vm2.runInContext("_lsf_hasInvoiceNo_(" + JSON.stringify(v) + ")", c2);

  ok("★ 「/ 로젠택배」 는 비어 있다", 있나("/ 로젠택배") === false);
  ok("빈 칸도 비어 있다", 있나("") === false);
  ok("번호가 있으면 차 있다", 있나("45324003760") === true);
  ok("「번호 / 택배사」도 차 있다", 있나("45324003760 / 로젠택배") === true);
  ok("★ 모을 때 그 자를 쓴다", /_lsf_hasInvoiceNo_\(row\[col\.returnInvoice\]\)/.test(fill));
  ok("적기 직전에도 그 자를 쓴다", (fill.match(/_lsf_hasInvoiceNo_\(cell/g) || []).length >= 2);
}

console.log("\n[12] ★ 수거입력처가 없는 탭에서도 «집는다»");
{
  /*  ★ 이 시험이 생긴 까닭 ★  (2026-10-08)
      자동 채우기는 「로젠 건만」을 수거입력처로 걸렀다. 그런데 202610 탭에는
      그 열이 **아예 없다** — pk 가 빈 글자가 되어 indexOf 가 -1 이고, 그 탭의
      **모든 줄을 건너뛰었다.** 그 탭에서는 한 줄도 본 적이 없다.

      같은 전제로 반품접수도 롯데로 가고 있었다(csLotteReturn.gs). 두 곳이
      같은 자리에서 틀렸다 — 「수거입력처가 있다」는 전제. 그 열의 94%가 비어
      있다는 것은 csLotteReturn.gs 머리말에 이미 적혀 있었다. */
  const vm = require("vm");
  const fill = fs.readFileSync("csLogenSlipFill.gs", "utf8");
  const lotte = fs.readFileSync("csLotteReturn.gs", "utf8");
  const ord = fs.readFileSync("csOrderSearch.gs", "utf8");
  const trk = fs.readFileSync("csTrack.gs", "utf8");
  function 꺼내(s, n) {
    const i = s.indexOf("function " + n + "(");
    if (i < 0) throw new Error(n + " 를 못 찾음");
    let d = 0, seen = false;
    for (let k = i; k < s.length; k++) {
      if (s[k] === "{") { d++; seen = true; }
      else if (s[k] === "}") { d--; if (seen && d === 0) return s.slice(i, k + 1); }
    }
  }
  const ctx = { console, String, Number, Array, Math, JSON };
  vm.createContext(ctx);
  [[ord, "_cs_splitLedgerInvoice_"], [trk, "_trk_carrier_"],
   [lotte, "_lrt_guessCarrier_"], [fill, "_lsf_guessCarrier_"]]
    .forEach(([s, n]) => vm.runInContext(꺼내(s, n), ctx));
  const g = (a, b) => vm.runInContext(
    "_lsf_guessCarrier_(" + JSON.stringify(a) + "," + JSON.stringify(b) + ")", ctx);

  ok("★ 실제 202610!36 을 로젠으로 본다", g("/ 로젠택배", "45311894913") === "로젠");
  ok("★ 로젠 11자리만 있어도 로젠", g("", "45311894913") === "로젠");
  ok("★ 롯데 12자리는 롯데 (안 집는다)", g("", "268334465383") === "롯데");
  ok("반품송장에 적힌 택배사가 먼저다", g("268334465383 / 롯데택배", "45311894913") === "롯데");
  ok("근거가 없으면 로젠 (지금 쓰는 택배사)", g("", "") === "로젠");

  ok("★ 수거입처가 비면 건너뛰지 않는다",
     /} else if \(_lsf_guessCarrier_\(row\[col\.returnInvoice\], row\[col\.invoice\]\) !== "로젠"\)/.test(fill));
  ok("★ 적혀 있으면 그것이 먼저다", /if \(pk\) \{\s*\n\s*if \(pk\.indexOf\("로젠"\) === -1\) continue;/.test(fill));
  ok("★ 판단하는 자는 _lrt_guessCarrier_ 하나다 (여기서 다시 안 짠다)",
     /typeof _lrt_guessCarrier_ === "function"/.test(fill));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
