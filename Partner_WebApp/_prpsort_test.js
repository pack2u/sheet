/**
 * 협력업체 포털 — 반품 카드 나열 차례
 *
 *  > "당장드림 반품현황에서 카드 나열을 선택할수 있게 해줘..
 *  >  최신순. 오래된순, 등으로 선택할수 있게 해줘"
 *
 *  지켜야 할 것
 *    · 서버가 쓰는 sortKey(dateYmd_역순번)를 그대로 쓴다 — 규칙을 두 군데 두지 않는다
 *    · 상태순은 카드에 그리는 stepIndex 를 그대로 쓴다 (화면과 차례가 따로 놀면 못 믿는다)
 *    · 상태순은 손 안 간 것부터, 같은 단계면 오래된 것이 위
 *    · 철회된 건은 흐름 밖이라 맨 뒤
 *
 * 실행: node _prpsort_test.js
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

/*  ★ 이 파일 옆에서 찾는다 ★ 「portal.html」로만 적어 두면 cwd 가
    Partner_WebApp 일 때만 돈다 — 뿌리에서 부르면 ENOENT 로 터져
    시험이 아예 안 돌았다(2026-10-04 에 발견). 지켜 주는 척만 한 셈이다. */
const html = fs.readFileSync(require("path").join(__dirname, "portal.html"), "utf8");
function grabFn(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { d++; seen = true; }
    else if (html[k] === "}") { d--; if (seen && d === 0) return html.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

/*  ★ 브라우저에서 오는 값은 «세워 둔다» ★  (2026-10-04)
    LAST_SEEN_KEY 는 그 사람 브라우저의 「마지막으로 본 때」다
    (seenKey() → localStorage). 떠내서 돌릴 수 없는 값이라, 비운 채로 둔다.

    ★ 그래서 안 덮이는 것 ★ 비우면 freshCount 가 늘 0 이라
    「안 본 글이 있는 줄을 위로」는 여기서 재지지 않는다. 날짜 차례만 잰다.
    그걸 재려면 LAST_SEEN_KEY 를 값마다 바꿔 가며 돌려야 한다 — 아직 안 한다.
    적어 두는 까닭: 안 적으면 이 시험이 그것까지 지킨다고 믿게 된다.      */
const ctx = { SORT: "new", LAST_SEEN_KEY: "" };
vm.createContext(ctx);
/*  ★ 모자란 것을 «스스로» 끌어온다 ★  (2026-10-04)

    sortRows 혼자 안 돈다 — freshCount 를, 그것은 또 LAST_SEEN_KEY 를
    부른다. 이름을 손으로 하나씩 더하다가 네 번 연달아 터졌다. 그러는
    동안 이 시험은 «아예 안 돌고» 있었다 — 초록도 빨강도 아니라서
    아무도 몰랐다. 안 도는 시험은 지켜 주는 척만 한다.

    그래서 돌려 보고, 「무엇이 없다」고 하면 그것을 떠내 다시 돌린다.
    화면 코드가 함수를 더 쪼개도 시험이 따라온다 — 손이 안 간다.
    끝내 못 찾으면 그때 멈춘다(헛도는 것보다 멈추는 게 낫다).      */
function 갖춰서돌려(처음들) {
  const 담은것 = [];
  const 넣어 = (이름) => {
    if (담은것.indexOf(이름) >= 0) return false;
    //  함수면 본문째로, 아니면 top-level const/var 한 줄로
    const f = html.indexOf("function " + 이름 + "(");
    if (f >= 0) { 담은것.push(이름); vm.runInContext(grabFn(이름), ctx); return true; }
    const m = html.match(new RegExp("^[ \\t]*(?:const|var|let)[ \\t]+" + 이름 + "[ \\t]*=[^\\n]*;", "m"));
    if (m) { 담은것.push(이름); vm.runInContext(m[0].trim(), ctx); return true; }
    return false;
  };
  처음들.forEach(넣어);
  for (let 번 = 0; 번 < 40; 번++) {
    try {
      /*  ★ 빈 배열로 두드리면 안 된다 ★ 줄이 없으면 freshCount 까지
          안 내려가고, 모자란 것이 드러나지 않는다 — 그래서 한 번
          「갖췄다」고 속았다. 자료가 있는 줄로, 두 길을 다 두드린다. */
      vm.runInContext(
        "stepIndex('접수', false, []);" +
        "sortRows([{sortKey:'260901', timeline:[{kind:'status', text:'접수', at:'260901'}]}," +
        "          {sortKey:'261002', timeline:[]}], 'new');", ctx);
      return 담은것;
    } catch (e) {
      const m = String(e.message).match(/(\w+) is not defined/);
      if (!m || !넣어(m[1])) throw new Error("못 갖춤 — " + e.message + " (담은 것: " + 담은것.join(", ") + ")");
    }
  }
  throw new Error("마흔 번 해도 못 갖췄습니다 (담은 것: " + 담은것.join(", ") + ")");
}
갖춰서돌려(["stageWord", "freshCount", "stepIndex", "sortRows"]);

//  sortKey = dateYmd_역순번 (prpLedger.gs 와 같은 모양)
const 행 = (id, ymd, seq, status, done) =>
  ({ id: id, sortKey: ymd + "_" + seq, status: status, done: !!done });

const 목록 = [
  행("A", "20260911", "099998", "접수"),
  행("B", "20260914", "099999", "반품입고"),
  행("C", "20260909", "099997", "환불처리", true),
  행("D", "20260914", "099995", "접수"),
  행("E", "20260913", "099996", "철회"),
];
const ids = (rows) => rows.map(function (r) { return r.id; });
const 차례 = (mode) => { ctx.SORT = mode; return ids(ctx.sortRows(목록)); };

console.log("");
console.log("[차례] 최신순 · 오래된순");
check("최신순 — 새 것이 위", 차례("new"), ["B", "D", "E", "A", "C"]);
check("오래된순 — 묵은 것이 위", 차례("old"), ["C", "A", "E", "D", "B"]);
check("★ 둘은 정확히 뒤집힌 차례", 차례("old").slice().reverse(), 차례("new"));

console.log("");
console.log("[차례] 상태순 — 손 안 간 것부터");
//  접수(A,D) → 입고검수(B) → 처리완료(C) → 철회(E, 흐름 밖이라 맨 뒤)
check("접수 → 입고 → 완료 → 철회", 차례("stage"), ["A", "D", "B", "C", "E"]);
check("★ 같은 단계면 오래된 것이 위 (A 가 D 보다 앞)",
  차례("stage").indexOf("A") < 차례("stage").indexOf("D"), true);
check("★ 철회는 맨 뒤", 차례("stage")[4], "E");

console.log("");
console.log("[차례] 카드에 그리는 단계와 같은 규칙인가");
check("반품입고 → 2단계", ctx.stepIndex("반품입고", false), 2);
check("환불처리 → 3단계", ctx.stepIndex("환불처리", false), 3);
check("철회 → 흐름 밖(-1)", ctx.stepIndex("철회", false), -1);

console.log("");
console.log("[차례] 원본을 건드리지 않는다");
ctx.SORT = "old";
ctx.sortRows(목록);
check("★ 넘겨 준 배열은 그대로", ids(목록), ["A", "B", "C", "D", "E"]);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
