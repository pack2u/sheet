/**
 * 합배송 — 대표의 송장을 동봉 형제에게도 붙이는가
 *
 *  > "합배송이 발주허브에는 합배송은 대표만 송장이 들어가고 송장번호가
 *  >  안들어가네.. 대표 송장번호가 들어가고 나머지 주문건 적요에
 *  >  합배송이라고 적혀야 되는데.."
 *
 *  ★ 이름으로 묶는 것이 문제였다 ★
 *    여태 «수취인 이름»으로 묶었다. 이름은 짐작이다 —
 *      · 동명이인이면 남의 주문이 한 박스로 묶이고
 *      · 이름이 조금만 달라도(괄호·별칭) 같은 박스가 갈라져 대표만 송장을 받는다
 *    뉴 합배송 탭은 「합포장키」를 «적어 준다». 세트분리가 실제로 한 박스에
 *    담은 묶음의 이름이다. 적힌 것을 쓰면 짐작할 일이 없다.
 *
 * 실행: node _po_merge_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const src = fs.readFileSync("_partnerOrders.gs", "utf8");
const core = fs.readFileSync("세트분리V2/core.js", "utf8");

console.log("");
console.log("[읽기] 합배송 탭에서 무엇을 읽는가");
check("★ 합포장키 칸을 찾는다", src.indexOf('_uh === "합포장키"') >= 0, true);
check("고유ID 칸도 이름으로 찾는다", src.indexOf('_uh === "사방넷주문번호"') >= 0, true);
check("★ 고유ID → 합포장키 를 담아 둔다", src.indexOf("combinedKeyByUid[_csUid] = _csGrp;") >= 0, true);

console.log("");
console.log("[공백] 머리글 공백 지우기가 살아 있는가");
check("★ replace(/s/g) 가 사라졌다 — 영문 s 만 지우던 것",
  src.indexOf('String(_csHeaders[_ui]).replace(/s/g, "")') >= 0, false);
check("역슬래시 없는 꼴로 지운다",
  src.indexOf('String(_csHeaders[_ui]).split(" ").join("")') >= 0, true);

console.log("");
console.log("[묶기] 적힌 키가 이름보다 앞선다");
check("★ 합포장키가 있으면 그것으로 묶는다", src.indexOf('cKey = "키:" + cKey;') >= 0, true);
check("없을 때만 이름으로", src.indexOf('cKey = "이름:" + cName;') >= 0, true);
check("★ 어느 쪽으로 몇 줄 묶었는지 말한다",
  src.indexOf("합포장키 \" + _grpByKey + \"줄 · 이름으로 \" + _grpByName") >= 0, true);

console.log("");
console.log("[동봉] 대표의 송장을 나머지에 붙인다");
check("그룹이 2줄 이상일 때만 합배송", src.indexOf("if (cGrpRows.length < 2) continue;") >= 0, true);
check("★ 송장 있는 줄을 대표로 삼는다", src.indexOf("sourceInv = cInv;") >= 0, true);
check("★ 송장 없는 줄에 같은 송장을 넣는다", src.indexOf("hubData[ridx][13] = sourceInv;") >= 0, true);
check("★ 그 줄 상태를 「합배송」으로", src.indexOf('status: "합배송",') >= 0, true);
/*  옛 문구 「합발송완료」를 사실로 못 박던 줄이었다. 2026-09-15 에
    「합배송 · 몸통만」 처럼 사람이 읽는 말로 바꿨다. */
check("★ 적요에 「합배송」을 적는다",
  src.indexOf('hubData[hubIdx][12] = "합배송"') >= 0, true);
check("이미 송장이 있으면 안 덮는다", src.indexOf("if (_po_hasRealInvoice_(existInv)) continue;") >= 0, true);

console.log("");
console.log("[원천] 뉴 합배송 탭에 그 칸이 정말 있는가");
check("★ 세트분리 합배송 머리글에 합포장키가 있다",
  core.indexOf("var SS_MERGED_HEADER = ['구분', '조건ID', '실제경로', '합포장키']") >= 0, true);
check("사방넷주문번호도 있다 (SS_OUT_HEADER)",
  core.indexOf("'적요', '사방넷주문번호'") >= 0, true);
{
  //  SS_MERGED_HEADER = 앞 4칸 + SS_OUT_HEADER → 자리를 세어 둔다
  const m = core.match(/var SS_OUT_HEADER = \[([\s\S]*?)\];/);
  const cols = (m[1].match(/'[^']+'/g) || []).map((x) => x.replace(/'/g, ""));
  const 앞 = ["구분", "조건ID", "실제경로", "합포장키"];
  const 전체 = 앞.concat(cols);
  check("합포장키 = 4번째 칸(D)", 전체.indexOf("합포장키"), 3);
  check("★ 사방넷주문번호는 Q(16)가 아니다 — 옛 자리로 읽으면 안 된다",
    전체.indexOf("사방넷주문번호") === 16, false);
  check("실제 자리", 전체.indexOf("사방넷주문번호"), 19);
}

console.log("");
console.log("");
console.log("[차수] 합배송이 차수별로 잡히는가");
//  세트분리 「합배송」 탭은 ssio_write 라 회차마다 덮어써진다.
//  「주문라인원장」은 ssio_append 라 회차별로 쌓인다 — 거기서 읽어야 1·2차가 산다.
check("★ 원장에서도 묶음키를 읽는다",
  src.indexOf('_csSS.getSheetByName("주문라인원장")') >= 0, true);
check("합포장그룹 칸을 이름으로 찾는다", src.indexOf('_lgH["합포장그룹"]') >= 0, true);
check("사방넷주문번호 칸도", src.indexOf('_lgH["사방넷주문번호"]') >= 0, true);
check("★ 회차키를 묶음 이름에 붙인다 — 다른 날 같은 그룹번호와 안 섞이게",
  src.indexOf('(_rk ? _rk + "/" : "") + _g') >= 0, true);
check("몇 건 읽었는지 말한다", src.indexOf("원장(차수별 누적)에서 묶음키 ") >= 0, true);
{
  const setsplit = fs.readFileSync("세트분리V2/gasMain.js", "utf8");
  check("★ 합배송 탭은 정말 덮어써진다 (ssio_write)",
    setsplit.indexOf("ssio_write(SSIO_TABS.합배송") >= 0, true);
  check("★ 원장은 정말 쌓인다 (ssio_append)",
    setsplit.indexOf("ssio_append(SSIO_TABS.원장") >= 0, true);
}

console.log("");
console.log("[지움] 일일마감에서 뺀 두 원천이 다시 안 들어왔는가");
{
  const push = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
  check("★ 허브 월별 아카이브(b1d) 없음",
    push.indexOf("_ha_addHubArchiveToInvoiceMap_") >= 0, false);
  check("★ 이름+전화 폴백(d, 3-3_병합) 없음",
    push.indexOf("_PT_NAME_PHONE_FALLBACK_GID") >= 0, false);
  check("왜 지웠는지 적어 두었다",
    push.indexOf("이름과 전화로 사람을 짚는 것은 짐작이다") >= 0, true);
}

console.log("");
console.log("[적요] 사람이 읽고 바로 아는 말인가");
check("★ 「합발송완료」가 아니라 「합배송」", src.indexOf('"합발송완료"') >= 0, false);
check("합배송이라고 적는다", src.indexOf('hubData[hubIdx][12] = "합배송"') >= 0, true);
check("★ 세트 상세를 함께 적는다", src.indexOf('(_det ? " · " + _det : "")') >= 0, true);
check("합배송이 아니어도 세트 상세는 적는다", src.indexOf("} else if (_det) {") >= 0, true);

console.log("");
console.log("[세트] 몸통·뚜껑을 어디서 얻는가");
check("★ 송장맵이 실어 온 것이 먼저", src.indexOf("upd.setDetail || setDetailByUid[") >= 0, true);
check("없으면 원장에서 모은 것", src.indexOf("var setDetailByUid = {};") >= 0, true);
check("품목명의 --- 꼬리표를 본다", src.indexOf('var _dash = _nm.indexOf("---");') >= 0, true);
/*  이 줄은 «걸러 내는 것»을 사실로 못 박고 있었다. 2026-09-15:
    "===합배송도 ---합포장도.." — 가르지 않고 다 적는다. */
check("★ === 를 --- 보다 먼저 본다 (둘 다 붙은 줄)",
  src.indexOf("if (_eq >= 0 && (_dash < 0 || _eq < _dash))") >= 0, true);
check("한 주문에 둘이면 / 로 잇는다", src.indexOf('setDetailByUid[_su] + " / " + _tail') >= 0, true);
check("같은 꼬리를 두 번 안 적는다", src.indexOf("if (_setSeen[_sk]) continue;") >= 0, true);

{
  //  꼬리표 떼기 — 코드와 «같은 규칙»을 여기에 옮겨 적는다
  const 떼기 = (nm) => {
    let t = "";
    const eq = nm.indexOf("===");
    const dash = nm.indexOf("---");
    if (eq >= 0 && (dash < 0 || eq < dash)) {
      t = nm.substring(eq + 3).trim().split("---").join(" · ").trim();
    } else if (dash >= 0) {
      t = nm.substring(dash + 3).trim().split("===").join(" · ").trim();
    }
    if (!t || t.length > 24) return "";
    return t;
  };
  check("세트 — ---몸통만", 떼기("JH 300파이 소 백색 ---몸통만"), "몸통만");
  check("세트 — ---뚜껑만", 떼기("JH 300파이 소 백색 ---뚜껑만"), "뚜껑만");
  check("★ 합포장도 적는다", 떼기("무언가 ---2개 합포장(완박스)"), "2개 합포장(완박스)");
  check("★ 합배송도 적는다", 떼기("무언가 ===합배송"), "합배송");
  check("★ 둘 다 붙은 줄", 떼기("무언가 ===합배송---뚜껑만"), "합배송 · 뚜껑만");
  check("꼬리 없으면 빈칸", 떼기("그냥 품목명"), "");
  check("품목명을 통째로 물면 안 적는다",
    떼기("무언가 ---" + "가".repeat(30)), "");
}

console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
