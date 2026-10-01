/**
 * ══════════════════════════════════════════════════════════════
 *  창(모달)이 «제자리에서 닫히나» — 태그 짝 맞추기
 *
 *  ★ 왜 이 시험이 있나 ★  (2026-10-01)
 *    > "송장번호 조회에서 반품대장 기입시. 하단부분이 짤리고
 *       하단 아래쪽으로 무분별하게 분리되어 있어"
 *
 *    반품대장 기록 창의 「사유」 칸에서 «여는» 태그와 라벨이 빠져 있었다.
 *    닫는 태그가 하나 남아 .modal-content 가 그 자리에서 «일찍 닫혔고»,
 *    뒤따르는 칸 일곱과 「기록」 단추가 창 밖으로 밀려났다.
 *
 *    브라우저는 이런 것을 «말없이 고쳐» 그린다. 문법 검사도 안 잡는다
 *    (<script> 안의 자바스크립트는 멀쩡하다). 눈으로 보기 전에는 모른다.
 *    그래서 세어 본다.
 *
 *  ★ 주석 속 글자는 세지 않는다 ★
 *    설명에 「닫는 태그」를 글자로 적어 둔 곳이 있다. 주석을 먼저 걷어낸다.
 *    (2026-10-01 에 내가 바로 이걸로 한 번 헛걸음했다.)
 *
 *  돌리는 법   node CS_WebApp/_csmodal_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "home.html"), "utf8")
  //  주석과 GAS 템플릿을 걷어낸다 — 그 안의 글자는 태그가 아니다
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<\?[\s\S]*?\?>/g, "");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ✔ " + 이름); return; }
  틀린것++;
  console.log("  ✗ " + 이름 + (덧붙임 ? "\n      " + 덧붙임 : ""));
}

/*  ★ 「다음 창까지」를 본다 ★  (2026-10-01)
      처음엔 «깊이가 0이 되는 자리»를 창의 끝으로 보았다. 그러면 닫는 태그가
      하나 남아 창이 «일찍 닫혀도» 그 자리를 끝으로 쳐서 「짝이 맞다」가 됐다 —
      정작 잡아야 할 결함을 못 잡았다(시험을 시험해 보고 알았다).
      창은 서로 형제라 «다음 창이 열리기 전»까지가 그 창의 몫이다. 그 구간의
      깊이가 0으로 끝나고 중간에 음수로 안 가야 맞다.                      */
const 창열림 = /<div class="modal-overlay"(?: [^>]*)?>/g;

/** 그 창의 구간 — [시작, 다음 창 시작) */
function 구간(id) {
  const 여는글들 = [];
  let m;
  창열림.lastIndex = 0;
  while ((m = 창열림.exec(HTML))) 여는글들.push({ at: m.index, tag: m[0] });
  const i = 여는글들.findIndex((x) => x.tag.includes('id="' + id + '"'));
  if (i < 0) return null;
  const a = 여는글들[i].at;
  /*  경계 — 다음 창, 아니면 창들 뒤에 오는 것(<script>·</body>) 중 먼저 오는 것.
      ★ 마지막 창을 파일 끝까지로 잡으면 안 된다 ★ 페이지 몸통을 닫는
        태그까지 세어 「짝이 안 맞는다」고 거짓 경보를 울린다
        (2026-10-01 에 productModal 에서 그랬다).                      */
  const 후보 = [
    i + 1 < 여는글들.length ? 여는글들[i + 1].at : -1,
    HTML.indexOf("<script", a),
    HTML.indexOf("</body>", a),
  ].filter((x) => x > a);
  const 끝 = 후보.length ? Math.min(...후보) : HTML.length;
  return { 시작: a, 끝, 글: HTML.slice(a, 끝) };
}

/** 그 구간의 div 깊이가 0으로 끝나고 중간에 음수로 안 가나 */
function 짝맞나(id) {
  const r = 구간(id);
  if (!r) return { 찾음: false };
  let 깊이 = 0, 최저 = 99, 닫힌자리 = -1;
  const re = /<div\b|<\/div>/g;
  let m;
  while ((m = re.exec(r.글))) {
    깊이 += m[0] === "</div>" ? -1 : 1;
    if (깊이 < 최저) 최저 = 깊이;
    if (깊이 === 0 && 닫힌자리 < 0) 닫힌자리 = m.index;
  }
  return {
    찾음: true, 끝깊이: 깊이, 최저,
    //  창이 «일찍» 닫혔나 — 0 이 된 뒤에도 태그가 더 있다
    일찍: 닫힌자리 >= 0 && /<\/?div\b/.test(r.글.slice(닫힌자리 + 6)),
    글: r.글,
  };
}

console.log("─── 창마다 태그 짝이 맞나 ───");

/*  창 아홉 개를 다 본다. 한 군데만 어긋나도 그 뒤가 통째로 밀려난다.
    id 를 적어 두는 까닭 — 새 창이 생기면 여기에 한 줄 더하면 된다.  */
const 창들 = [
  "staffModal", "hbModal", "lgwModal", "retNewModal",
  "depModal", "depDetailModal", "ledgerModal",
  "lrtModal", "ledgerDupModal", "productModal",
];

창들.forEach(function (id) {
  const r = 짝맞나(id);
  if (!r.찾음) {
    //  없는 창은 넘긴다 — 창 이름이 바뀔 수 있다
    console.log("  · " + id + " — 없음 (넘깁니다)");
    return;
  }
  /*  ★ 「일찍 닫혔나」는 여기서 안 본다 ★
        창이 닫힌 뒤 다음 창 전에 «형제» 요소가 올 수 있다 — hbModal 뒤의
        사진 크게보기(hb-lb-*)가 그렇다. 그걸 결함으로 치면 거짓 경보다.
        닫는 태그가 남는 결함은 «중간 최저가 음수»로 잡힌다. 그것으로 충분하다.
        덧붙여, 창마다 「칸이 다 창 안에 있나」를 아래에서 따로 본다 —
        그게 2026-10-01 결함을 실제로 잡은 검문이다.                      */
  ok(id + " 가 제자리에서 닫힌다",
    r.끝깊이 === 0 && r.최저 >= 0,
    "끝 깊이 " + r.끝깊이 + " · 중간 최저 " + r.최저 +
    "\n      닫는 태그가 남으면 뒤따르는 칸이 창 «밖»으로 밀려납니다");
});

/**
 * «제대로 닫힌» 창 안쪽 글.
 * 일찍 닫혔으면 그 뒤 칸들은 글자로는 구간에 있어도 화면에서는 밖이다.
 */
function 창안(id) {
  const r = 구간(id);
  if (!r) return "";
  let 깊이 = 0;
  const re = /<div\b|<\/div>/g;
  let m;
  while ((m = re.exec(r.글))) {
    깊이 += m[0] === "</div>" ? -1 : 1;
    if (깊이 === 0) return r.글.slice(0, m.index);
  }
  return r.글;
}

/* ── 접수 창 — 칸이 전부 «창 안»에 있나 ───────────────────────── */
console.log("\n─── 반품 접수 창 안에 칸이 다 들어 있나 ───");
const 접수창 = 창안("retNewModal");
ok("접수 창을 찾았다", !!접수창);
[
  "retNewStaff", "retNewType", "retNewFault", "retNewReason", "retNewStatus",
  "retNewPhone", "retNewPhone2", "retNewPhone2Name", "retNewVendor",
  "retNewItem", "retNewQty", "retNewInvoice", "retNewRetInvoice",
  "retNewFee", "retNewPickup", "retNewAccount", "retNewMemo",
].forEach(function (id) {
  //  없는 칸은 넘긴다 — 화면이 바뀔 수 있다. 있는데 «밖»이면 탈이다
  if (HTML.indexOf('id="' + id + '"') < 0) return;
  ok(id + " 이 창 안에 있다", 접수창.indexOf('id="' + id + '"') >= 0,
    "창 밖으로 밀려났습니다");
});

/* ── 기록 창 — 칸이 전부 «창 안»에 있나 ───────────────────────── */
console.log("\n─── 반품대장 기록 창 안에 칸이 다 들어 있나 ───");

const 기록창 = 창안("ledgerModal");

ok("기록 창을 찾았다", !!기록창);

/*  창에서 적는 칸 전부. 하나라도 창 밖으로 나가면 사람은 그 칸을
    «못 보거나», 보더라도 모양이 깨진 채 본다.                      */
[
  "ledgerPreview", "ledgerItems", "ledgerDraftBar",
  "ledgerStaff", "ledgerType", "ledgerFault", "ledgerReason",
  "ledgerStatus", "ledgerPhone2", "ledgerPhone2Name",
  "ledgerPickup", "ledgerFee", "lrtOpt",
  "ledgerAccount", "ledgerMemo", "ledgerPhotoPrev",
  "ledgerSubmitBtn",
].forEach(function (id) {
  ok(id + " 이 창 안에 있다", 기록창.indexOf('id="' + id + '"') >= 0,
    "창 밖으로 밀려났습니다");
});

/*  ★ 라벨 없는 칸이 없나 ★  빠진 여는 태그는 라벨도 함께 데려간다.
    고르는 칸(select)은 무엇을 고르는지 글자가 있어야 한다.          */
console.log("\n─── 고르는 칸마다 라벨이 붙어 있나 ───");
[
  ["ledgerStaff", "접수자"], ["ledgerType", "교환/반품"],
  ["ledgerFault", "귀책"], ["ledgerReason", "사유"],
  ["ledgerStatus", "상태"],
].forEach(function (pair) {
  const i = 기록창.indexOf('id="' + pair[0] + '"');
  if (i < 0) { ok(pair[0] + " 라벨", false, "칸 자체가 없습니다"); return; }
  //  그 칸 바로 앞(같은 .ledger-field 안)에 라벨이 있나
  const 앞 = 기록창.slice(Math.max(0, i - 400), i);
  const j = 앞.lastIndexOf('<div class="ledger-field');
  ok(pair[0] + " 에 「" + pair[1] + "」 라벨이 붙어 있다",
    j >= 0 && 앞.slice(j).indexOf("<label>" + pair[1] + "</label>") >= 0,
    "여는 태그나 라벨이 빠졌습니다 — 그러면 뒤가 통째로 밀려납니다");
});

/* ── 고친 자리가 그대로 있나 ─────────────────────────────────── */
console.log("\n─── 2026-10-01 에 고친 것이 그대로인가 ───");
ok("기록 창에 ledger-sheet 이름이 붙어 있다",
  /class="modal-content ledger-sheet"/.test(HTML),
  "없으면 단추가 바닥에 안 붙고 스크롤바도 안 보입니다");
ok("적는 칸들이 ledger-grid 묶음 안에 있다",
  기록창.indexOf('<div class="ledger-grid">') >= 0);
ok("메모·사진은 한 줄 통째로(.wide)",
  (기록창.match(/class="ledger-field wide"/g) || []).length === 2);
ok("단추를 바닥에 붙이는 규칙이 있다",
  /\.ledger-sheet \.ledger-btns \{[\s\S]{0,200}position: sticky/.test(HTML));
ok("이 창만 스크롤바를 보인다",
  /\.modal-content\.ledger-sheet \{[\s\S]{0,200}scrollbar-width: thin/.test(HTML));
ok("넓은 화면에서 두 칸으로 접는다",
  /@media \(min-width: 900px\)[\s\S]{0,600}\.ledger-sheet \.ledger-grid \{[\s\S]{0,200}grid-template-columns: 1fr 1fr/.test(HTML));

console.log("\n" + (틀린것 ? "✗ " : "✅ ") + 잰것 + "개 중 " + 틀린것 + "개 틀렸습니다.");
process.exit(틀린것 ? 1 : 0);
