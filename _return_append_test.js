/**
 * 로컬 검증: 반품 신규 접수가 **기존 행을 덮지 않고 아래에 붙는가**
 *
 *  `values` 는 0-기반 배열이고 시트 행은 1-기반이다 — 인덱스 i 의 시트 행은 i+1.
 *  마지막 데이터가 인덱스 i 에 있으면 **다음 빈 행은 i+2** 다.
 *  여기서 i+1 을 돌려주면 방금 찾은 그 마지막 행을 도로 가리켜 **덮어쓴다.**
 *
 *  증상은 "반품기록을 해도 대장에 안 남는다 / 카드가 떴다가 사라진다" 였다.
 *  대장에 쓰이긴 하는데 매번 직전 건 위에 쓰여서 한 건만 남는다.
 *
 *  같은 계산이 두 곳에 복제돼 있다 (프로젝트가 달라 참조가 안 된다).
 *    CS 웹앱 `_cs_nextReturnLedgerDestRow_`
 *    반품 포털 `prpNextDestRow_`
 *  **항상 쌍으로 고친다.** [4] 항목이 두 함수의 답을 직접 비교한다.
 *
 * 실행: node _return_append_test.js
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

/** 최상위 함수 한 개를 소스에서 떼어낸다 (닫는 `}` 는 0열에 있다) */
function grabFn(src, name) {
  const lines = src.split(/\r?\n/);
  const s = lines.findIndex(l => new RegExp("^function\\s+" + name + "\\s*\\(").test(l));
  if (s < 0) throw new Error("함수를 못 찾음: " + name);
  for (let i = s + 1; i < lines.length; i++) {
    if (lines[i] === "}") return lines.slice(s, i + 1).join("\n");
  }
  throw new Error("함수 끝을 못 찾음: " + name);
}

const csSrc = fs.readFileSync("CS_WebApp/csOrderSearch.gs", "utf8");
const prpSrc = fs.readFileSync("Partner_WebApp/prpApi.gs", "utf8");
const prpLedgerSrc = fs.readFileSync("Partner_WebApp/prpLedger.gs", "utf8");

const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
[
  grabFn(csSrc, "_cs_nextReturnLedgerDestRow_"),
  grabFn(csSrc, "_cs_findReturnHeaderRow_"),
  grabFn(csSrc, "_cs_mapReturnLedgerCols_"),
  grabFn(prpSrc, "prpNextDestRow_"),
  grabFn(prpLedgerSrc, "prpFindHeaderRow_"),
  grabFn(prpLedgerSrc, "prpMapCols_"),
].forEach(code => vm.runInContext(code, ctx));

const call = (fn, ...args) => {
  ctx.__a = args;
  return vm.runInContext(fn + ".apply(null, __a)", ctx);
};

// ── 실제 대장 모양 ─────────────────────────────────────────────
// 1행 제목 · 2~3행 여백 · 4행 헤더 · 5행부터 데이터.
// A열(처리상태)은 헤더가 비어 있다 — 실제 시트가 그렇다.
const HEADER = ["", "반품접수날짜", "접수자", "업체명", "수취인", "연락처",
  "수거입력처", "상품명", "수량", "원송장번호", "교환/반품", "", "반품비", "비고",
  "반품송장번호"];

function ledger(dataRows) {
  const blank = () => new Array(HEADER.length).fill("");
  const g = [blank(), blank(), blank(), HEADER.slice()];
  g[0][1] = "반품관리대장";
  dataRows.forEach(r => {
    const row = blank();
    Object.keys(r).forEach(k => { row[k] = r[k]; });
    g.push(row);
  });
  return g;
}
/** 데이터 한 건 — 날짜(1)·수취인(4)·상품명(7)만 채우면 "값 있는 행"이다 */
const rec = (name) => ({ 1: "260828", 4: name, 7: "물티슈" });

function destOf(grid) {
  const hi = call("_cs_findReturnHeaderRow_", grid);
  const col = call("_cs_mapReturnLedgerCols_", grid[hi]);
  return { hi: hi, dest: call("_cs_nextReturnLedgerDestRow_", grid, hi, col) };
}

console.log("[1] 대장 모양을 제대로 읽는다");
{
  const g = ledger([]);
  const hi = call("_cs_findReturnHeaderRow_", g);
  check("헤더는 인덱스 3 (시트 4행)", hi, 3);
  const col = call("_cs_mapReturnLedgerCols_", g[hi]);
  check("처리상태 = A열", col.status, 0);
  check("수취인 = E열", col.name, 4);
  check("원송장 = J열", col.invoice, 9);
  check("반품송장 = 맨 끝", col.returnInvoice, 14);
}

console.log("\n[2] 빈 대장 → 첫 건은 5행");
check("dest", destOf(ledger([])).dest, 5);

console.log("\n[3] 이미 값이 있으면 그 아래로 간다 (덮어쓰지 않는다)");
check("1건(5행) 있으면 → 6행", destOf(ledger([rec("홍길동")])).dest, 6);
check("3건(5~7행) 있으면 → 8행",
  destOf(ledger([rec("가"), rec("나"), rec("다")])).dest, 8);
{
  // 중간이 비어도 **마지막 값**을 기준으로 한다
  const g = ledger([rec("가"), {}, rec("다")]); // 5행, 6행 빈칸, 7행
  check("중간 빈 줄이 있어도 마지막(7행) 다음 → 8행", destOf(g).dest, 8);
}

console.log("\n[4] 포털 복제본이 CS 와 같은 답을 낸다 (쌍으로 고쳤는가)");
[[], [rec("가")], [rec("가"), rec("나")], [rec("가"), {}, rec("다")]].forEach((rows, n) => {
  const g = ledger(rows);
  const hi = call("prpFindHeaderRow_", g);
  const col = call("prpMapCols_", g[hi]);
  const p = call("prpNextDestRow_", g, hi, col);
  check("데이터 " + rows.length + "행 — CS·포털 일치", p, destOf(g).dest);
});

console.log("\n[5] 연속 접수 — 앞 건이 살아남는다 (이 버그의 실제 증상)");
{
  const grid = ledger([]);
  const names = ["1번손님", "2번손님", "3번손님", "4번손님"];
  const written = [];
  names.forEach(nm => {
    const hi = call("_cs_findReturnHeaderRow_", grid);
    const col = call("_cs_mapReturnLedgerCols_", grid[hi]);
    const dest = call("_cs_nextReturnLedgerDestRow_", grid, hi, col);
    const row = new Array(HEADER.length).fill("");
    row[1] = "260828"; row[4] = nm; row[7] = "물티슈";
    while (grid.length < dest) grid.push(new Array(HEADER.length).fill(""));
    grid[dest - 1] = row;          // dest 는 1-기반 시트 행
    written.push(dest);
  });
  check("기록된 행 번호", written, [5, 6, 7, 8]);
  const survivors = grid.slice(4).map(r => r[4]).filter(Boolean);
  check("네 건이 모두 남아 있다", survivors, names);
}

console.log("\n[6] 서식 복사가 실제 데이터 행을 가리킨다");
{
  // submitReturnLedger 는 `dest > headerIdx+2` 일 때 `dest-1` 서식을 물려받는다.
  // dest-1 이 데이터 행이어야 대장 모양이 이어진다.
  const g = ledger([rec("가"), rec("나")]);
  const { hi, dest } = destOf(g);
  check("서식 복사를 한다", dest > hi + 2, true);
  check("dest-1 은 마지막 데이터 행(6행)", dest - 1, 6);
  check("그 행에 값이 있다", g[dest - 2][4], "나");
}

console.log("\n[7] 캐시 무효화가 days 값과 무관하게 통한다");
{
  // 종전에는 30·90 만 손으로 지워서 `csFindReturnIntakeMatches` 의 60 이
  // 10분간 남았다 — 방금 접수한 건을 스캔이 못 찾고 새 행을 또 만들었다.
  const props = {};
  const c2 = {
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); }
      })
    }
  };
  vm.createContext(c2);
  vm.runInContext('var _CS_RETURN_CACHE_VER_ = "v8";', c2);
  [
    grabFn(csSrc, "_cs_returnCacheKey_"),
    grabFn(csSrc, "csInvalidateReturnLedgerCache_"),
  ].forEach(code => vm.runInContext(code, c2));
  vm.runInContext(
    'var _CS_RETURN_GEN_PROP_ = "' +
    (csSrc.match(/_CS_RETURN_GEN_PROP_\s*=\s*"([^"]+)"/) || [, "_CS_RET_CACHE_GEN_"])[1] +
    '";', c2);

  const key = (d, a) => vm.runInContext("_cs_returnCacheKey_(" + d + "," + a + ")", c2);
  const before = [30, 60, 90].map(d => key(d, true));
  check("days 마다 키가 다르다", new Set(before).size, 3);

  vm.runInContext("csInvalidateReturnLedgerCache_()", c2);
  const after = [30, 60, 90].map(d => key(d, true));
  check("무효화 후 30일 키가 바뀐다", after[0] !== before[0], true);
  check("무효화 후 60일 키도 바뀐다 (종전에 새던 곳)", after[1] !== before[1], true);
  check("무효화 후 90일 키도 바뀐다", after[2] !== before[2], true);
  check("activeOnly 가 키를 가른다", key(30, true) !== key(30, false), true);

  // 손으로 적은 키 목록이 되살아나면 같은 구멍이 다시 생긴다
  const inv = grabFn(csSrc, "csInvalidateReturnLedgerCache_");
  check("하드코딩 키 목록이 없다", /"\d+_[AX]"/.test(inv), false);
}

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
