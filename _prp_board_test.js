/**
 * 로컬 검증: 업체 문의 → CS 커뮤니티 보드
 *
 *  보드는 CS 웹앱의 것이고 포털은 별개 프로젝트다. 시트를 직접 쓰므로
 *  여기서 지켜야 할 것이 몇 가지 있다.
 *    ① 열을 **헤더명으로** 찾는다 (CS가 열을 추가해도 따라온다)
 *    ② 같은 반품 건의 두 번째 문의는 **기존 진행 카드에 쌓는다** (보드 상한 20장)
 *    ③ 완료된 카드는 되살리지 않고 새 카드를 만든다
 *    ④ `연결`(G열)에 출처키를 섞지 않는다 — 주문 검색 쿼리로 그대로 쓰인다
 *    ⑤ 후속 문의가 오면 읽음을 비워 다시 NEW 로 뜬다
 *
 * 실행: node _prp_board_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

// ── 가짜 시트 ────────────────────────────────────────────────
function makeSheet(header, rows) {
  return {
    _h: header.slice(),
    _r: rows.map(r => r.slice()),
    getLastColumn() { return this._h.length; },
    getMaxColumns() { return this._h.length; },
    getLastRow() { return this._r.length + 1; },
    insertColumnsAfter(after, n) { for (let i = 0; i < n; i++) this._h.push(""); },
    getRange(r, c, nr, nc) {
      const sh = this;
      nr = nr || 1; nc = nc || 1;
      return {
        getDisplayValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const line = [];
            for (let j = 0; j < nc; j++) line.push(sh._cell(r + i, c + j));
            out.push(line);
          }
          return out;
        },
        getDisplayValue() { return sh._cell(r, c); },
        setValue(v) { sh._set(r, c, v); },
        setValues(vals) {
          for (let i = 0; i < vals.length; i++)
            for (let j = 0; j < vals[i].length; j++) sh._set(r + i, c + j, vals[i][j]);
        }
      };
    },
    _cell(r, c) {
      if (r === 1) return this._h[c - 1] == null ? "" : String(this._h[c - 1]);
      const row = this._r[r - 2];
      if (!row) return "";
      return row[c - 1] == null ? "" : String(row[c - 1]);
    },
    _set(r, c, v) {
      if (r === 1) { this._h[c - 1] = v; return; }
      while (this._r.length < r - 1) this._r.push([]);
      const row = this._r[r - 2];
      while (row.length < c) row.push("");
      row[c - 1] = v;
    }
  };
}

const HEADERS = ["카드ID", "등록일시", "작성자", "중요도", "제목", "내용", "연결",
  "전달내역", "읽음", "상태", "완료일시", "완료자", "첨부", "출처키"];
const C = {}; HEADERS.forEach((h, i) => C[h] = i);

function run(sheet) {
  const src = fs.readFileSync("Partner_WebApp/prpBoard.gs", "utf8");
  const ctx = {
    PRP_LEDGER_ID: "x",
    PRP_STAFF_PREFIX: "업체:",
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => n === "CS_커뮤니티보드" ? sheet : null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: (d, tz, f) => f === "yyMMdd HH:mm" ? "260827 23:00" : "2026-08-27 23:00" }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return (info) => vm.runInContext("prpPostInquiryToBoard_(" + JSON.stringify(info) + ")", ctx);
}

const INQ = {
  tab: "202608", row: 5, vendor: "준테크", text: "환불이 언제 되나요?",
  name: "홍길동", item: "물티슈", status: "수거중",
  invoice: "1234567890", returnInvoice: "9876543210"
};

console.log("[1] 첫 문의 → 새 카드");
let sh = makeSheet(HEADERS, []);
let res = run(sh)(INQ);
check("결과", { ok: res.ok, mode: res.mode }, { ok: true, mode: "new" });
check("카드 1장", sh._r.length, 1);
let r0 = sh._r[0];
check("작성자에 업체 접두", r0[C["작성자"]], "업체:준테크");
check("중요도는 주의 (긴급이 CS 건을 가리지 않게)", r0[C["중요도"]], "주의");
check("제목", r0[C["제목"]], "[업체문의] 준테크 · 홍길동 · 물티슈");
check("상태", r0[C["상태"]], "진행");
check("읽음은 비어 있다 (모두에게 NEW)", r0[C["읽음"]], "");
check("출처키", r0[C["출처키"]], "반품:202608:5");
check("본문에 문의와 근거가 함께", r0[C["내용"]].split("\n").filter(s => s), [
  "환불이 언제 되나요?",
  "― 반품대장 202608 5행",
  "― 처리상태 수거중",
  "― 원송장 1234567890",
  "― 반품송장 9876543210"
]);
console.log("      연결 = " + JSON.stringify(r0[C["연결"]]));
check("연결에 출처키를 섞지 않는다 (주문검색 쿼리로 쓰인다)",
  r0[C["연결"]].indexOf("반품:") < 0 && r0[C["연결"]] === "1234567890", true);

console.log("\n[2] 같은 건 두 번째 문의 → 기존 진행 카드에 쌓는다");
sh._r[0][C["읽음"]] = "김담당,박담당"; // CS가 이미 읽은 상태
res = run(sh)(Object.assign({}, INQ, { text: "아직 답이 없어서 다시 문의합니다" }));
check("결과", { ok: res.ok, mode: res.mode }, { ok: true, mode: "append" });
check("카드가 늘지 않았다", sh._r.length, 1);
check("전달내역에 쌓였다", sh._r[0][C["전달내역"]],
  "[260827 23:00 업체:준테크] 문의. 아직 답이 없어서 다시 문의합니다");
check("읽음이 비워져 다시 NEW", sh._r[0][C["읽음"]], "");

console.log("\n[3] 세 번째 문의 → 전달내역에 줄이 하나 더");
run(sh)(Object.assign({}, INQ, { text: "세 번째" }));
check("전달내역 줄 수", sh._r[0][C["전달내역"]].split("\n").length, 2);
check("카드 수 그대로", sh._r.length, 1);

console.log("\n[4] 완료된 카드는 되살리지 않고 새로 만든다");
sh._r[0][C["상태"]] = "완료";
res = run(sh)(Object.assign({}, INQ, { text: "완료 후 재문의" }));
check("결과", { ok: res.ok, mode: res.mode }, { ok: true, mode: "new" });
check("카드 2장", sh._r.length, 2);
check("새 카드는 진행", sh._r[1][C["상태"]], "진행");

console.log("\n[5] 다른 반품 건은 별도 카드");
sh = makeSheet(HEADERS, []);
const post = run(sh);
post(INQ);
post(Object.assign({}, INQ, { row: 9 }));
check("카드 2장", sh._r.length, 2);
check("출처키가 다르다", [sh._r[0][C["출처키"]], sh._r[1][C["출처키"]]],
  ["반품:202608:5", "반품:202608:9"]);

console.log("\n[6] 출처키 열이 없는 옛 보드 → 맨 끝에 만들어 붙인다");
const old = HEADERS.slice(0, 13); // 출처키 없음
sh = makeSheet(old, []);
res = run(sh)(INQ);
check("결과", { ok: res.ok, mode: res.mode }, { ok: true, mode: "new" });
check("헤더 맨 끝에 출처키가 생겼다", sh._h[13], "출처키");
check("기존 헤더는 그대로", sh._h.slice(0, 13), old);
check("값이 그 칸에 들어갔다", sh._r[0][13], "반품:202608:5");

console.log("\n[7] CS가 열을 추가해도 헤더명으로 따라간다 (위치를 박지 않았다)");
// 첨부 뒤에 CS가 '담당팀' 을 끼워넣고 출처키가 그 뒤로 밀린 상황
const moved = ["카드ID", "등록일시", "작성자", "중요도", "제목", "내용", "연결",
  "전달내역", "읽음", "상태", "완료일시", "완료자", "첨부", "담당팀", "출처키"];
sh = makeSheet(moved, []);
res = run(sh)(INQ);
check("결과", { ok: res.ok, mode: res.mode }, { ok: true, mode: "new" });
check("출처키가 15번째 칸에 들어갔다", sh._r[0][14], "반품:202608:5");
check("담당팀 칸은 건드리지 않았다", sh._r[0][13], "");

console.log("\n[8] 보드 탭이 없으면 조용히 넘어간다 (문의를 막지 않는다)");
const noTab = (() => {
  const src = fs.readFileSync("Partner_WebApp/prpBoard.gs", "utf8");
  const ctx = {
    PRP_LEDGER_ID: "x", PRP_STAFF_PREFIX: "업체:",
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: () => "260827 23:00" }
  };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return vm.runInContext("prpPostInquiryToBoard_(" + JSON.stringify(INQ) + ")", ctx);
})();
check("예외 대신 skip 을 돌려준다", { ok: noTab.ok, mode: noTab.mode }, { ok: false, mode: "skip" });

console.log("\n[9] CS 보드 헤더와 포털이 찾는 헤더명이 일치");
const hbSrc = fs.readFileSync("CS_WebApp/csHandoffBoard.gs", "utf8");
const hbHdr = JSON.parse("[" + hbSrc.match(/var _CS_HB_HEADERS_ = \[([\s\S]*?)\];/)[1]
  .replace(/\/\/[^\n]*/g, "").replace(/,\s*$/, "").trim().replace(/,\s*$/, "") + "]");
check("CS 보드 헤더 개수", hbHdr.length, 14);
check("CS 보드 마지막 열이 출처키", hbHdr[13], "출처키");
const portalSrc = fs.readFileSync("Partner_WebApp/prpBoard.gs", "utf8");
const needed = ["카드ID", "등록일시", "작성자", "중요도", "제목", "내용", "연결", "전달내역", "읽음", "상태"];
check("포털이 찾는 헤더명이 모두 CS 헤더에 있다",
  needed.filter(h => hbHdr.indexOf(h) < 0), []);
check("출처키 헤더명이 양쪽 같다",
  /var PRP_BOARD_SRCKEY_HEADER = "출처키";/.test(portalSrc) &&
  /var _CS_HB_SRCKEY_HEADER_ = "출처키";/.test(hbSrc), true);

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
