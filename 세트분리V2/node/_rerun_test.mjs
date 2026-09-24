/**
 * 🔂 세트분리 재실행 — 회차를 올리지 않는다
 *
 *  > "세트분리 메뉴에 세트분리 재실행을 만들어 회차가 늘어나는 부분을 없애는게
 *  >  좋겠어 같은 판매현황 재실행으로 회차 추가없이 재실행으로 할경우 쓸수
 *  >  있도록...."   (2026-09-16)
 *
 *  ★ 왜 회차가 늘었나 ★
 *    회차는 판매현황 «내용의 지문»으로 가른다. 그런데 세트분리가 돌면서
 *    판매현황 O열에 전화주문 고유아이디를 적는다. 그러고 다시 돌리면 지문이
 *    달라져 새 회차가 된다 — 사람 눈에는 같은 판매현황인데 1차가 2차가 된다.
 *
 *  ★ 왜 문제인가 ★
 *    원장·실행이력·그날 판매현황·합배송·사방넷 대량등록·일일마감이 전부
 *    회차로 묶인다. 없던 2차가 생기면 그 2차를 «실제 출고분»으로 친다.
 *
 * 실행: node _rerun_test.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n       got  " + JSON.stringify(got) +
    "\n       want " + JSON.stringify(want)); }
};

const main = readFileSync("../gasMain.js", "utf8");
function grab(name) {
  const i = main.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 없음");
  let d = 0, seen = false;
  for (let k = i; k < main.length; k++) {
    if (main[k] === "{") { d++; seen = true; }
    else if (main[k] === "}") { d--; if (seen && d === 0) return main.slice(i, k + 1); }
  }
  throw new Error(name + " 안 닫힘");
}

//  ── 회차 탭 흉내 ──  아래로 쌓이고, 우리가 쓴 값을 그대로 기억한다
function 만들기(초기) {
  const 표 = 초기.map((r) => r.slice());
  const sh = {
    getRange(row, col, _nr, nc) {
      return {
        setValues(vals) {
          const r = row - 2;                       // 머리글 1행
          while (표.length <= r) 표.push(["", "", "", "", "", "", "", ""]);
          for (let c = 0; c < nc; c++) 표[r][col - 1 + c] = vals[0][c];
        },
      };
    },
    getLastRow() { return 표.length + 1; },
  };
  return { 표, sh };
}

function 판(초기) {
  const { 표, sh } = 만들기(초기);
  const ctx = {
    SSIO_TABS: { 회차: "회차" },
    SS_ROUND_HEADER: ["회차키", "지문", "일자", "회차", "입력행", "최초실행", "마지막실행", "실행횟수"],
    ssio_sheet: () => sh,
    ssio_body: () => 표.map((r) => r.slice()),
    ssText: (v) => (v == null ? "" : String(v).trim()),
    ssNum: (v) => (Number(v) || 0),
    Utilities: { formatDate: (d, tz, f) => (f === "yyMMdd" ? "260916" : "2026-09-16 10:00:00") },
    표,
  };
  vm.createContext(ctx);
  vm.runInContext(grab("ss_회차확정") + "\n" + grab("ss_회차유지확정") + "\n" + grab("ss_마지막회차_"), ctx);
  return ctx;
}

const 어제 = ["260915-1", "지문A", "260915", 1, 100, "t0", "t0", 1];
const 오늘1 = ["260916-1", "지문B", "260916", 1, 200, "t1", "t1", 1];

console.log("\n[1] 평소 실행 — 내용이 달라지면 회차가 는다");
{
  const c = 판([어제, 오늘1]);
  const r = vm.runInContext('ss_회차확정("지문C", 210)', c);
  eq("새 회차키", r.key, "260916-2");
  eq("재실행 아님", r.재실행, false);
  eq("표가 한 줄 늘었다", c.표.length, 3);
}

console.log("\n[2] 평소 실행 — 지문이 «똑같으면» 안 는다 (예전부터 그랬다)");
{
  const c = 판([어제, 오늘1]);
  const r = vm.runInContext('ss_회차확정("지문B", 200)', c);
  eq("같은 회차키", r.key, "260916-1");
  eq("재실행", r.재실행, true);
  eq("표가 안 늘었다", c.표.length, 2);
}

console.log("\n[3] ★ 재실행 — 내용이 달라져도 회차가 안 는다");
{
  /*  O열에 고유아이디가 적혀 지문이 「지문B2」로 달라진 상황.
      평소 실행이면 260916-2 가 생긴다. 재실행은 260916-1 을 그대로 쓴다. */
  const c = 판([어제, 오늘1]);
  const r = vm.runInContext('ss_회차유지확정("260916-1", "지문B2", 205)', c);
  eq("★ 회차키 그대로", r.key, "260916-1");
  eq("★ 표가 안 늘었다", c.표.length, 2);
  eq("회차유지 표시", r.회차유지, true);
  eq("실행횟수가 하나 올랐다", c.표[1][7], 2);
  eq("★ 지문은 이번 내용으로 갈아 끼운다", c.표[1][1], "지문B2");
  eq("입력행도 갱신", c.표[1][4], 205);
  eq("최초실행은 안 건드린다", c.표[1][5], "t1");
}

console.log("\n[4] 재실행 뒤 평소 실행을 눌러도 같은 회차에 붙는다");
{
  /*  지문을 갈아 끼우는 까닭이 이것이다. 안 갈아 끼우면 다음 ▶ 실행이
      「처음 보는 내용」이라며 새 회차를 판다. */
  const c = 판([어제, 오늘1]);
  vm.runInContext('ss_회차유지확정("260916-1", "지문B2", 205)', c);
  const r = vm.runInContext('ss_회차확정("지문B2", 205)', c);
  eq("★ 새 회차를 안 판다", r.key, "260916-1");
  eq("표 그대로", c.표.length, 2);
}

console.log("\n[5] 없는 회차를 가리키면 평소대로 판정한다");
{
  //  사람이 회차 줄을 지웠을 수 있다. 없는 회차에 억지로 쌓으면 원장과 어긋난다.
  const c = 판([어제, 오늘1]);
  const r = vm.runInContext('ss_회차유지확정("260916-9", "지문C", 210)', c);
  eq("새 회차가 생긴다", r.key, "260916-2");
  eq("회차유지 표시 없음", r.회차유지, undefined);
}

console.log("\n[6] 마지막 회차 집기");
{
  const c = 판([어제, 오늘1]);
  eq("맨 끝 줄", vm.runInContext("ss_마지막회차_().key", c), "260916-1");
  const 빈 = 판([]);
  eq("비어 있으면 null", vm.runInContext("ss_마지막회차_()", 빈), null);
}

console.log("\n[7] 메뉴에 걸려 있다");
{
  eq("메뉴 항목", main.indexOf("🔂 세트분리 재실행 (회차 그대로)") >= 0, true);
  eq("ss_재실행 이 있다", main.indexOf("function ss_재실행()") >= 0, true);
  eq("ss_실행 에 회차유지를 넘긴다", main.indexOf("ss_실행({ 회차유지: 마지막.key })") >= 0, true);
  eq("요약에 표시된다", main.indexOf("🔂 재실행 (회차 그대로)") >= 0, true);
}


console.log("\n[8] 재실행·조치 적용은 마스터를 다시 안 당긴다");
{
  /*  ssm_refreshBeforeRun 은 «외부 이카운트 시트»를 열어 품목·재고·BOM·
      도서산간을 통째로 다시 받아 각 마스터 탭에 쓴다. 재실행은 방금 돌린
      그 회차를 다시 그리는 일이라 그 값이 이미 있다.

      속도만의 문제가 아니다 — 그 사이 재고가 줄면 같은 회차인데 판정이
      달라진다. 1차에서 자사출고였던 줄이 조치 한 번 반영하고 나니
      재고부족으로 대리발송이 되어 있는 식이다.  */
  eq("건너뛰는 갈래가 있다", main.indexOf("var 갱신건너뜀 = !!(opts.회차유지 || opts.mirrorOnly);") >= 0, true);
  eq("건너뛸 때는 안 부른다",
    /갱신건너뜀[\s\S]{0,400}?ssm_refreshBeforeRun\(cfgRaw\)/.test(main), true);
  eq("평소엔 그대로 부른다", main.indexOf(": ssm_refreshBeforeRun(cfgRaw);") >= 0, true);
  eq("건너뛰었다고 요약에 적는다", main.indexOf("건너뜀 (재실행 — 직전 값 그대로") >= 0, true);
  eq("빠져나갈 길을 알려 준다", main.indexOf("새 재고로 보려면 ▶ 세트분리 실행") >= 0, true);

  //  ssm_refreshBeforeRun 을 부르는 곳이 ss_실행 안에 «한 군데»뿐이어야 한다.
  //  두 군데면 한쪽만 건너뛰고 다른 쪽이 그대로 당긴다.
  const 부름 = (main.match(/ssm_refreshBeforeRun\(/g) || []).length;
  eq("부르는 곳은 한 군데", 부름, 1);
}

console.log("\n[9] 구간 시계 — 어디서 시간을 썼는지 적는다");
{
  eq("시계가 있다", main.indexOf("function ss단계_(") >= 0, true);
  eq("요약에 구간을 적는다", main.indexOf("⏱ 오래 걸린 구간") >= 0, true);
  eq("전체 시간을 따로 적는다", main.indexOf("소요(초) · 전체") >= 0, true);

  /*  단계 이름은 «실패했을 때 어느 단계에서 멈췄나»를 말하는 그 이름이다.
      시계용으로 따로 두면 언젠가 어긋난다. 그래서 단계 = ss단계_('...') 꼴로
      한 벌만 쓴다 — 맨 이름만 넣는 곳이 남아 있으면 그 구간이 통째로 빠진다. */
  const 맨이름 = main.match(/^\s*단계 = '[^']+';/gm) || [];
  eq("★ 시계에 안 물린 단계가 없다", 맨이름, []);

  const 물린것 = (main.match(/단계 = ss단계_\('/g) || []).length;
  eq("★ 구간이 넉넉히 잘려 있다 (12개 이상)", 물린것 >= 12, true, 물린것 + "개");
}

console.log("");
console.log(fail === 0 ? "✅ 통과 " + pass + "건" : "❌ 실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
