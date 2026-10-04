/**
 * 협력업체 포털 — 상단 단계가 「처리 경과」를 따라간다
 *
 *  > "당장드림 반품현황이야.. 아래 상태값에 따라 상단 아이콘도 바뀌어야 되는데 따로놀아"
 *
 *  ★ 무엇이 어긋나 있었나 ★
 *    대장 A열은 사람이 자유롭게 적는 칸이다. 9월 한 달에만 열네 가지 말이 쓰였고
 *    「진행중·사고·자동·확인필요문정」 19건은 규칙이 모르는 말이라 맨 아래
 *    return 0 으로 떨어졌다. 이은화 건이 그랬다 —
 *      처리 경과 : 260922 09:39 [CS팀] 입고검수
 *      상단 단계 : 접수
 *    오류가 아니라 «폴백»이라 아무도 몰랐다.
 *
 *  ★ CS 웹앱과 쌍으로 ★
 *    csOrderSearch.gs 의 _cs_stageWord_ / _cs_stageFromTimeline_ 과 같은 규칙이다.
 *    한쪽만 고치면 또 조용히 갈라진다 — 아래 ④ 가 그것을 지킨다.
 *
 * 실행: node _prpstage_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const html = fs.readFileSync(path.join(__dirname, "Partner_WebApp", "portal.html"), "utf8");
function 꺼내(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { d++; seen = true; }
    else if (html[k] === "}") { d--; if (seen && d === 0) return html.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const ctx = { String, Number, RegExp, console };
vm.createContext(ctx);
["stageWord", "stageFromTimeline", "stepIndex"].forEach((n) => vm.runInContext(꺼내(n), ctx));

const 줄 = (text, kind) => ({ kind: kind || "status", text: text, date: "260922", time: "9:39" });
const S = (status, done, tl) => ctx.stepIndex(status, done, tl);

console.log("\n① 여태 되던 것은 그대로");
{
  ok("접수 → 0", S("접수", false) === 0);
  ok("반품송장 → 1", S("반품송장", false) === 1);
  ok("입고검수 → 2", S("입고검수", false) === 2);
  ok("이카운트OK → 3", S("이카운트OK", false) === 3);
  ok("완료 플래그 → 3", S("접수", true) === 3);
  ok("철회 → -1 (단계 자체를 안 그린다)", S("철회", false) === -1);
  ok("  취소도", S("주문취소", false) === -1);
  ok("옛 낱말 — 수거요청 → 1", S("수거요청", false) === 1);
  ok("옛 낱말 — 반품입고 → 2", S("반품입고", false) === 2);
}

console.log("\n② ★ 이은화 건 — A열은 「진행중」, 경과는 「입고검수」 ★");
{
  const 경과 = [줄("입고검수"), { kind: "cs", text: "CS 확인 — 접수 내용을 확인했습니다", date: "260919" }];
  ok("★ 2(입고검수)로 그린다", S("진행중", false, 경과) === 2, S("진행중", false, 경과));
  ok("  경과를 안 주면 여태처럼 0", S("진행중", false) === 0);
}

console.log("\n③ 규칙이 모르는 말들 — 9월에 실제로 쓰인 것");
{
  [["사고", [줄("입고검수")], 2],
   ["자동", [줄("반품송장")], 1],
   ["확인필요문정", [줄("이카운트OK")], 3]].forEach(([w, tl, want]) => {
    ok("「" + w + "」 + 경과 → " + want, S(w, false, tl) === want, S(w, false, tl));
  });

  //  뒤로는 안 내려간다
  ok("★ A열 완료 + 경과 접수 → 3 (뒤로 안 내려간다)",
    S("완료", false, [줄("접수")]) === 3, S("완료", false, [줄("접수")]));

  //  상담 본문에 걸리면 안 된다
  const 상담 = [{ kind: "cs", text: "입고 언제 되나요 문의", date: "260920" }];
  ok("★ 상담 본문의 「입고」에는 안 걸린다", S("진행중", false, 상담) === 0, S("진행중", false, 상담));
  const 내글 = [{ kind: "mine", text: "입고 확인 부탁드립니다", date: "260920" }];
  ok("  업체가 쓴 글에도 안 걸린다", S("진행중", false, 내글) === 0);

  ok("철회는 경과가 있어도 -1", S("철회", false, [줄("입고검수")]) === -1);
  ok("빈 경과·null 도 안 터진다", S("진행중", false, []) === 0 && S("진행중", false, null) === 0);
}

console.log("\n④ ★ CS 웹앱과 «쌍으로» 고쳤나 ★");
{
  const cs = fs.readFileSync(path.join(__dirname, "CS_WebApp", "csOrderSearch.gs"), "utf8");
  ok("CS 에도 낱말 함수가 있다", /function _cs_stageWord_\(/.test(cs));
  ok("CS 에도 경과 함수가 있다", /function _cs_stageFromTimeline_\(/.test(cs));
  ok("CS 도 「상태→」 줄만 본다", /e\.kind === "status"/.test(cs));
  ok("CS 도 더 앞선 것을 쓴다", /경과 > 글자 \? 경과 : 글자/.test(cs));
  ok("포털도 더 앞선 것을 쓴다", /경과 > 글자 \? 경과 : 글자/.test(html));
  ok("★ 포털에 「쌍으로 고칠 것」이 적혀 있다", /쌍으로 고칠 것/.test(html));
  ok("단계 넷은 두 화면이 같다", /STEPS = \['접수', '회수중', '입고검수', '처리완료'\]/.test(html));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
