/**
 * CS 조회 — 한 달치 · 새로고침해도 다시 안 불러온다
 *
 *  > "cs에서는 지금 한달치를 볼수 있게 해달라고 하는데..."  "기본 30일로 해줘"
 *  > "앱이 업데이트 될때 새로고침을 하는데. 그때 데이타도 다시 불러오는부분을
 *  >  막아줘.. 필요시 데이타 새로고침버튼을 누르면 되니까"
 *
 *  ★ 왜 다시 불렀나 ★
 *    sessionStorage 는 새로고침을 견딘다(탭을 닫을 때만 비워진다).
 *    그런데 되살려 놓고 곧바로 warm 을 또 불렀다 —
 *      if (loadLocalIndex()) { setIndexStatus('메모리'); warm(false); }
 *      else                  { warm(false); }
 *    두 갈래가 같은 일을 했다. 30일이면 파일 서른 개를 다시 읽는다.
 *
 * 실행: node _csdays_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}
function grab(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const 코드만 = (s) => s.split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const gs = fs.readFileSync("csOrderSearch.gs", "utf8");
const html = fs.readFileSync("home.html", "utf8");

console.log("\n[1] ★ 한 달이 기본이다");
{
  const 자르기 = 코드만(grab(gs, "_cs_clampDays_"));
  check("★ 30을 돌려준다 (기본)", /return 30;/.test(자르기), true);
  check("7 도 산다", /if \(n === 7\) return 7;/.test(자르기), true);
  check("14 도 산다", /if \(n === 14\) return 14;/.test(자르기), true);
  check("★ 서버 기본이 30", /_CS_DAILY_DAYS_DEFAULT_ = 30;/.test(gs), true);
  check("★ 화면 기본이 30", /var DAYS = 30;/.test(html), true);
  check("★ 10 이라는 어중간한 값이 없다", /_CS_DAILY_DAYS_DEFAULT_ = 10;/.test(gs), false);
}

console.log("\n[2] 1달 단추가 있다");
{
  check("★ 단추", html.indexOf('id="d30" onclick="setDays(30)"') >= 0, true);
  const 고르기 = 코드만(grab(html, "setDays"));
  check("★ 켜짐 표시", /d30.*n === 30/.test(고르기), true);
  check("2주도 그대로", /d14.*n === 14/.test(고르기), true);
}

console.log("\n[3] ★ 새로고침해도 다시 «안» 불러온다");
{
  const 몸 = 코드만(grab(html, "showWorkspace"));
  const i되살림 = 몸.indexOf("loadLocalIndex()");
  const 뒤 = 몸.slice(i되살림, i되살림 + 400);
  check("★ 되살림을 먼저 본다", i되살림 >= 0, true);
  //  되살린 갈래 «안»에 warm 이 없어야 한다
  const 갈래 = 뒤.slice(0, 뒤.indexOf("} else {"));
  check("★ 되살린 갈래는 warm 을 안 부른다", 갈래.indexOf("warm(") < 0, true);
  check("★ 못 되살리면 그때만 부른다", 뒤.indexOf("} else {") >= 0 &&
    뒤.slice(뒤.indexOf("} else {")).indexOf("warm(false)") >= 0, true);
  check("★ 몇 건인지 말한다", 갈래.indexOf("INDEX.length") >= 0, true);
}

console.log("\n[4] ★ 저장이 실패하면 «말한다»");
{
  /*  30일치는 sessionStorage 한도(대개 5MB)에 닿을 수 있다.
      조용히 실패하면 「메모리」라고 적어 두고도 새로고침마다 다시 읽는다 —
      사람은 왜 느린지 모른다.  */
  const 저장 = 코드만(grab(html, "saveLocalIndex"));
  check("★ 실패를 남긴다", 저장.indexOf("IDX_SAVE_FAIL = true") >= 0, true);
  check("★ 성공하면 되돌린다", 저장.indexOf("IDX_SAVE_FAIL = false") >= 0, true);
  check("★ 반쯤 남은 것을 지운다", 저장.indexOf("removeItem(IDX_KEY)") >= 0, true);

  const 상태 = 코드만(grab(html, "setIndexStatus"));
  check("★ 상태줄이 그 사실을 보여 준다", 상태.indexOf("IDX_SAVE_FAIL") >= 0, true);
  check("★ 무엇이 일어나는지 적는다", 상태.indexOf("다시 불러옵니다") >= 0, true);
}

console.log("\n[5] 열쇠와 유효기간");
{
  check("★ 열쇠를 v6 로 올렸다 (30일로 뜻이 바뀜)",
    html.indexOf("'pack2u_cs_idx_v6'") >= 0, true);
  check("★ 6시간 — 서버 캐시와 같다", /IDX_TTL = 6 \* 60 \* 60 \* 1000/.test(html), true);
}
console.log("\n[6] ★ 주말은 «찾지 않는다»");
{
  /*  > "1달이라면 사실 주 5일...20개~25개 정도야"   "주말 출고는 없어"

      주말엔 마감 파일이 아예 없다. 그런데 날짜 목록에 넣어 두니 늘
      「못 찾은 날」로 남았고, 화면은 그걸 보고 «아직 다 못 불러왔다»고
      판단해 매번 주말을 다시 찾으러 갔다 — 있을 리 없는 파일을.  */
  const 서버 = 코드만(grab(gs, "_cs_dateList_"));
  check("★ 서버가 토·일을 뺀다", /dow === 0 \|\| dow === 6/.test(서버), true);

  const 화면 = 코드만(grab(html, "dateList"));
  check("★ 화면도 토·일을 뺀다", /dow === 0 \|\| dow === 6/.test(화면), true);

  /*  실제로 며칠이 나오나 — 달력 30일이면 영업일 22일  */
  function 흉내(n, 기준) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = new Date(기준.getFullYear(), 기준.getMonth(), 기준.getDate() - i);
      const w = x.getDay();
      if (w === 0 || w === 6) continue;
      out.push(x);
    }
    return out;
  }
  check("★ 달력 30일 → 영업일 22일", 흉내(30, new Date(2026, 8, 16)).length, 22);
  check("달력 14일 → 10일", 흉내(14, new Date(2026, 8, 16)).length, 10);
  check("달력 7일 → 5일", 흉내(7, new Date(2026, 8, 16)).length, 5);
}

console.log("\n[7] ★ 없는 날은 «없다»고 기억한다");
{
  /*  공휴일·아직 안 만들어진 날은 찾아도 없다. 기억 안 하면 새로고침마다
      드라이브를 다시 뒤진다 — 늘 헛걸음이다.  */
  const 몸 = 코드만(grab(gs, "_cs_loadDay_"));
  check("★ 못 찾으면 빈 것으로 캐시한다",
    /cache\.put\(key, JSON\.stringify\(\{ rows: \[\] \}\), 1800\)/.test(몸), true);
  check("★ found:true 로 돌려준다 (다시 안 찾게)",
    몸.indexOf('return { found: true, fromCache: false, rows: [], error: "" };') >= 0, true);
  check("30분만 기억한다 (오늘치는 곧 생긴다)", 몸.indexOf("1800") >= 0, true);
}

console.log("\n[8] ★ 대시보드 막대도 «같은 창»이다");
{
  /*  여기만 따로 세면 막대가 주말을 세워 0 으로 선다.
      불러온 적 없는 날을 0 으로 보여 주는 것은 거짓말이다.  */
  const 몸 = 코드만(grab(html, "shipDateList"));
  check("★ 조회 창에서 가져온다", 몸.indexOf("dateList(n)") >= 0, true);
  check("★ 오늘은 뺀다 (어제부터)", 몸.indexOf("=== today) continue") >= 0, true);
  check("★ 공휴일도 뺀다", 몸.indexOf("isKrHoliday(all[i])") >= 0, true);
  check("★ 따로 세지 않는다", 몸.indexOf("guard < 60") < 0, true);
}


console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
