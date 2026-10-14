/*  _partnerStatementGmail.gs 를 ★진짜 돌려서★ 본다.
    고치려는 것: 「메일이 없다」와 「메일은 있는데 못 읽었다」를 가르는 일.
    node _pstmt_test.js                                              2026-10-14  */
const fs = require("fs");

const 소스 = fs.readFileSync(__dirname + "/_partnerStatementGmail.gs", "utf8");

let 틀림 = 0, 맞음 = 0;
const 봐 = (이름, 참말) => { 참말 ? 맞음++ : (틀림++, console.log("  ✘ " + 이름)); };

/*  첨부 흉내 — 이름과 알맹이만 있으면 된다  */
function 첨부(이름, 줄들) {
  return {
    getName: () => 이름,
    getContentType: () => (/\.pdf$/i.test(이름) ? "application/pdf"
      : /\.jpe?g$/i.test(이름) ? "image/jpeg"
      : /\.csv$|\.txt$/i.test(이름) ? "text/csv" : "application/octet-stream"),
    getDataAsString: () => (줄들 || []).map((r) => r.join(",")).join("\n"),
    copyBlob() { return this; },
  };
}
function 메일(제목, 첨부들) {
  return {
    getFrom: () => "업체 <a@b.com>",
    getSubject: () => 제목,
    getDate: () => new Date("2026-10-13T00:00:00Z"),
    getAttachments: () => 첨부들,
    getPlainBody: () => "안녕하세요",
    getBody: () => "<p>안녕하세요</p>",
    /*  _pstmt_msgHasLabel_ 이 쓴다 — 아직 처리 안 된 메일이라 라벨이 없다  */
    getThread: () => ({ getLabels: () => [] }),
  };
}

function 돌리기(메일들, 고치기) {
  const 알림 = [];
  const 바깥 = {
    SpreadsheetApp: {
      getUi: () => ({ alert: (m) => 알림.push(String(m)) }),
      getActiveSpreadsheet: () => ({ getSheetByName: () => null }),
      flush: () => {},
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    GmailApp: {
      search: () => 메일들.map((m) => ({
        getMessages: () => [m],
        addLabel: () => {},
      })),
      getUserLabels: () => [{ getName: () => "P2U_명세처리완료" }],
      getUserLabelByName: () => ({ getName: () => "P2U_명세처리완료" }),
      createLabel: () => ({ getName: () => "P2U_명세처리완료" }),
    },
    DriveApp: { createFile: () => { throw new Error("엑셀은 이 시험에서 안 쓴다"); } },
    MimeType: { GOOGLE_SHEETS: "x" },
    Utilities: { formatDate: () => "00:00" },
    Logger: { log: () => {} },
    _PSTMT_TAB_SETTINGS: "명세서_설정",
    _pstmt_ensureAllTabs_: () => {},
    _pstmt_log_: () => {},
    /*  담기는 「담을 줄이 있으면 담긴다」로 흉내 낸다  */
    _담기흉내: (ss, m) => m.length,
  };
  const 이름들 = Object.keys(바깥);
  let s = 고치기 ? 고치기(소스) : 소스;
  /*  파일 안에 같은 이름의 함수가 있어 바깥 것이 가려진다 — 이름으로 또렷이 덮어쓴다  */
  s += "\n;_pstmt_appendRawRows_ = _담기흉내;";
  s += "\n;return {run:partnerFetchStatementFromGmail_, 뽑기:_pstmt_extractStatementFromMessage_};";
  const m = new Function(...이름들, s)(...이름들.map((k) => 바깥[k]));
  m.run(true);
  const 글 = 알림.join("\n");
  /*  ★ 시험틀이 조용히 터지면 모든 확인이 실패해서 「코드가 틀렸다」로 보인다 ★
      실제로 GmailApp.getUserLabels 흉내가 빠져 9개가 한꺼번에 틀렸다 (2026-10-14).
      터진 것은 터졌다고 바로 말한다.  */
  if (/수집 실패/.test(글)) throw new Error("시험틀이 터졌다 → " + 글);
  return { 글: 글, m };
}

console.log("─ Gmail 명세 수집 — 없는 것과 못 읽은 것 ─\n");

/* ① 메일이 정말 없을 때만 「없습니다」 */
{
  const { 글 } = 돌리기([]);
  봐("① 메일 0건 — 「없습니다」라고 한다", /없습니다/.test(글));
}

/* ② ★ 고치려던 것 ★ 메일은 있는데 PDF·JPG 라 못 읽었을 때 */
{
  const { 글 } = 돌리기([
    메일("[후아코리아(주)]거래명세서", [첨부("거래명세서_팩투유261013.pdf")]),
    메일("(주)로엔그린 거래명세표입니다.", [첨부("BIZMAIL_20261014_1.JPG")]),
    메일("전자거래명세표가 도착하였습니다", [첨부("명세표.pdf")]),
  ]);
  /*  옛 문구를 그대로 집는다 — 새 문구에도 「없습니다」라는 말이 들어가서,
      낱말만 보면 늘 걸린다(처음에 그래서 헛걸음했다).  */
  봐("② 옛 문구 「미처리 첨부 메일이 없습니다」가 안 나온다",
    !/미처리 첨부 메일이 없습니다/.test(글));
  봐("② 몇 건을 열었는지 말한다 (3건)", /메일 3건/.test(글));
  봐("② 스킵 수를 말한다 (3건)", /스킵 3건/.test(글));
  봐("② PDF 2건을 집어 말한다", /PDF 2건/.test(글));
  봐("② JPG 1건을 집어 말한다", /JPG 1건/.test(글));
  봐("② 못 읽는 갈래라고 알려 준다", /PDF.*이미지.*못 읽습니다|못 읽습니다/.test(글));
}

/* ③ 읽을 수 있는 첨부는 담긴다 */
{
  const { 글 } = 돌리기([
    메일("9월 마감자료", [첨부("9월 팩투유(더조은팩).csv", [["품목", "수량"], ["컵", "10"], ["캡", "5"]])]),
  ]);
  봐("③ 담았다고 한다", /처리 메일: 1건/.test(글));
  봐("③ 「없습니다」도 「못 읽습니다」도 아니다", !/없습니다|못 읽습니다/.test(글));
}

/* ④ 섞여 있으면 담을 건 담고 나머지는 스킵 */
{
  const { 글 } = 돌리기([
    메일("거래명세서", [첨부("명세서.pdf")]),
    메일("9월 마감", [첨부("마감.csv", [["a", "b"], ["1", "2"]])]),
  ]);
  봐("④ 담은 1건을 말한다", /처리 메일: 1건/.test(글));
  봐("④ 스킵 1건도 말한다", /스킵: 1건/.test(글));
}

/* ⑤ 뽑기가 지나친 갈래를 돌려준다 */
{
  const { m } = 돌리기([]);
  const r = m.뽑기(메일("x", [첨부("a.pdf"), 첨부("b.JPG")]));
  봐("⑤ 지나친 갈래를 돌려준다", Array.isArray(r.kinds) && r.kinds.length === 2);
  봐("⑤ pdf 와 jpg 를 가려낸다",
    r.kinds.indexOf("pdf") >= 0 && r.kinds.indexOf("jpg") >= 0);
}

console.log("\n" + (틀림 ? "✘ " + 틀림 + "개 틀림 / " : "✔ ") + 맞음 + "개 맞음");

/*  ═══ 일부러 깨 본다 — 안 울면 울타리가 없는 것이다 ═══  */
console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const 깨기 = [
  ["옛날처럼 무조건 「없습니다」",
    (s) => s.replace("if (result.mailCount === 0 && result.threadCount === 0) {",
      "if (result.mailCount === 0) {")],
  ["연 메일 수를 안 센다",
    (s) => s.replace("out.threadCount = threads.length;", "out.threadCount = 0;")],
  ["지나친 갈래를 안 남긴다",
    (s) => s.replace(/kinds\.push\([^;]+\);/, "")],
  ["갈래를 모으지 않는다",
    (s) => s.replace("out.skipKinds[kk] = (out.skipKinds[kk] || 0) + 1;", "")],
  ["스킵을 안 센다",
    (s) => s.replace(/out\.skipped\+\+;\s*\n\s*\/\*/, "/*")],
];

function 재보기(고치기) {
  const 운것 = [];
  try {
    const a = 돌리기([], 고치기);
    const b = 돌리기([
      메일("거래명세서", [첨부("명세서.pdf")]),
      메일("명세표", [첨부("B.JPG")]),
      메일("명세표2", [첨부("c.pdf")]),
    ], 고치기);
    const c = 돌리기([메일("마감", [첨부("m.csv", [["품목", "수량"], ["컵", "10"]])])], 고치기);

    if (!/미처리 첨부 메일이 없습니다/.test(a.글)) 운것.push("①메일0건");
    if (/미처리 첨부 메일이 없습니다/.test(b.글)) 운것.push("②없다고거짓말");
    if (!/메일 3건/.test(b.글)) 운것.push("②연메일수");
    if (!/스킵 3건/.test(b.글)) 운것.push("②스킵수");
    if (!/PDF 2건/.test(b.글)) 운것.push("②PDF갈래");
    if (!/JPG 1건/.test(b.글)) 운것.push("②JPG갈래");
    if (!/처리 메일: 1건/.test(c.글)) 운것.push("③담기");
  } catch (e) {
    운것.push("터짐:" + e.message);
  }
  return 운것;
}

let 안움 = 0;
for (const [이름, f] of 깨기) {
  if (f(소스) === 소스) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운것 = 재보기(f);
  if (운것.length) console.log("  ✔ 울었다 [" + 운것.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(틀림 || 안움 ? 1 : 0);
