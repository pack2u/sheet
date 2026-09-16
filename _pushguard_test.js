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
  check("까닭을 함께 담는다", src.indexOf("_건너뜀_(_왜_, file.name, r + 1, uid, recipient, code)") >= 0, true);
  check("고유ID 중복이라는 까닭", src.indexOf("고유ID가 이미 허브에 있음") >= 0, true);
  check("재주문일 수 있다는 까닭", src.indexOf("재주문일 수 있음") >= 0, true);
  check("보고에 싣는다", src.indexOf("↷ 중복이라 건너뛴 줄") >= 0, true);
  check("★ 업체·행·수취인·품목을 짚는다",
    /x\.업체 \+ " R" \+ x\.행/.test(src), true);
  check("끝없이 길어지지 않게 막는다", src.indexOf("if (_건너뛴_.length >= 60) return;") >= 0, true);
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


console.log("\n[9] ★ 밤마다 «결과»를 본다 — 남의 송장이 붙었나");
{
  /*  > "다른 주문번호에 송장이 붙어 버리네.. 시스템의 오류가 너무 많아 신뢰가 없네"

      코드마다 그물을 놓는 것은 «아는 구멍»에만 듣는다. 이 점검은 까닭을 묻지
      않고 결과를 본다 — 한 송장이 여러 주문에 붙었는데 합포장이 아니면
      무언가 틀린 것이다. 어느 코드가 그랬든 걸린다.  */
  const iod = fs.readFileSync("_partnerInvoiceOwnerDiag.gs", "utf8");
  const mirror = fs.readFileSync("_partnerReturnsV2Mirror.gs", "utf8");

  check("밤에 도는 함수가 있다", iod.indexOf("function _iod_nightly_()") >= 0, true);
  check("★ 밤일에 물려 있다", mirror.indexOf("_iod_nightly_()") >= 0, true);
  check("★ 곁다리로 감싼다 (실패해도 미러는 끝났다)",
    /_iod_nightly_\(\);\s*\}\s*catch \(e4\)/.test(mirror), true);

  check("★ 찾았을 때만 말한다", /if \(!r\.sure\) return;/.test(iod), true);
  check("의심(🟡)만으로는 안 알린다 (오탐이 섞인다)",
    /if \(!r\.sure\) return;[\s\S]{0,200}_chat_sendCard_/.test(iod), true);
  check("무엇을 보는지 카드에 적는다",
    iod.indexOf("한 송장이 여러 주문에 붙었는데 합포장이 아닌 것") >= 0, true);
  check("어디서 다시 보는지도 적는다", iod.indexOf("송장 소유권 점검") >= 0, true);

  /*  돌려주는 «글»을 다시 뜯어 세면 문구를 바꿀 때마다 조용히 틀린다.
      숫자는 숫자로 남긴다.  */
  check("★ 셈을 숫자로 남긴다", iod.indexOf("_IOD_LAST_ = { sure: counts.sure") >= 0, true);
  check("★ 글을 뜯어 세지 않는다",
    /_IOD_LAST_[\s\S]{0,400}msg\.match|msg\.indexOf\("🔴/.test(iod), false);

  //  7일만 본다 — 14일은 마감 파일을 그만큼 열어 밤일을 밀어낸다
  check("밤에는 좁게 본다", /partnerDiagnoseInvoiceOwnership\(7\)/.test(iod), true);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
