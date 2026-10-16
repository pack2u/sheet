/**
 * 명세서 메일 → v2 다리 — 진짜 돌려서 본다
 *
 *  지키려는 것
 *    ① 검색어는 _partnerStatementGmail.gs 것을 그대로 쓴다 (주인은 하나)
 *    ② v2 가 못 읽는 갈래·너무 큰 것은 안 보낸다
 *    ③ ★ 하나라도 실패하면 라벨을 안 붙인다 ★ 다음 회차에 다시 와야 한다
 *    ④ 다 되면 라벨을 붙인다 — 안 붙이면 영원히 다시 보낸다
 *    ⑤ 「이미 있음」은 실패가 아니다 (v2 가 sha256 으로 막은 것)
 *    ⑥ 예행은 한 통도 안 보내고 라벨도 안 붙인다
 *    ⑦ 주소·표가 없으면 Gmail 을 뒤지지도 않는다
 *
 * 실행: node _sv2_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let fail = 0, pass = 0;
const 소스 = fs.readFileSync(path.join(__dirname, "_partnerStatementToV2.gs"), "utf8");

function 틀(글, opt) {
  opt = opt || {};
  const 본것 = { 검색어: null, 보낸것: [], 라벨: [], 알림: [] };
  const blob = (name, type, n) => ({
    getName: () => name,
    getContentType: () => type || "application/pdf",
    getSize: () => n || 1000,
    getBytes: () => new Array(n || 10).fill(65),
    copyBlob() { return this; },
  });
  const 메일 = (첨부들) => ({ getAttachments: () => 첨부들 });
  const ctx = {
    console, Logger: { log() {} },
    Utilities: {
      getUuid: () => "aaaa-bbbb",
      newBlob: (x) => ({ getBytes: () => (typeof x === "string" ? Array.from(x).map((c) => c.charCodeAt(0)) : x) }),
      formatDate: () => "16:00",
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { getUi: () => ({ alert: (m) => 본것.알림.push(String(m)) }) },
    GmailApp: {
      search: (q) => { 본것.검색어 = q; return (opt.threads || []).map((t) => ({
        getMessages: () => t.map((첨부들) => 메일(첨부들)),
        addLabel: () => 본것.라벨.push("붙음"),
      })); },
      getUserLabelByName: () => ({ addToThread() {} }),
      createLabel: () => ({ addToThread() {} }),
    },
    UrlFetchApp: {
      fetch: (u, o) => {
        본것.보낸것.push({ url: u, token: (o.headers || {})["x-ingest-token"] });
        const 답 = (opt.답 || [])[본것.보낸것.length - 1] || { ok: true };
        return {
          getResponseCode: () => 답.code || 200,
          getContentText: () => JSON.stringify(답.body || { ok: true, results: [답] }),
        };
      },
    },
    _v2ob_url_: () => (opt.url === undefined ? "https://v2.example" : opt.url),
    _v2ob_token_: () => (opt.token === undefined ? "TTTT" : opt.token),
    _PSTMT_GMAIL_SEARCH_BASE_: opt.검색어 === undefined
      ? "in:inbox -from:me has:attachment (subject:명세서 OR subject:명세표 OR 마감)" : opt.검색어,
    _gmi_log_() {},
    _chat_sendCard_() {},
    __본것: 본것,
    __blob: blob,
  };
  vm.createContext(ctx);
  vm.runInContext(글 === undefined ? 소스 : 글, ctx);
  return { ctx, 본것, blob };
}

const PDF = (n) => ({ name: n || "거래명세서_261016.pdf", type: "application/pdf", size: 1000 });

function 첨부(글, 목록) {
  //  틀 안의 blob 만들개를 써야 같은 모양이 된다
  return 목록.map((x) => 글.blob(x.name, x.type, x.size));
}

function 재보기(글) {
  const 운것 = [];
  try {
    /* ① 검색어를 그대로 쓴다 */
    {
      const t = 틀(글, { threads: [] });
      t.ctx._sv2_run_({ dryRun: false });
      if (t.본것.검색어 !== t.ctx._PSTMT_GMAIL_SEARCH_BASE_) 운것.push("①검색어를그대로");
      if (!/subject:명세서/.test(String(t.본것.검색어))) 운것.push("①제목검색어");
    }

    /* ② 못 읽는 갈래·너무 큰 것은 안 보낸다 */
    {
      const t = 틀(글, { threads: [[[]]] });
      const a = 첨부(t, [
        { name: "거래명세서.pdf" },
        { name: "로고.gif" },                       // 못 읽는 갈래
        { name: "큰것.pdf", size: 25 * 1024 * 1024 }, // 너무 큼
        { name: "마감.xlsx" },
      ]);
      const t2 = 틀(글, { threads: [[a]] });
      const r = t2.ctx._sv2_run_({ dryRun: false });
      if (t2.본것.보낸것.length !== 2) 운것.push("②둘만보냄(" + t2.본것.보낸것.length + ")");
      if (r.건너뜀.length !== 2) 운것.push("②건너뛴것둘(" + r.건너뜀.length + ")");
      if (!r.건너뜀.join().match(/gif/)) 운것.push("②gif를건너뜀");
      if (!r.건너뜀.join().match(/큰것/)) 운것.push("②큰것을건너뜀");
    }

    /* ③ ★ 하나라도 실패하면 라벨을 안 붙인다 ★ */
    {
      const t = 틀(글, {});
      const a = 첨부(t, [{ name: "가.pdf" }, { name: "나.pdf" }]);
      const t2 = 틀(글, {
        threads: [[a]],
        답: [{ ok: true }, { code: 500, body: { ok: false } }],
      });
      const r = t2.ctx._sv2_run_({ dryRun: false });
      if (t2.본것.라벨.length !== 0) 운것.push("③실패했는데라벨붙임");
      if (!r.실패.length) 운것.push("③실패를안셈");
    }

    /* ④ 다 되면 라벨을 붙인다 */
    {
      const t = 틀(글, {});
      const a = 첨부(t, [{ name: "가.pdf" }, { name: "나.pdf" }]);
      const t2 = 틀(글, { threads: [[a]], 답: [{ ok: true }, { ok: true }] });
      const r = t2.ctx._sv2_run_({ dryRun: false });
      if (t2.본것.라벨.length !== 1) 운것.push("④다되면라벨(" + t2.본것.라벨.length + ")");
      if (r.보냄 !== 2) 운것.push("④둘보냄(" + r.보냄 + ")");
      if (r.실패.length) 운것.push("④괜한실패");
    }

    /* ⑤ 「이미 있음」은 실패가 아니다 — 라벨도 붙는다 */
    {
      const t = 틀(글, {});
      const a = 첨부(t, [{ name: "가.pdf" }]);
      const t2 = 틀(글, { threads: [[a]], 답: [{ ok: true, duplicate: true, vendor: "로엔그린" }] });
      const r = t2.ctx._sv2_run_({ dryRun: false });
      if (r.이미 !== 1) 운것.push("⑤이미있음을셈");
      if (r.보냄 !== 0) 운것.push("⑤이미있음을보냄으로셈");
      if (r.실패.length) 운것.push("⑤이미있음을실패로");
      if (t2.본것.라벨.length !== 1) 운것.push("⑤이미있어도라벨");
    }

    /* ⑥ 예행은 한 통도 안 보내고 라벨도 안 붙인다 */
    {
      const t = 틀(글, {});
      const a = 첨부(t, [{ name: "가.pdf" }, { name: "나.pdf" }]);
      const t2 = 틀(글, { threads: [[a]] });
      const r = t2.ctx._sv2_run_({ dryRun: true });
      if (t2.본것.보낸것.length !== 0) 운것.push("⑥예행인데보냄");
      if (t2.본것.라벨.length !== 0) 운것.push("⑥예행인데라벨");
      if (r.보냄 !== 2) 운것.push("⑥보낼것을셈(" + r.보냄 + ")");
    }

    /* ⑦ 주소·표가 없으면 Gmail 을 뒤지지도 않는다 */
    {
      const t = 틀(글, { token: "", threads: [[[]]] });
      const r = t.ctx._sv2_run_({ dryRun: false });
      if (t.본것.검색어 !== null) 운것.push("⑦표없는데Gmail뒤짐");
      if (!r.실패.length) 운것.push("⑦표없다고말안함");
    }
    /*  검색어를 못 찾아도 멈춘다 — 엉뚱한 메일을 긁어 v2 에 넣느니 안 하는 게 낫다 */
    {
      const t = 틀(글, { 검색어: "", threads: [[[]]] });
      const r = t.ctx._sv2_run_({ dryRun: false });
      if (t.본것.검색어 !== null) 운것.push("⑦검색어없는데Gmail뒤짐");
      if (!r.실패.join().match(/검색어/)) 운것.push("⑦검색어없다고말안함");
    }

    /* ⑧ 보내는 곳과 표가 맞다 */
    {
      const t = 틀(글, {});
      const a = 첨부(t, [{ name: "가.pdf" }]);
      const t2 = 틀(글, { threads: [[a]] });
      t2.ctx._sv2_run_({ dryRun: false });
      const s = t2.본것.보낸것[0] || {};
      if (!/\/api\/statements\/ingest$/.test(String(s.url))) 운것.push("⑧보내는곳(" + s.url + ")");
      if (s.token !== "TTTT") 운것.push("⑧표를같이보냄");
    }
  } catch (e) {
    운것.push("터짐:" + e.message);
  }
  return 운것;
}

console.log("─ 명세서 메일 → v2 ─\n");
const 운것 = 재보기();
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) pass = 24;
console.log(fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과");

console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const 깨기 = [
  ["★ 실패해도 라벨을 붙인다 ★", (s) => s.replace(
    "if (!opt.dryRun && 이스레드성공 > 0 && 이스레드실패 === 0) _sv2_label_(thread);",
    "if (!opt.dryRun && 이스레드성공 > 0) _sv2_label_(thread);")],
  ["다 돼도 라벨을 안 붙인다", (s) => s.replace(
    /if \(!opt\.dryRun && 이스레드성공 > 0 && 이스레드실패 === 0\) _sv2_label_\(thread\);/, "")],
  ["갈래를 안 가린다", (s) => s.replace(
    "if (!_SV2_OK_EXT_.test(nm)) { res.건너뜀.push(nm); continue; }", "")],
  ["큰 파일도 보낸다", (s) => s.replace(
    /if \(size > _SV2_MAX_MB_ \* 1024 \* 1024\) \{[\s\S]*?continue;\n        \}/, "")],
  ["예행인데 보낸다", (s) => s.replace("if (opt.dryRun) {", "if (false) {")],
  ["검색어를 여기서 따로 적는다", (s) => s.replace(
    "res.검색어 = _PSTMT_GMAIL_SEARCH_BASE_;", 'res.검색어 = "has:attachment";')],
  ["표가 없어도 밀어붙인다", (s) => s.replace(
    /if \(!url \|\| !token\) \{[\s\S]*?return res;\n  \}/, "")],
  ["「이미 있음」을 실패로 센다", (s) => s.replace(
    "if (답.duplicate) { res.이미++;", "if (false) { res.이미++;")],
];

let 안움 = 0;
for (const [이름, f] of 깨기) {
  const 깬것 = f(소스);
  if (깬것 === 소스) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운 = 재보기(깬것);
  if (운.length) console.log("  ✔ 울었다 [" + 운.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(fail || 안움 ? 1 : 0);
