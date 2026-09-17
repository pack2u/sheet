/**
 * 송장 배포 — 남의 송장을 찍지 않는다
 *
 *  > "송장배포시에 엄한 송장번호를 넣어서 문제가 없는것처럼 보이게 되는데..
 *  >  완전범죄를 노리는건가? 이런건은 전화가 오게 되있는데..."
 *  > "허브에도 없는거지.. 수집이 안된거니까.. 업체 시트에만 있는상황인데.."
 *  > "합포장,합배송으로 묶듯이 바로 위에 송장을 떡하니 넣어버리네"
 *    (2026-09-16)
 *
 *  ★ 한 뿌리다 ★
 *    업체가 주문 줄을 «복사»해 새 주문을 만들면 고유ID까지 따라온다. 그러면
 *      · 수집은 「이미 있는 고유ID」라며 그 줄을 건너뛴다 → 허브에 없다
 *        (「한두 건씩 수집이 안 된다」가 이것이다)
 *      · 배포는 그 고유ID로 줄을 찾는데 «두 줄»이 걸린다 → 둘 다에 같은
 *        송장을 적는다 → 바로 위 줄 송장이 아래에도 떡하니 찍힌다
 *    업체 화면에는 송장이 멀쩡하니 아무도 모르고, 물건을 못 받은 고객이
 *    전화를 걸어서야 드러난다.
 *
 *  지켜야 할 것
 *    · 고유ID가 «둘을 가리키면» 안 쓴다. 답이 없는 것이다.
 *    · 고유ID는 맞아도 내용(품목코드·수취인)이 어긋나면 안 쓴다.
 *    · 안 쓴 줄은 반드시 «말한다» — 조용히 건너뛰는 것도 완전범죄다.
 *    · 근거가 없을 때는 막지 않는다. 멀쩡한 배포를 멈추면 안 된다.
 *
 * 실행: node _pushguard_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const src = fs.readFileSync("_partnerOrders.gs", "utf8");
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext([grab("_po_vendorRowMismatch_"), grab("_po_normName_")].join("\n"), ctx);
const 어긋남 = (row, cMap, hub) =>
  vm.runInContext("_po_vendorRowMismatch_(" + JSON.stringify(row) + "," +
    JSON.stringify(cMap) + "," + JSON.stringify(hub) + ")", ctx);

const CMAP = { code: 2, recipient: 5, uniqueId: 9 };
const 업체줄 = (code, name) => { const r = []; r[2] = code; r[5] = name; r[9] = "0916-ds-ab12"; return r; };

console.log("\n[1] 같은 주문이면 통과");
{
  check("품목·수취인 같음", 어긋남(업체줄("MATYG0050", "김철수"), CMAP,
    { code: "MATYG0050", recipient: "김철수" }), "");
  check("표기 차이는 같은 것으로 본다 (공백·괄호)",
    어긋남(업체줄("MATYG0050", "김 철수 (본점)"), CMAP,
      { code: "MATYG0050", recipient: "김철수(본점)" }), "");
  check("대소문자 차이도 같은 것", 어긋남(업체줄("matyg0050", "김철수"), CMAP,
    { code: "MATYG0050", recipient: "김철수" }), "");
}

console.log("\n[2] ★ 품목이 다르면 안 쓴다");
{
  const 왜 = 어긋남(업체줄("AJ19500003", "김철수"), CMAP,
    { code: "MATYG0050", recipient: "김철수" });
  check("막는다", 왜 !== "", true);
  check("까닭을 말한다", 왜.indexOf("품목코드가 다릅니다") >= 0, true);
  check("양쪽 값을 다 보여 준다",
    왜.indexOf("AJ19500003") >= 0 && 왜.indexOf("MATYG0050") >= 0, true);
}

console.log("\n[3] ★ 품목이 같아도 수취인이 다르면 안 쓴다");
{
  const 왜 = 어긋남(업체줄("MATYG0050", "박영희"), CMAP,
    { code: "MATYG0050", recipient: "김철수" });
  check("막는다", 왜 !== "", true);
  check("까닭을 말한다", 왜.indexOf("수취인이 다릅니다") >= 0, true);
  check("양쪽 이름을 다 보여 준다",
    왜.indexOf("박영희") >= 0 && 왜.indexOf("김철수") >= 0, true);
}

console.log("\n[4] ★ 근거가 없으면 막지 않는다");
{
  /*  한쪽에 값이 없으면 판단할 근거가 없다. 근거 없이 막으면 멀쩡한
      배포가 멈춘다 — 막는 것은 «어긋난 것이 보일 때»뿐이다.  */
  check("업체 품목코드가 빔", 어긋남(업체줄("", "김철수"), CMAP,
    { code: "MATYG0050", recipient: "김철수" }), "");
  check("허브 품목코드가 빔", 어긋남(업체줄("MATYG0050", "김철수"), CMAP,
    { code: "", recipient: "김철수" }), "");
  check("수취인이 양쪽 다 빔", 어긋남(업체줄("MATYG0050", ""), CMAP,
    { code: "MATYG0050", recipient: "" }), "");
  check("칸 자체가 없는 시트", 어긋남(업체줄("MATYG0050", "김철수"),
    { code: -1, recipient: -1, uniqueId: 9 }, { code: "MATYG0050", recipient: "김철수" }), "");
  check("허브 정보가 통째로 없음", 어긋남(업체줄("MATYG0050", "김철수"), CMAP, null), "");
}

console.log("\n[5] ★ 한 탭에 같은 고유ID가 둘이면 안 쓴다");
{
  /*  「합포장·합배송으로 묶듯이 바로 위에 송장을 떡하니」가 이것이다.
      고유ID 하나가 두 줄을 가리키면 배포는 구별할 길이 없다.  */
  const i = src.indexOf("function partnerPushInvoices(");
  const 몸 = src.slice(i, i + 20000);
  check("탭마다 고유ID 수를 센다", /var uidSeen = \{\};/.test(몸), true);
  check("★ 둘 이상이면 건너뛴다", /if \(uidSeen\[rowUid\] > 1\)/.test(몸), true);
  check("어느 줄인지 적는다", 몸.indexOf("dupUidRows.push(") >= 0, true);
  check("★ 세는 것이 «쓰기 전»에 있다",
    몸.indexOf("var uidSeen = {};") < 몸.indexOf("if (uidSeen[rowUid] > 1)"), true);

  //  송장이 있을 때만 내용을 맞댄다 (적요·상태만 배포하는 건 막을 까닭이 없다)
  check("내용 대조는 송장이 있을 때만", /if \(_pv_\.invoice\) \{[\s\S]{0,200}_po_vendorRowMismatch_/.test(몸), true);
  check("어긋나면 건너뛴다", /mismatched\.push\(/.test(몸), true);
}

console.log("\n[6] ★ 안 쓴 줄을 «말한다» — 조용한 건너뜀도 완전범죄다");
{
  check("고유ID 겹침을 보고한다", src.indexOf("같은 고유ID가 한 탭에 여러 줄") >= 0, true);
  check("무엇을 해야 하는지 말한다",
    src.indexOf("고유ID 칸을 «비우고» 다시 수집하세요") >= 0, true);
  check("내용 어긋남도 보고한다", src.indexOf("고유ID는 맞는데 «내용이 다른» 줄") >= 0, true);
  check("Chat 카드에도 싣는다", src.indexOf("⛔ 고유ID가 겹친 줄") >= 0, true);

  /*  보고문이 «배포» 쪽에 있어야 한다. 수집 보고에 넣으면 그 변수가 없어
      ReferenceError 로 터진다 (2026-09-16 에 실제로 한 번 그랬다). */
  const 배포 = src.indexOf("📬 송장 배포 완료");
  //  주석이 아니라 «보고문»을 찾는다 — ⛔ 가 붙은 쪽이다
  const 겹침 = src.indexOf("⛔ 같은 고유ID가 한 탭에 여러 줄");
  check("★ 배포 보고 안에 있다", 겹침 > 배포, true);
}

console.log("\n[7] ★ 수집이 건너뛴 줄도 «말한다»");
{
  check("건너뛴 줄을 담는다", src.indexOf("var _건너뛴_ = []") >= 0, true);
  check("까닭을 함께 담는다", src.indexOf("_건너뜀_(_왜_, file.name, r + 1, uid, recipient, code, {") >= 0, true);
  /*  ★ 2026-09-18 ★ 되살리려면 «어느 파일 어느 탭»인지가 있어야 한다 */
  check("★ 파일ID·탭도 담는다", src.indexOf("파일ID: file.id, 탭: tabName,") >= 0, true);
  check("고유ID 중복이라는 까닭", src.indexOf("고유ID가 이미 허브에 있음") >= 0, true);
  check("재주문일 수 있다는 까닭", src.indexOf("재주문일 수 있음") >= 0, true);
  /*  ★ 2026-09-18 ★ 한 줄이 둘로 갈렸다 — 할 일이 정반대라서.
      «빠진» 줄은 되살려야 하고, «들어온» 줄은 지워야 한다. */
  check("보고에 «빠진» 줄을 싣는다",
    src.indexOf("⛔ 고유ID가 겹쳐 «빠진» 줄 ") >= 0, true);
  check("보고에 «들어온 의심» 줄도 싣는다",
    src.indexOf("⚠ 같은 사람·같은 물건이라 «의심»되지만 그대로 들어온 줄 ") >= 0, true);
  check("★ 업체·행·수취인·품목을 짚는다",
    /x\.업체 \+ " R" \+ x\.행/.test(src), true);
  /*  ★ 2026-09-18 ★ 60건은 «알림 글»의 사정이었다. 이제 탭에 쌓아 두고
      사람이 하나씩 보므로 그 한도에서 잘리면 61번째부터 «없는 일»이 된다. */
  check("끝없이 길어지지 않게 막는다", src.indexOf("if (_건너뛴_.length >= 500) return;") >= 0, true);
  check("★ 탭에도 세워 둔다", src.indexOf("_dse_record_(_건너뛴_)") >= 0, true);
}


console.log("\n[8] ★ 스마트 수집의 기준은 «시작 시각»이다");
{
  /*  > "이게 시간 제한떄문인건지? 조건이 허술해서인지.. 전에는 안그랬는데.."

      둘 다 아니었다. 스마트 수집이 「마지막 수집 이후 고쳐진 파일」만 읽는데,
      그 기준 시각을 수집이 «끝난» 뒤에 찍고 있었다.

        09:30:00  수집 시작, 아주팩 파일을 읽는다
        09:31:20  업체가 주문 한 줄을 넣는다   ← 파일 수정시각 09:31:20
        09:34:00  수집 끝. 기준 = 09:34:00 저장
        13:00:00  다음 수집 — 09:31:20 < 09:34:00 이라 «안 고쳐진 파일»로 보고
                  통째로 건너뛴다

      그 줄은 영영 안 들어온다. 수집이 도는 «그 몇 분» 사이에 들어온 주문만
      사라지므로 「한두 건씩」이다. 업체가 늘어 수집이 길어질수록 잦아진다.  */
  check("시작 시각을 잡는다", src.indexOf("var _수집시작_ = Date.now();") >= 0, true);
  check("★ 저장하는 값이 시작 시각이다",
    src.indexOf('props.setProperty("LAST_ORDER_COLLECT_TIME", String(_수집시작_));') >= 0, true);
  check("★ Date.now() 를 그대로 저장하지 않는다",
    src.indexOf('props.setProperty("LAST_ORDER_COLLECT_TIME", String(Date.now()));') >= 0, false);

  //  시작 시각은 파일을 «읽기 전»에 잡혀야 한다. 뒤에 잡으면 같은 창이 다시 열린다.
  const 시작 = src.indexOf("var _수집시작_ = Date.now();");
  const 목록 = src.indexOf("var files = _pt_listFiles();");
  const 읽기 = src.indexOf("var lastCollectTime = parseInt(props.getProperty");
  check("★ 파일 목록을 뜨기 전에 잡는다", 시작 >= 0 && 시작 < 목록, true);
  check("★ 지난 기준을 읽기 전에 잡는다", 시작 >= 0 && 시작 < 읽기, true);
}




console.log("\n[9] ★ 나가기 «직전»에 막는다 — 밤이 아니다");
{
  /*  > "오늘 주문건의 송장 입력은 3시 5시쯤에 해야되는데..
      >  밤에 검증을 한다는건 말이 안되"

      맞는 말이다. 밤에 알아봐야 이미 업체 시트에도 사방넷에도 나간 뒤다.
      처음엔 21:30 밤일에 붙였다가 되돌렸다.  */
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(grab("_po_sameInvoiceDifferentOrders_"), ctx);
  const 보기 = (pending) => {
    ctx.__p = pending; ctx.__w = [];
    const r = vm.runInContext("_po_sameInvoiceDifferentOrders_(__p, __w)", ctx);
    return { 막을것: r, 말: ctx.__w };
  };

  //  ① 같은 송장인데 합배송 표시가 없다 — 남의 송장이다
  {
    const r = 보기({
      "SB-1001": { invoice: "451694597", status: "발송완료", hubMemo: "" },
      "SB-2002": { invoice: "451694597", status: "발송완료", hubMemo: "" },
    });
    check("★ 둘 다 막는다", r.막을것.sort(), ["SB-1001", "SB-2002"]);
    check("어느 송장인지 말한다", r.말[0].indexOf("451694597") >= 0, true);
    check("몇 건인지 말한다", r.말[0].indexOf("2건") >= 0, true);
  }

  //  ② 합배송이라고 적혀 있으면 정상이다
  {
    const r = 보기({
      "SB-1001": { invoice: "451694597", status: "발송완료", hubMemo: "" },
      "SB-1002": { invoice: "451694597", status: "합배송", hubMemo: "" },
    });
    check("★ 안 막는다", r.막을것, []);
  }
  {
    const r = 보기({
      "SB-1001": { invoice: "451694597", status: "발송완료", hubMemo: "합배송 · 몸통" },
      "SB-1002": { invoice: "451694597", status: "발송완료", hubMemo: "" },
    });
    check("적요에 적혀 있어도 안 막는다", r.막을것, []);
  }

  //  ③ 송장이 다르면 상관없다
  {
    const r = 보기({
      "SB-1001": { invoice: "451694597", status: "발송완료", hubMemo: "" },
      "SB-2002": { invoice: "451694598", status: "발송완료", hubMemo: "" },
    });
    check("서로 다른 송장은 안 막는다", r.막을것, []);
  }

  //  ④ 한 칸에 송장이 여럿인 대표 줄 — 낱개로 갈라 본다
  {
    const r = 보기({
      "SB-1001": { invoice: "451694597\n451694598", status: "합배송", hubMemo: "" },
      "SB-2002": { invoice: "451694598", status: "발송완료", hubMemo: "" },
    });
    check("★ 한 칸 여러 송장도 갈라 본다 (합배송이라 통과)", r.막을것, []);
  }
  {
    const r = 보기({
      "SB-1001": { invoice: "451694597 451694598", status: "발송완료", hubMemo: "" },
      "SB-2002": { invoice: "451694598", status: "발송완료", hubMemo: "" },
    });
    check("★ 표시가 없으면 갈라 보고 막는다", r.막을것.sort(), ["SB-1001", "SB-2002"]);
  }

  //  ⑤ 송장이 없는 줄(적요만 배포)은 볼 것이 없다
  {
    const r = 보기({
      "SB-1001": { invoice: "", status: "출고가능", hubMemo: "" },
      "SB-2002": { invoice: "", status: "출고가능", hubMemo: "" },
    });
    check("송장 없는 줄은 안 본다", r.막을것, []);
  }
}

console.log("\n[10] 막은 것을 «말한다», 그리고 시트를 더 안 읽는다");
{
  const i = src.indexOf("function partnerPushInvoices(");
  const 몸 = src.slice(i, i + 24000);
  /*  ★ 먼저: 검사를 «부르는가» ★
      뺀 자리만 보면, 검사를 안 부르고 빈 배열을 넣어도 통과한다 —
      2026-09-16 에 그물을 시험하다 실제로 그렇게 빠져나갔다. */
  check("★ 검사를 부른다",
    몸.indexOf("var 막힌uid = _po_sameInvoiceDifferentOrders_(pendingByUid, 겹친송장);") >= 0, true);
  check("★ 배포 목록에서 뺀다", /delete pendingByUid\[막힌uid\[mb\]\]/.test(몸), true);
  check("★ 세기 «전»에 뺀다 (숫자가 맞아야 한다)",
    몸.indexOf("delete pendingByUid[막힌uid[mb]]") < 몸.indexOf("var pendingCount ="), true);
  check("보고에 적는다", src.indexOf("같은 송장이 «여러 주문»에 붙어 있어") >= 0, true);
  check("무엇을 해야 하는지 말한다", src.indexOf("어느 주문의 송장인지 정한 뒤 다시 배포") >= 0, true);
  check("Chat 카드에도", src.indexOf("⛔ 같은 송장·여러 주문") >= 0, true);

  /*  시트를 더 읽으면 배포가 느려지고, 느려지면 16:50 이 밀린다. */
  const 검사몸 = grab("_po_sameInvoiceDifferentOrders_");
  check("★ 시트를 안 읽는다", /getRange|openById|getSheet/.test(검사몸), false);
}

console.log("\n[11] 전체 점검은 «수집 직후»에 돈다");
{
  const iod = fs.readFileSync("_partnerInvoiceOwnerDiag.gs", "utf8");
  const web = fs.readFileSync("_partnerWebApp.gs", "utf8");
  const mirror = fs.readFileSync("_partnerReturnsV2Mirror.gs", "utf8");

  check("이름이 «수집 뒤»다", iod.indexOf("function _iod_afterFetch_()") >= 0, true);
  check("★ 송장 수집 트리거에 물려 있다", web.indexOf("_iod_afterFetch_()") >= 0, true);
  check("★ 수집이 «끝난 뒤»에 부른다",
    web.indexOf("허브 송장 수집 완료") < web.indexOf("_iod_afterFetch_()"), true);
  check("★ 밤일에서는 뺐다", /_iod_nightly_|_iod_afterFetch_/.test(mirror), false);
  check("곁다리로 감싼다", /_iod_afterFetch_\(\);\s*\}\s*catch \(eIod\)/.test(web), true);
  check("찾았을 때만 말한다", /if \(!r\.sure\) return;/.test(iod), true);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
