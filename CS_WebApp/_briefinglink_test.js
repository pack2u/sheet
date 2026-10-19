/**
 * 새벽 브리핑 — 주소는 단추로, 안내문구는 없앤다
 *
 *  > "링크는 안보이게 시트보기 버튼으로 보이게해줘"
 *  > "자동 수집은 주말·공휴일에 멈춥니다 … 이런 안내문구도 삭제해줘"
 *
 *  ★ 이 칸은 원래 «주문검색 키워드» 자리다 ★ 브리핑이 시트 주소를 넣으면서
 *    주소를 통째로 검색어로 삼는 단추가 떠 있었다 — 눌러도 아무것도 안 나온다.
 *    주소면 열기, 아니면 검색. 둘을 가른다.
 *
 * 실행: node _briefinglink_test.js
 */
const fs = require("fs"), path = require("path");

let fail = 0, pass = 0;
const 자리 = {
  home: path.join(__dirname, "home.html"),
  brief: path.join(__dirname, "csBriefing.gs"),
  v2: "D:/Pack2U_협력업체시스템_v2/app/src/lib/briefing.ts",
};
const 읽기 = (k) => { try { return fs.readFileSync(자리[k], "utf8"); } catch (e) { return ""; } };

/*  화면 조각을 진짜 돌린다 — 글자 맞춰보기가 아니다.
    c.link 를 그리는 그 한 토막만 떼어 와서 두 가지 값으로 돌려 본다.  */
function 단추글(html, link) {
  const i = html.indexOf("      if (c.link) {");
  if (i < 0) return "(그리는 자리를 못 찾음)";
  let d = 0, seen = false, end = i;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { d++; seen = true; }
    else if (html[k] === "}") { d--; if (seen && d === 0) { end = k + 1; break; } }
  }
  const 토막 = html.slice(i, end);
  const f = new Function("c", "h", "esc", "js",
    토막 + "\nreturn h;");
  const esc = (s) => String(s == null ? "" : s);
  return f({ link: link }, "", esc, esc);
}

function 재보기(고침) {
  고침 = 고침 || {};
  const g = (k) => (고침[k] !== undefined ? 고침[k] : 읽기(k));
  const 운것 = [];
  try {
    const html = g("home");

    /* ① 주소면 「시트 보기」 단추 — 주소 글자는 안 보인다 */
    {
      const 주소 = "https://docs.google.com/spreadsheets/d/1oj-0Bxg/edit#gid=1712329194";
      const out = 단추글(html, 주소);
      if (!/시트 보기/.test(out)) 운것.push("①시트보기단추");
      if (/주문 검색/.test(out)) 운것.push("①주소인데주문검색");
      //  ★ 주소가 «글자»로 보이면 안 된다. onclick 안에 있는 것은 괜찮다
      const 글자만 = out.replace(/onclick="[^"]*"/g, "");
      if (/docs\.google\.com/.test(글자만)) 운것.push("①주소가글자로보임");
      if (!/window\.open/.test(out)) 운것.push("①새창으로열기");
      if (!/noopener/.test(out)) 운것.push("①noopener");
    }

    /* ② 주소가 아니면 여태대로 주문 검색 */
    {
      const out = 단추글(html, "261016-12345");
      if (!/주문 검색/.test(out)) 운것.push("②주문검색그대로");
      if (/시트 보기/.test(out)) 운것.push("②검색어인데시트보기");
      if (!/hbGoOrder/.test(out)) 운것.push("②hbGoOrder를부름");
    }

    /* ③ 브리핑 글에 주소를 적지 않는다 */
    {
      const b = g("brief");
      if (!b) 운것.push("③브리핑을못읽음");
      else {
        const 자료 = b.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        if (/자세한 것은 시트에서/.test(자료)) 운것.push("③글에주소줄남음");
        //  ★ 그래도 link 로는 넘겨야 한다 ★ 안 넘기면 단추가 아예 안 뜬다
        if (!/link:\s*url/.test(자료)) 운것.push("③link로는넘김");
      }
    }

    /* ④ v2 브리핑에서 안내문구가 사라졌다 */
    {
      const v = g("v2");
      if (!v) 운것.push("④v2브리핑을못읽음");
      else {
        const 자료 = v.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        if (/주말·공휴일에 멈춥니다/.test(자료)) 운것.push("④연휴문구남음");
        if (/급하면 업체시트 관리 메뉴/.test(자료)) 운것.push("④손으로돌리기문구남음");
        //  ★ 「마지막 자동 수집은 …」은 남아야 한다 ★ 언제 걷혔는지는 알아야 한다
        if (!/마지막 자동 수집은/.test(자료)) 운것.push("④수집시각까지지움");
        //  판정은 그대로 — 이 말만 지우고 판정을 건드리면 연휴마다 빨간 글이 선다
        if (!/아직차례아님/.test(자료)) 운것.push("④판정까지지움");
      }
    }
  } catch (e) {
    운것.push("터짐:" + e.message);
  }
  return 운것;
}

console.log("─ 새벽 브리핑 — 주소 단추 · 안내문구 ─\n");
const 운것 = 재보기();
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) pass = 15;
console.log(fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과");

console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const H = 읽기("home"), B = 읽기("brief"), V = 읽기("v2");
const 깨기 = [
  ["주소도 주문검색으로 (옛 모양)", { home: H.replace(/if \(\/\^https\?:\\\/\\\/\/i\.test\(String\(c\.link\)\)\) \{/, "if (false) {") }],
  ["주소를 글자로도 적는다", { home: H.replace("'📄 시트 보기</button>'", "'📄 시트 보기 ' + esc(c.link) + '</button>'") }],
  /*  ★ 깨뜨린 코드가 문법까지 틀리면 「터짐」으로 울어서 가짜 울음이 된다 ★
      처음에 window.open(…) 을 0 으로 바꿨다가 그랬다. 문법은 멀쩡하되
      뜻만 바꾼다 — 그래야 「울타리가 그 뜻을 지키는가」를 잰다. (2026-10-19) */
  ["새 창으로 안 연다 (문법은 멀쩡히)", { home: H.replace("window.open(", "void (") }],
  ["브리핑 글에 주소줄을 되살린다", { brief: B.replace(/\/\*  ★ 2026-10-19 ★ 주소를 글로 적지 않는다\./, '몸.push("자세한 것은 시트에서 보세요 ▶ " + url);\n  /*') }],
  ["★ link 를 아예 안 넘긴다 ★", { brief: B.replace(/link:\s*url,/, "") }],
  ["v2 연휴문구를 되살린다", { v2: V.replace('const 연휴말 = "";', 'const 연휴말 = " 자동 수집은 주말·공휴일에 멈춥니다 — 다음 영업일 09:30 에 걷힙니다.";') }],
  ["v2 가 수집 시각까지 지운다", { v2: V.replace(/const 수집말 = [\s\S]*?: "마지막 수집 시각을 못 읽었습니다\.";/, 'const 수집말 = "";') }],
];

let 안움 = 0;
for (const [이름, 고침] of 깨기) {
  if (!Object.keys(고침).some((k) => 고침[k] !== 읽기(k))) { console.log("  ?? 깨지지도 않았다 — " + 이름); 안움++; continue; }
  const 운 = 재보기(고침);
  if (운.length) console.log("  ✔ 울었다 [" + 운.join(", ") + "] ← " + 이름);
  else { console.log("  ★ 안 울었다 — 울타리가 없다: " + 이름); 안움++; }
}
console.log("\n" + (안움 ? "★ 울타리 없는 자리 " + 안움 + "개" : "✔ " + 깨기.length + "가지 다 문다"));
process.exit(fail || 안움 ? 1 : 0);
