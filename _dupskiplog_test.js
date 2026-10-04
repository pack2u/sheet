/**
 * 중복의심_수집 — 빠진 줄과 들어온 줄을 갈라 세우고 «되살린다»
 *
 *   > "중복으로 주문수집에서 뺀것들만 따로 보이게 해줘 체크하고 직접 확인 조치하게"
 *   > "아니 주문수집에서 빼지는 말고 지금처럼 경고만 날려줘..."
 *   > "고유아이디가 둘이면 중복이니 빼는게 맞아.."
 *
 * 이 기능은 «남의 파일을 고친다» — 업체 시트의 고유ID 칸을 비운다.
 * 그래서 여기서 박는 것은 하나다 — 어긋나면 «안 건드리는가».
 * 엉뚱한 줄의 고유ID를 비우면 그 주문이 통째로 다시 들어온다(이중출고).
 *
 * 실행: node _dupskiplog_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

const LOG = fs.readFileSync("_partnerDupSkipLog.gs", "utf8");
const ORD = fs.readFileSync("_partnerOrders.gs", "utf8");
const MENU = fs.readFileSync("_partnerMenu.gs", "utf8");
const hasL = (s) => LOG.indexOf(s) >= 0;
const hasO = (s) => ORD.indexOf(s) >= 0;

function body(src, name, len) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return "";
  return src.substring(at, at + (len || 9000));
}

/* ── [1] 수집이 자료를 «넘기는가» ───────────────────────── */
console.log("\n[1] 수집 쪽 배선");
{
  ok("★ 수집이 끝나면 탭에 적재한다", hasO("if (typeof _dse_record_ === \"function\") _dse_record_(_건너뛴_);"));
  //  ★ 적재가 터져도 수집은 끝나야 한다 ★ 수집이 죽으면 그날 발주가 통째로 없다
  ok("★ 적재가 터져도 수집은 안 죽는다", hasO('Logger.log("[수집제외] 탭 적재 실패: " + eDse.message);'));

  //  탭에 쌓아 두고 사람이 하나씩 볼 것이면 60건 한도는 너무 얕다
  ok("★ 한도를 500으로 올렸다", hasO("if (_건너뛴_.length >= 500) return;"));
  ok("  60건 한도가 남아 있지 않다", !hasO("if (_건너뛴_.length >= 60) return;"));

  //  ★ 되살리려면 «어느 파일 어느 탭 어느 행»인지가 있어야 한다 ★
  ok("★ 파일ID·탭을 같이 넘긴다", hasO("파일ID: file.id, 탭: tabName,"));

  /*  ★ 2026-09-18 ★ 두 규칙이 하는 일이 갈렸다
      > "아니 주문수집에서 빼지는 말고 지금처럼 경고만 날려줘..."
      > "고유아이디가 둘이면 중복이니 빼는게 맞아.."   */
  ok("★ 고유ID 겹침은 여전히 «뺀다»", hasO("구분: _PO_DUP_OUT_,") && hasO("if (isDup) {"));
  ok("★ 사람·물건 겹침은 «안 뺀다» (continue 가 없다)",
    hasO("if (_의심_) {") && hasO("//  ★ 빼지 않는다 ★ 태워 보내고 말만 한다"));
  ok("  그 줄은 구분이 «들어옴»", hasO("구분: _PO_DUP_IN_,"));
  ok("★ 2차 규칙이 isDup 을 더는 세우지 않는다", !hasO("              isDup = true;"));
  ok("  카운트 차감은 그대로 (다음 동일 건은 통과)",
    hasO("existingKeyCount[dupKey] = hubCount - 1;"));
  ok("★ 들어온 의심 줄을 «센다»", hasO("_의심건수_++;"));
  ok("★ 챗 카드가 둘을 갈라 말한다",
    hasO("dupIn: _의심건수_,") && hasO("dupOut: _건너뛴_.length - _의심건수_,"));
  ok("  카드에 빠진 줄을 싣는다", hasO("label: \"⛔ 고유ID 겹쳐 빠짐\","));
  ok("  카드에 들어온 의심 줄도 싣는다", hasO("label: \"⚠ 중복의심인데 들어옴\","));
  ok("★ 알림 글도 둘을 갈라 적는다",
    hasO("⛔ 고유ID가 겹쳐 «빠진» 줄 ") && hasO("⚠ 같은 사람·같은 물건이라 «의심»되지만 그대로 들어온 줄 "));
  ok("  전화·품목명·수량도 넘긴다", hasO("전화: phoneRaw,") && hasO("품목명: itemName, 수량: qtyStr,"));

  //  ★ 짝이 되는 허브 줄 ★ 없으면 사람이 허브를 처음부터 뒤져야 한다
  ok("★ 고유ID가 앉은 허브 행을 기억한다", hasO("existingIdRow[String(hubAllData[ei][2])] = ei + 2;"));
  ok("★ 2차 키가 앉은 허브 행도 기억한다", hasO("existingKeyRows[eKey].push(ei + 2);"));
  ok("  건너뛸 때 그 행을 실어 보낸다", hasO("짝행: _짝행_,"));
  //  허브가 비어 있던 회차엔 이 표들이 없다 — 참조하면 터진다
  ok("★ 허브가 비었을 때를 막는다", hasO("isDup && existingIdRow ? (existingIdRow[uid] || '') : ''"));
}

/* ── [2] 쌓이기만 하지 않는가 ───────────────────────────── */
console.log("\n[2] 같은 줄이 회차마다 또 쌓이지 않는다");
{
  const b = body(LOG, "_dse_record_");
  ok("★ (파일·탭·행·고유ID)로 이미 있는지 본다", b.indexOf("if (이미[key]) continue;") >= 0);
  //  ★ 끝난 줄이 또 걸리면 그건 «또 걸렸다»는 새 소식이다 — 다시 떠야 한다
  ok("★ 확인·무시로 끝낸 줄은 다시 뜬다", b.indexOf("if (끝났나) continue;") >= 0);
  ok("  까닭도 적어 뒀다", b.indexOf("끝난 줄이면 다시 뜨는 게 맞다") >= 0);
  ok("★ 30일 지난 줄은 정리한다", hasL("var _DSE_KEEP_DAYS_ = 30;") && b.indexOf("_dse_trim_(tab);") >= 0);
}

/* ── [3] 사람이 «고르고 실행»할 수 있는가 ───────────────── */
console.log("\n[3] 체크하고 조치하기");
{
  ok("★ 확인 체크박스를 넣는다", hasL('tab.getRange(start, _dse_col_("확인"), rows.length, 1).insertCheckboxes();'));
  //  ★ 손으로 적게 하면 오타로 안 먹는다 ★ 고르는 칸이어야 한다
  ok("★ 조치는 «고르는» 칸이다 (목록 고정)", hasL("requireValueInList([_DSE_ACT_NONE_, _DSE_ACT_RECOLLECT_, _DSE_ACT_IGNORE_], true)"));
  ok("  잘못 적은 값은 안 받는다", hasL(".setAllowInvalid(false)"));
  eq("고를 것은 「새 주문 — 다시 수집」", hasL('var _DSE_ACT_RECOLLECT_ = "새 주문 — 다시 수집";'), true);
  eq("그리고 「진짜 중복 — 무시」", hasL('var _DSE_ACT_IGNORE_ = "진짜 중복 — 무시";'), true);
  ok("★ 메뉴에 목록 보기가 있다", MENU.indexOf('"partnerDupSkipOpen"') >= 0);
  ok("★ 메뉴에 되살리기가 있다", MENU.indexOf('"partnerDupSkipRetry"') >= 0);
  //  ★ «없는 줄»과 «있는 줄»을 색으로 가른다 ★ 할 일이 정반대다
  ok("빠진 줄과 들어온 줄을 색으로 가른다",
    hasL('.setBackground(구분 === _PO_DUP_IN_ ? "#fffbe6" : "#fdecea");'));
  ok("★ 구분 값이 둘로 못 박혀 있다",
    hasL('var _PO_DUP_OUT_ = "⛔ 빠짐(고유ID 겹침)";') &&
    hasL('var _PO_DUP_IN_ = "⚠ 들어옴(중복의심)";'));
}

/* ── [4] ★ 남의 파일을 고치기 전에 따져 보는가 ★ ───────── */
console.log("\n[4] 어긋나면 안 건드린다");
{
  const b = body(LOG, "partnerDupSkipRetry");
  ok("함수가 있다", b.length > 0);
  //  적힌 고유ID와 지금 고유ID가 다르면, 비우는 칸은 «엉뚱한 주문»의 것이다
  ok("★ 고유ID가 바뀌었으면 손대지 않는다",
    b.indexOf("if (uid && curUid !== uid) {") >= 0 &&
    b.indexOf("고유ID가 바뀌었습니다") >= 0);
  ok("★ 수취인이 다르면 손대지 않는다", b.indexOf("수취인이 다릅니다") >= 0);
  ok("★ 품목코드가 다르면 손대지 않는다", b.indexOf("품목코드가 다릅니다") >= 0);
  ok("  까닭을 적어 둔다 (왜 이렇게까지 따지는지)",
    b.indexOf("엉뚱한 주문»의 고유ID다") >= 0);
  ok("★ 행이 지워졌으면 손대지 않는다", b.indexOf("행이 없습니다") >= 0);
  ok("★ 고유ID 칸이 없는 탭이면 손대지 않는다", b.indexOf("고유ID 칸이 없습니다") >= 0);
  ok("★ 파일을 못 열면 «못 연다»고 말한다", b.indexOf("파일을 못 엽니다") >= 0);
  ok("★ 옛 줄(파일ID 없음)은 건너뛴다", b.indexOf("파일·탭·행 정보가 모자랍니다") >= 0);

  //  같은 줄을 두 번 누르면 이미 빈 칸을 또 비운다 — 무해하지만 숫자가 거짓이 된다
  ok("★ 이미 지운 줄은 다시 안 센다",
    b.indexOf('if (String(all[i][cRes] || "").trim().indexOf("고유ID 지움") === 0) continue;') >= 0);

  ok("★ 6분에 걸리기 전에 멈춘다", b.indexOf("예산 = 4 * 60 * 1000") >= 0);
  ok("  다시 누르면 이어서 한다고 말한다", b.indexOf("다시 누르면 이어서 합니다") >= 0);

  /*  ★ 숫자가 안 맞으면 그 표 전체를 못 믿는다 ★  (2026-09-17 에 배운 것) */
  ok("★ 합이 맞는지 스스로 본다", b.indexOf("var 셈합 = done + 어긋남 + 못열음;") >= 0);
  ok("  안 맞으면 «안 맞는다»고 말한다", b.indexOf("숫자가 안 맞습니다") >= 0);

  //  되살린 뒤 무엇을 해야 하는지 말하지 않으면 사람이 또 묻는다
  ok("★ 다음에 뭘 해야 하는지 말한다", b.indexOf("발주 수집을 한 번 돌리면") >= 0);
  ok("★ 고른 줄이 없으면 어디서 고르는지 알려 준다", b.indexOf("C열(조치)에서") >= 0);

  /*  ★ 「들어옴」 줄을 되살리면 «내가» 이중출고를 만든다 ★  (2026-09-18)
      그 주문은 이미 허브에 있다. 고유ID 를 비우면 한 줄이 더 들어온다. */
  ok("★ 이미 들어온 줄은 되살리지 않는다",
    b.indexOf("if (String(all[i][cKind] || \"\").trim() === _PO_DUP_IN_) {") >= 0);
  ok("  왜 안 하는지 그 칸에 적는다",
    b.indexOf("이미 허브에 들어와 있습니다 — 되살릴 것이 없습니다") >= 0);
  ok("  까닭도 적어 뒀다", b.indexOf("막으려던 이중출고를 내가 만드는 꼴이다") >= 0);
  ok("  건너뛴 수도 센다", b.indexOf("이미들어옴++;") >= 0);
}

/* ── [5] 자료가 조용히 망가지지 않는가 ──────────────────── */
console.log("\n[5] 서식");
{
  //  고유ID·전화·품목코드는 선행 0 이 날아가면 다시 못 찾는다
  /*  ★ 열을 글자·숫자로 박으면 헤더가 하나 늘 때 «조용히» 어긋난다 ★
      2026-09-18 에 「구분」을 더하며 실제로 한 칸씩 밀렸다. */
  ok("★ 선행 0 이 날아갈 칸을 이름으로 찾아 고정한다",
    hasL('var _DSE_TEXT_COLS_ = ["수집시각", "행", "전화번호", "품목코드", "고유ID", "허브 짝줄"];'));
  ok("  열 글자를 직접 안 쓴다", !hasL('getRange("L2:L")'));
  ok("파일ID 칸은 숨긴다 (기계가 쓰는 칸)", hasL('tab.hideColumns(_dse_col_("파일ID"));'));
  //  열 번호를 손으로 세면 헤더가 하나 늘 때 조용히 어긋난다
  ok("★ 열을 이름으로 찾는다", hasL("function _dse_col_(name)"));
  ok("  코드가 숫자를 직접 안 쓴다", hasL('_dse_col_("고유ID")') && hasL('_dse_col_("조치")'));
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
