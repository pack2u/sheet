/**
 * 그날 판매현황 — 회차마다 «그날 전체»를 붙여넣어도 한 벌만 남는다
 *
 *  > "0915판매현황 화일인데 이게 맞는지 확인해줘..
 *  >  1차 1,2차 1,2,3차 이렇게 쌓이는거 같은데.."   (2026-09-16)
 *
 *  ★ 왜 그렇게 쌓였나 ★
 *    ss_그날판매현황쌓기 는 「판매현황에 올라온 것 = 이번 회차분」이라 여기고
 *    통째로 더한다. 그런데 실제 운영은 회차마다 «그날 전체»를 붙여넣는다 —
 *
 *    > "판매현황을 전체분을 안넣으면 마지막 차수 판매현황 내용의 송장만
 *    >  들어오더라구"
 *
 *      1차 : 1차분          → 탭에 1차분
 *      2차 : 1차+2차분      → 1차분(회차1) + 1차·2차분(회차2)
 *      3차 : 1차+2차+3차분  → 거기에 1·2·3차분(회차3)까지
 *
 *    1차 주문이 세 벌, 2차 주문이 두 벌. 그 탭을 그대로 읽는 일일마감에
 *    같은 주문이 두 번·세 번 들어갔다 (9/15 마감의 70줄 = 35건 × 2).
 *
 *  ★ 붙여넣기 방식을 바꾸라고 하지 않는다 ★
 *    전체분을 넣는 데는 까닭이 있다. 운영을 코드에 맞추는 것이 아니라
 *    코드가 운영을 받아야 한다.
 *
 *  지켜야 할 것
 *    · 같은 줄은 «먼저 온 회차»의 것으로 남는다 (실제로 들어온 회차)
 *    · 열쇠는 출처·회차키를 «뺀» 나머지 전부 — 그 둘은 이 탭이 붙이는 이름표다
 *    · 몇 줄 걸렀는지 말한다
 *
 * 실행: node _dailystack_test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + JSON.stringify(got) +
    "\n       want " + JSON.stringify(want)); }
};

const main = readFileSync("../gasMain.js", "utf8");

/*  이제 거르기는 «진짜 함수»다(ss_그날겹침거르기_). 오려 내지 말고 그대로 부른다 —
    오려 내면 함수 몸통이 바뀔 때마다 이 시험이 엉뚱한 데를 자른다. */
function 떼어내기(이름) {
  const i = main.indexOf("function " + 이름 + "(");
  if (i < 0) throw new Error(이름 + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < main.length; k++) {
    if (main[k] === "{") { d++; seen = true; }
    else if (main[k] === "}") { d--; if (seen && d === 0) return main.slice(i, k + 1); }
  }
  throw new Error(이름 + " 본문이 안 닫힘");
}

const ssText = (v) => (v == null ? "" : String(v).trim());
const 거르기함수 = new Function("ssText",
  떼어내기("ss_그날겹침거르기_") + "\nreturn ss_그날겹침거르기_;")(ssText);

function 걸러(all, head) {
  const r = 거르기함수(all, head);
  return { all: r.rows, 겹쳐버림: r.버림, 회차글: r.회차글 };
}

/*  판매현황 한 줄 + [출처, 회차키]  */
const HEAD = ["순번", "일자-No.", "품목코드", "품목명", "수량", "출처", "회차키"];
const 줄 = (순번, 코드, 회차) =>
  [순번, "260915-" + 순번, 코드, 코드 + " 품목", 1, "붙여넣기", 회차];

console.log("\n[1] ★ 사장님 화면 그대로 — 1차 / 1,2차 / 1,2,3차");
{
  /*  회차마다 그날 전체를 붙여넣은 결과가 탭에 쌓인 모양.
      회차키로 줄 세운 뒤(코드가 이미 그렇게 한다) 거르기에 들어간다.  */
  const 일차 = [줄(1, "A1", "260915-1"), 줄(2, "A2", "260915-1")];
  const 이차 = [줄(1, "A1", "260915-2"), 줄(2, "A2", "260915-2"), 줄(3, "B1", "260915-2")];
  const 삼차 = [줄(1, "A1", "260915-3"), 줄(2, "A2", "260915-3"),
                줄(3, "B1", "260915-3"), 줄(4, "C1", "260915-3")];
  const 쌓인것 = 일차.concat(이차).concat(삼차);
  eq("쌓인 줄", 쌓인것.length, 9);

  const r = 걸러(쌓인것, HEAD);
  eq("★ 남는 줄은 실제 주문 수만큼", r.all.length, 4);
  eq("★ 버린 줄", r.겹쳐버림, 5);

  const 회차별 = r.all.map((x) => x[6] + ":" + x[2]);
  eq("★ 각 주문이 «먼저 온 회차»에 남는다", 회차별,
    ["260915-1:A1", "260915-1:A2", "260915-2:B1", "260915-3:C1"]);
}

console.log("\n[2] 내용이 다르면 다른 줄이다");
{
  const a = 줄(1, "A1", "260915-1");
  const b = 줄(1, "A1", "260915-2");
  b[4] = 5;                       // 수량이 다르다 — 다시 시킨 것
  const r = 걸러([a, b], HEAD);
  eq("둘 다 남는다", r.all.length, 2);
  eq("버린 것 없음", r.겹쳐버림, 0);
}

console.log("\n[3] ★ 출처·회차키는 열쇠에 안 넣는다");
{
  /*  그 둘은 이 탭이 붙이는 이름표지 주문의 내용이 아니다.
      넣으면 회차가 다르다는 이유로 같은 줄이 또 남는다.  */
  const a = 줄(1, "A1", "260915-1");
  const b = 줄(1, "A1", "260915-2");
  b[5] = "원장복원";              // 출처가 다르다 — 되살린 줄
  const r = 걸러([a, b], HEAD);
  eq("★ 같은 줄로 본다", r.all.length, 1);
  eq("먼저 온 회차가 남는다", r.all[0][6], "260915-1");
}

console.log("\n[4] 빈 줄은 건드리지 않는다");
{
  const 빈 = ["", "", "", "", "", "붙여넣기", "260915-1"];
  const r = 걸러([빈, 빈, 줄(1, "A1", "260915-1")], HEAD);
  eq("빈 줄은 그냥 둔다", r.all.length, 3);
  eq("버린 것 없음", r.겹쳐버림, 0);
}

console.log("\n[5] 되살린 줄과 붙여넣은 줄이 겹쳐도 한 벌");
{
  /*  원장에서 되살린 줄(되살림)과 이번에 붙여넣은 줄(add)이 같은 주문일 수 있다.
      거르기는 셋(되살림·keep·add)을 «다 합친 뒤»에 돌아야 한다.  */
  const 되살림 = 줄(1, "A1", "260915-1");
  되살림[5] = "원장복원";
  const 붙임 = 줄(1, "A1", "260915-2");
  const r = 걸러([되살림, 붙임], HEAD);
  eq("★ 한 벌만 남는다", r.all.length, 1);
  eq("되살린 쪽(먼저 온 회차)이 남는다", r.all[0][5], "원장복원");
}

console.log("\n[6] 거르기가 «합친 뒤·쓰기 전»에 있다");
{
  const 합침 = main.indexOf("var all = 되살림.concat(keep).concat(add);");
  //  거르기는 이제 함수 호출이다 — 그 «부르는 자리»를 본다
  const 거름 = main.indexOf("var _거른_ = ss_그날겹침거르기_(all, head);");
  const 정렬 = main.indexOf("all.sort(function (x, y) {", 합침);
  const 쓰기 = main.indexOf("ssio_clearBody(sh);", 거름);
  eq("★ 셋을 합친 뒤다", 합침 >= 0 && 거름 > 합침, true);
  eq("★ 회차키로 줄 세운 뒤다 (먼저 온 회차가 남으려면)", 정렬 >= 0 && 거름 > 정렬, true);
  eq("★ 시트에 쓰기 전이다", 쓰기 > 거름, true);
}

console.log("\n[7] 몇 줄 걸렀는지 «말한다»");
{
  eq("결과에 담는다", main.indexOf("겹쳐버림: 겹쳐버림") >= 0, true);
  eq("요약에 적는다", main.indexOf("↷ 앞 회차와 겹쳐 버린 줄") >= 0, true);
  eq("★ 까닭까지 적는다", main.indexOf("전체분을 붙여넣어 딸려온 것") >= 0, true);
}


console.log("\n[8] ★ 쌓기와 메우기가 «같은» 규칙을 쓴다");
{
  /*  쌓기만 고치고 메우기를 두면, 메우기를 돌린 날만 다시 세 벌이 된다.
      규칙은 한 곳에 있어야 한다.  */
  //  «정의»가 아니라 «부르는 자리»만 센다 (function 이 앞에 붙은 것은 정의다)
  const 부름 = (main.match(/= ss_그날겹침거르기_\(/g) || []).length;
  eq("★ 두 곳에서 부른다 (쌓기·메우기)", 부름, 2);

  function 안에있나(함수이름, 찾을말) {
    const i = main.indexOf("function " + 함수이름 + "(");
    if (i < 0) return false;
    let d = 0, seen = false;
    for (let k = i; k < main.length; k++) {
      if (main[k] === "{") { d++; seen = true; }
      else if (main[k] === "}") { d--; if (seen && d === 0) return main.slice(i, k + 1).indexOf(찾을말) >= 0; }
    }
    return false;
  }
  eq("쌓기가 부른다", 안에있나("ss_그날판매현황쌓기", "ss_그날겹침거르기_("), true);
  eq("★ 메우기도 부른다", 안에있나("ss_그날판매현황메우기", "ss_그날겹침거르기_("), true);
  eq("메우기도 몇 줄 걸렀는지 말한다", main.indexOf("↷ 앞 회차와 겹쳐 버린 줄 ") >= 0, true);
}

console.log("");
console.log(fail === 0 ? "✅ 통과 " + pass + "건" : "❌ 실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
