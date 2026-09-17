/**
 * 「임시기록에만 담기」 회차 (10:30 · 15:40)
 *
 *  > "10시 30분 발주푸시...임시기록에만 저장하고 발주푸시는 안함"
 *  > "오후3시 40분 임시기록에만 저장하고 발주 푸시는 안함"
 *  > "결론.. 발주 푸시는 오후 1시50분에만함"
 *
 *  ★ 여기는 업체로 «실제 발주»가 나가는 길이다 ★
 *    틀리면 물건이 안 나가거나 두 번 나간다. 네 가지를 박아 둔다 —
 *      ① 임시기록에만 담는 회차는 업체 파일을 «열지도» 않는다
 *      ② 담긴 줄은 「발주대기」다 — 안 나간 것을 나갔다고 적지 않는다
 *      ③ 13:50 푸시가 그 줄을 되살려 태운다 (원천에서 사라져도 안 잃는다)
 *      ④ 나간 뒤에만 「발주완료」로 바꾼다 (끊긴 채로 바꾸면 영영 안 나간다)
 *
 *  ★ 정규식을 쓰지 않는다 ★ 백슬래시가 먹혀 헛시험이 되는 일이 잦았다.
 *
 * 실행: node _temponly_test.js
 */
const fs = require("fs");
const vm = require("vm");

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

const PUSH = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
const WEB = fs.readFileSync("_partnerWebApp.gs", "utf8");

function fnFrom(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) throw new Error("못 찾음: " + name);
  let depth = 0;
  const open = src.indexOf("{", at);
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error("안 닫힘: " + name);
}

/* ── 판 만들기 ─────────────────────────────────────────── */
function 판(옵션) {
  옵션 = 옵션 || {};
  const 쓴것 = [];
  const 탭 = {
    rows: 옵션.rows || [],
    getLastRow: () => (옵션.rows || []).length + 1,
    getLastColumn: () => 26,
    getRange: (r, c, nr, nc) => ({
      getValues: () => (옵션.rows || []).slice(r - 2, r - 2 + nr)
        .map((행) => {
          const 잘림 = 행.slice(c - 1, c - 1 + nc);
          while (잘림.length < nc) 잘림.push("");
          return 잘림;
        }),
      setValues: (v) => { 쓴것.push({ r, c, v }); },
    }),
  };
  const ctx = {
    Logger: { log() {} },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = (n) => (n < 10 ? "0" : "") + n;
        if (f === "MMdd") return p(d.getMonth() + 1) + p(d.getDate());
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
      },
    },
    SpreadsheetApp: { openById: () => ({}) },
    _PT: { INFO_SS_ID: "x" },
    _pep_ensureNonPartnerTempTab_: () => 탭,
    _PO_TEMP_STATUS_COL_: 24,
    _PO_TEMP_INV_COL_: 23,
    _PEP_WAIT_MAX_DAYS_: 3,
    _PEP_TEMP_WAIT_: "발주대기",
    _PEP_TEMP_DONE_: "발주완료",
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(
    [fnFrom(PUSH, "_pep_waitingTempRows_"), fnFrom(PUSH, "_pep_clearWaitingMarks_")].join("\n\n"),
    ctx,
  );
  return { ctx, 쓴것, 탭 };
}

const p2 = (n) => (n < 10 ? "0" : "") + n;
const mmdd = (뒤로) => {
  const d = new Date();
  d.setDate(d.getDate() - 뒤로);
  return p2(d.getMonth() + 1) + p2(d.getDate());
};

/*  임시기록 한 줄 — 원천 0~21열 + [업체prefix, 송장, 진행상태]  */
function 줄(uid, code, 상태, 도장, 송장) {
  const r = new Array(26).fill("");
  r[1] = 도장 === undefined ? mmdd(0) + "-1" : 도장;
  r[2] = "2026/09/17-1";
  r[3] = code;
  r[4] = "품목이름";
  r[9] = "경기 평택시 평택2로 29-8";
  r[15] = uid;
  r[19] = "NK";
  r[22] = "NK";
  r[23] = 송장 || "";
  r[24] = 상태;
  return r;
}

/* ── [1] 되살릴 줄만 골라낸다 ───────────────────────────── */
console.log("\n[1] 임시기록에서 «아직 안 나간» 줄 고르기");
{
  const rows = [
    줄("U1", "NK0001", "발주대기"),
    줄("U2", "NK0002", "발주완료"),
    줄("U3", "NK0003", ""),
    줄("U4", "NK0004", "송장수집"),
  ];
  const { ctx } = 판();
  const r = ctx._pep_waitingTempRows_(rows, 22);
  eq("★ 「발주대기」 한 줄만 되살린다", r.rows.length, 1);
  eq("  그 줄의 고유ID", r.rows[0][15], "U1");
  eq("  품목코드도 살아 있다", r.rows[0][3], "NK0001");
  eq("  업체코드도 살아 있다", r.rows[0][19], "NK");
  eq("★ 오래된 것은 없다", r.tooOld, 0);
}

/* ── [2] 이미 송장이 붙었으면 다시 안 보낸다 ────────────── */
console.log("\n[2] 송장이 이미 붙은 「발주대기」 줄");
{
  const { ctx } = 판();
  const r = ctx._pep_waitingTempRows_([줄("U9", "NK0009", "발주대기", undefined, "500011112222")], 22);
  eq("★ 어떻게든 나간 줄은 다시 안 보낸다", r.rows.length, 0);
}

/* ── [3] 나이 ──────────────────────────────────────────── */
console.log("\n[3] 너무 오래된 것은 «조용히» 버리지 않는다");
{
  const { ctx } = 판();
  const r = ctx._pep_waitingTempRows_([
    줄("A", "NK1", "발주대기", mmdd(0) + "-1"),
    줄("B", "NK2", "발주대기", mmdd(3) + "-2"),
    줄("C", "NK3", "발주대기", mmdd(9) + "-1"),
    줄("D", "NK4", "발주대기", ""),
  ], 22);
  eq("★ 오늘·3일 전까지는 태운다", r.rows.length, 2);
  eq("★ 9일 전과 도장 없는 것은 안 태운다", r.tooOld, 2);
  ok("★ 몇 줄인지 말해 준다 (조용히 버리지 않는다)", r.examples.length === 2);
  ok("  어느 주문인지도 알려 준다", r.examples[0].indexOf("C") >= 0 || r.examples[0].indexOf("NK3") >= 0);
}

/* ── [4] 원천 모양으로 맞춘다 ───────────────────────────── */
console.log("\n[4] 원천 줄과 같은 모양인가");
{
  const { ctx } = 판();
  const r = ctx._pep_waitingTempRows_([줄("U1", "NK0001", "발주대기")], 28);
  eq("★ 원천 열 수에 맞춰 늘린다", r.rows[0].length, 28);
  //  업체 매핑이 쓰는 열은 3~18 뿐이다 (2026-09-17 확인)
  eq("  3열 품목코드", r.rows[0][3], "NK0001");
  eq("  15열 고유ID", r.rows[0][15], "U1");
  eq("  임시기록 전용 칸(22~)은 안 딸려온다", r.rows[0][22], "");
  eq("  진행상태도 안 딸려온다", r.rows[0][24], "");
}
{
  //  고유ID 나 품목코드가 없으면 태울 수 없다 — 어디로 갈지 모른다
  const { ctx } = 판();
  eq("★ 고유ID 없는 줄은 안 태운다",
    ctx._pep_waitingTempRows_([줄("", "NK1", "발주대기")], 22).rows.length, 0);
  eq("★ 품목코드 없는 줄도 안 태운다",
    ctx._pep_waitingTempRows_([줄("U1", "", "발주대기")], 22).rows.length, 0);
}

/* ── [5] 나간 줄만 「발주완료」로 바꾼다 ────────────────── */
console.log("\n[5] 나간 뒤에 상태 지우기");
{
  const rows = [
    줄("U1", "NK0001", "발주대기"),
    줄("U2", "NK0002", "발주대기"),
    줄("U3", "NK0003", "송장수집"),
  ];
  const { ctx, 쓴것 } = 판({ rows: rows });
  const n = ctx._pep_clearWaitingMarks_({ "U1|NK0001": true });
  eq("★ 나간 줄 하나만 바꾼다", n, 1);
  eq("  한 번에 쓴다", 쓴것.length, 1);
  const v = 쓴것[0].v;
  eq("  U1 은 발주완료", v[0][0], "발주완료");
  eq("★ 안 나간 U2 는 그대로 발주대기", v[1][0], "발주대기");
  eq("★ 사람이 적은 「송장수집」은 안 건드린다", v[2][0], "송장수집");
  eq("  상태 칸(25열)에 쓴다", 쓴것[0].c, 25);
}
{
  const { ctx, 쓴것 } = 판({ rows: [줄("U1", "NK0001", "발주대기")] });
  eq("★ 나간 줄이 없으면 아무것도 안 쓴다", ctx._pep_clearWaitingMarks_({}), 0);
  eq("  시트를 안 건드린다", 쓴것.length, 0);
}

/* ── [6] 배선 — 코드에 그 길이 나 있는가 ────────────────── */
console.log("\n[6] 배선");
{
  //  ① 임시기록에 «담은 뒤»에 끊어야 한다. 앞에서 끊으면 기록도 안 남는다
  const 담기 = PUSH.indexOf("_tempPendingRows_.push(_tRow_.concat([pfx");
  const 끊기 = PUSH.indexOf("if (_PEP_TEMP_ONLY_) {\n      tempOnlyKept++;");
  const 끊기2 = PUSH.indexOf("tempOnlyKept++;");
  ok("★ 임시기록에 담는 자리가 있다", 담기 > 0);
  ok("★ 끊는 자리가 그 «뒤»에 있다", 끊기2 > 0 && 담기 < 끊기2);
  //  ② 업체 파일을 여는 자리보다 «앞»이어야 한다
  const 파일열기 = PUSH.indexOf("_pep_initVendorCache_(pfx, prefixToFile[pfx], directMap)");
  ok("★ 업체 파일 여는 자리보다 앞에서 끊는다", 파일열기 > 0 && 끊기2 < 파일열기);

  //  ③ 상태값이 갈린다
  ok("★ 임시기록만이면 「발주대기」",
    PUSH.indexOf("_PEP_TEMP_ONLY_ ? _PEP_TEMP_WAIT_ : _PEP_TEMP_DONE_") >= 0);

  //  ④ 모드가 다음 실행으로 새면 안 된다
  ok("★ finally 에서 모드를 되돌린다",
    PUSH.indexOf("_PEP_TEMP_ONLY_ = false;   // 다음 실행이 물려받지 않게") >= 0);
  ok("★ 들어올 때도 새로 정한다", PUSH.indexOf("_PEP_TEMP_ONLY_ = !!tempOnly;") >= 0);

  //  ⑤ 되살리기는 «진짜 푸시»일 때만
  ok("★ 임시기록만 회차는 되살리지 않는다",
    PUSH.indexOf("if (!_PEP_TEMP_ONLY_) {\n    try {\n      var _wait_ = _pep_waitingTempRows_") >= 0 ||
    PUSH.indexOf("var _wait_ = _pep_waitingTempRows_") > PUSH.indexOf("if (!_PEP_TEMP_ONLY_)"));

  //  ⑥ 끝났을 때만 상태를 지운다 — 끊긴 채로 지우면 영영 안 나간다
  const 완료검사 = PUSH.indexOf("if (!_PEP_LAST_INCOMPLETE_) {");
  const 지우기 = PUSH.indexOf("_pep_clearWaitingMarks_(_PEP_LAST_PUSHED_KEYS_)");
  ok("★ «다 끝났을 때만» 상태를 지운다", 완료검사 > 0 && 지우기 > 완료검사);

  //  ⑦ 나갔다는 표시는 «실제로 보낼 때» 남긴다
  ok("★ 업체 줄에 담을 때 열쇠를 적는다",
    PUSH.indexOf("if (_runRowKey_) _PEP_LAST_PUSHED_KEYS_[_runRowKey_] = true;") >= 0);
}

/* ── [7] 일정표 ────────────────────────────────────────── */
console.log("\n[7] 일정표 — 푸시는 13:50 에만");
{
  const 표 = [];
  const re = WEB.indexOf("var _ALL_SCHEDULED_TRIGGERS_ = [");
  const 끝 = WEB.indexOf("\n];", re);
  const 블록 = WEB.substring(re, 끝);
  블록.split("\n").forEach((l) => {
    const a = l.indexOf('{ fn: "');
    if (a < 0) return;
    const fn = l.substring(a + 7, l.indexOf('"', a + 7));
    const hm = l.substring(l.indexOf("h:"));
    const h = parseInt(hm.substring(2, hm.indexOf(",")), 10);
    const m = parseInt(hm.substring(hm.indexOf("m:") + 2, hm.indexOf(",", hm.indexOf("m:"))), 10);
    표.push({ fn, h, m });
  });
  const 찾기 = (h, m) => (표.filter((t) => t.h === h && t.m === m)[0] || {}).fn || "(없음)";

  eq("09:30 발주 수집", 찾기(9, 30), "partnerCollectOrdersSilent_");
  eq("★ 10:30 임시기록에만", 찾기(10, 30), "partnerPushTempOnlySilent_");
  eq("13:00 발주 수집", 찾기(13, 0), "partnerCollectOrdersSilent_");
  eq("★ 13:50 «진짜» 푸시", 찾기(13, 50), "partnerPushOrdersToExclusiveFormsSilent_");
  eq("15:00 발주 수집", 찾기(15, 0), "partnerCollectOrdersSilent_");
  eq("★ 15:40 임시기록에만", 찾기(15, 40), "partnerPushTempOnlySilent_");

  const 진짜푸시 = 표.filter((t) => t.fn === "partnerPushOrdersToExclusiveFormsSilent_");
  eq("★ 진짜 푸시는 하루 «한 번»뿐", 진짜푸시.length, 1);
  const 임시만 = 표.filter((t) => t.fn === "partnerPushTempOnlySilent_");
  eq("★ 임시기록만은 두 번", 임시만.length, 2);

  //  트리거 한도 — 스무 자리 중 둘은 이어달리기 몫이다
  ok("★ 트리거가 18개를 안 넘는다 (" + 표.length + "개)", 표.length <= 18);

  ok("★ 그 함수가 실제로 있다", PUSH.indexOf("function partnerPushTempOnlySilent_()") >= 0);
  ok("★ 임시기록만 모드로 부른다",
    PUSH.indexOf("partnerPushOrdersToExclusiveForms(true, true);") >= 0);
  ok("★ 「발주 안 나갔다」고 말해 준다",
    PUSH.indexOf("업체 발주 안 나감") >= 0 && PUSH.indexOf("13:50 에 나갑니다") >= 0);
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
