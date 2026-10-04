/**
 * 카카오 송장매칭 — 이름 한 글자 차이로 붙던 것
 *
 *  > "요즘 주문 누락.. 누락건에 송장 엄한거 넣기..이런상황이 발생하는데"
 *  > "㉮+㉯ 둘 다 해줘"
 *
 *  ㉮ 짐작으로 붙은 줄을 «눈에 띄게»
 *  ㉯ 사람 이름 길이에서는 유사도 매칭을 끈다
 *
 *  ★ 한국 사람 이름은 두세 자다 ★
 *    한 글자 차이는 «오타»가 아니라 «다른 사람»이다.
 *      이경훈 ↔ 이정훈   거리 1
 *      김민수 ↔ 김민주   거리 1
 *    같은 업체 전용양식에 둘이 같이 있으면 엉뚱한 사람에게 송장이 갔다.
 *
 * 실행: node _kakaomatch_test.js
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

const SRC = fs.readFileSync("InvoiceMatch_협력업체용.gs", "utf8");
const has = (s) => SRC.indexOf(s) >= 0;

/* ── 유사도 판정만 떼어 와 그대로 돌린다 ───────────────── */
function fnFrom(name) {
  const at = SRC.indexOf("function " + name + "(");
  if (at < 0) throw new Error("못 찾음: " + name);
  let d = 0;
  const open = SRC.indexOf("{", at);
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === "{") d++;
    else if (SRC[i] === "}") { d--; if (d === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error("안 닫힘: " + name);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fnFrom("_levenshteinLocal_"), ctx);

/*  코드에 적힌 문턱을 «소스에서 읽어» 그대로 쓴다.
    여기에 숫자를 손으로 베껴 두면 코드가 바뀌어도 시험은 통과한다. */
const at = SRC.indexOf("var dist = _levenshteinLocal_(inputNorm, sheetNorm);");
const blk = SRC.substring(at, SRC.indexOf("if (bestKey)", at));
/*  주석에도 「threshold」가 적혀 있다. «코드 줄»만 집는다 —
    다듬은 줄이 `var threshold` 나 `if (` 로 시작하고 `;` 로 끝나는 것만. */
const 문턱줄 = blk.split("\n").map((l) => l.trim()).filter(
  (l) => l.indexOf("threshold") >= 0 && l.slice(-1) === ";" &&
    (l.indexOf("var threshold") === 0 || l.indexOf("if (") === 0 ||
     l.indexOf("else if (") === 0 || l.indexOf("else ") === 0),
);
if (문턱줄.length < 2) {
  console.log("  FAIL 문턱 줄을 못 집었습니다 — " + JSON.stringify(문턱줄));
  process.exit(1);
}
vm.runInContext(
  "function 붙나(a, b) {" +
  "  var inputNorm = a.replace(/\\s/g, ''); var sheetNorm = b.replace(/\\s/g, '');" +
  "  var maxLen = Math.max(inputNorm.length, sheetNorm.length);" +
  "  if (maxLen === 0) return false;" +
  "  var dist = _levenshteinLocal_(inputNorm, sheetNorm);" +
  문턱줄.join("\n") +
  "  return dist <= threshold;" +
  "}", ctx);
const 붙나 = (a, b) => ctx.붙나(a, b);

/* ── [1] 사람 이름 — 한 글자 달라도 안 붙는다 ───────────── */
console.log("\n[1] 한 글자 차이는 «다른 사람»이다");
{
  ok("★ 이경훈 ↔ 이정훈 안 붙는다", !붙나("이경훈", "이정훈"));
  ok("★ 김민수 ↔ 김민주 안 붙는다", !붙나("김민수", "김민주"));
  ok("★ 박상식 ↔ 박상익 안 붙는다", !붙나("박상식", "박상익"));
  ok("★ 두 자 이름도 (한나 ↔ 한라)", !붙나("한나", "한라"));
  ok("★ 네 자도 (남궁민수 ↔ 남궁민주)", !붙나("남궁민수", "남궁민주"));
  ok("★ 성만 같은 것도 (이경훈 ↔ 이경희)", !붙나("이경훈", "이경희"));
}

/* ── [2] 그래도 «같은 이름»은 붙어야 한다 ───────────────── */
console.log("\n[2] 띄어쓰기만 다른 것은 같은 이름이다");
{
  ok("★ 김 민수 ↔ 김민수", 붙나("김 민수", "김민수"));
  ok("★ 이경훈  ↔ 이 경 훈", 붙나("이경훈", "이 경 훈"));
  ok("  똑같은 것", 붙나("이경훈", "이경훈"));
}

/* ── [3] 긴 상호는 한 글자를 봐준다 ────────────────────── */
console.log("\n[3] 긴 상호(8자 이상)만 오타를 봐준다");
{
  ok("★ 주식회사팩투유 ↔ 주식회사팩두유 (8자)", 붙나("주식회사팩투유가", "주식회사팩두유가"));
  ok("  일곱 자는 안 봐준다", !붙나("주식회사팩투", "주식회사팩두"));
  ok("★ 두 글자 다르면 긴 상호도 안 붙는다",
    !붙나("주식회사팩투유가", "주식회사빡두유가"));
}

/* ── [4] 코드에 그 문턱이 박혀 있는가 ───────────────────── */
console.log("\n[4] 문턱");
{
  ok("★ 3자에 거리 1 을 주던 줄이 없다",
    SRC.indexOf("else if (maxLen >= 3) threshold = 1;") < 0);
  ok("★ 6자에 거리 2 를 주던 줄도 없다",
    SRC.indexOf("if (maxLen >= 6) threshold = 2;") < 0);
  ok("★ 8자 이상만 1", has("if (maxLen >= 8) threshold = 1;"));
  ok("  절반 넘게 다르면 아예 막는 문은 그대로",
    has("if (dist > Math.ceil(maxLen * 0.5)) threshold = -1;"));
}

/* ── [5] 짐작을 눈에 띄게 ──────────────────────────────── */
console.log("\n[5] 짐작으로 붙은 줄이 보이는가");
{
  ok("★ 회색 ≈ 가 사라졌다",
    SRC.indexOf('<span style=\\"color:#aaa\\">≈</span>') < 0);
  ok("★ 「짐작」이라 적는다", has("짐작</span>"));
  ok("★ 줄 전체를 물들인다", has("background:#fff8e1"));
  ok("★ 표를 훑기 전에 «몇 건»인지 말한다", has("짐작으로 붙인 줄 ' + guessN + '건"));
  ok("  0 건이면 아무 말 안 한다", has("(guessN > 0 ?"));
  ok("  세는 자리가 있다", has("if (ok[gi].name !== ok[gi].matchedName) guessN++;"));
}

/* ── [6] 안 건드린 것 ──────────────────────────────────── */
console.log("\n[6] 멀쩡하던 길은 그대로");
{
  //  큐에서 빼서 배정 → 한 송장이 여러 주문에 붙지 않는다
  ok("★ 큐에서 빼는 것은 그대로", has("assignedRows = [q.splice(selectedIdx, 1)[0]];"));
  //  같은 이름이 여럿이면 품목명으로 가른다 (바디/캡·소중대)
  ok("★ 품목명으로 가르는 것도 그대로", has('var sizeKeys = ["바디", "캡", "뚜껑", "소", "중", "대", "특대"];'));
  //  사람이 적용을 눌러야 시트에 쓴다
  ok("★ 적용은 여전히 사람 손", has("function applyInvoiceMatchesLocal(matchesJson)"));
  //  미매칭 후보 고르기(35% 유사도)는 «사람에게 보여 주는» 것이라 그대로 둔다
  ok("★ 후보 제안은 그대로 (사람이 고르는 자리다)", has("if (sim >= 0.35) score = Math.max"));
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
