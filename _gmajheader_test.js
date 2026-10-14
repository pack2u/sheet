/**
 * 아주팩 송장 엑셀 — 머리글에서 열을 제대로 집는가
 *
 *  ★ 2026-10-14 실물 ★  첫 예행에서 23건이 전부 미매칭이었다.
 *    매칭 규칙이 아니라 «이름 열을 못 찾은 것»이었다 —
 *      A=택배사 | B=운송장번호 | D=보내시는 분 | E=받으시는 분 |
 *      F=받는분총주소 | G=품목명 | H=수량 | I=특기사항 | J=출고번호
 *    「받는분」만 알았지 「받으시는」을 몰랐다. ★ 전화 열은 아예 없다 ★
 *
 *  ★ 집지 말아야 할 두 자리 ★
 *      D 「보내시는 분」   — 보내는 사람. 이름으로 잡으면 남의 이름이 들어간다.
 *      F 「받는분총주소」 — 「받는분」을 품고 있다. 주소지 이름이 아니다.
 *
 *  _gmaj_test.js 는 아주팩 시트 내보내기 파일이 있어야 돌지만, 머리글
 *  해석은 그것 없이도 볼 수 있다. 그래서 따로 둔다.
 *
 * 실행: node _gmajheader_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");

let pass = 0, fail = 0;
const 봐 = (이름, 참말, 덧) => {
  if (참말) pass++;
  else { fail++; console.log("  ❌ " + 이름 + (덧 === undefined ? "" : "   " + 덧)); }
};

const 소스 = fs.readFileSync(path.join(__dirname, "_partnerGmailInvoiceAJ.gs"), "utf8");

function 틀(글) {
  const ctx = { console, Logger: { log() {} } };
  vm.createContext(ctx);
  vm.runInContext(글 === undefined ? 소스 : 글, ctx);
  return ctx;
}

/*  실물 머리글 그대로. 아래 줄은 오늘 온 엑셀의 한 줄을 본뜬 것.  */
const 실물머리글 = ["택배사", "운송장번호", "", "보내시는 분", "받으시는 분",
  "받는분총주소", "품목명", "수량", "특기사항", "출고번호"];
const 실물줄 = ["로젠", "463510522230", "", "주식회사 팩투유", "홍길동",
  "서울시 어딘가 101동 202호", "AJ도시락/5칸/흑(셋트)", "2", "", "AJ-0001"];

function 재보기(글) {
  const 운것 = [];
  try {
    const ctx = 틀(글);
    const r = ctx._gma_parseInvoiceRows_([실물머리글, 실물줄]);

    if (!/이름=E/.test(r.headerDesc)) 운것.push("①이름=E");
    if (!/송장=B/.test(r.headerDesc)) 운것.push("①송장=B");
    if (!/품목=G/.test(r.headerDesc)) 운것.push("①품목=G");
    if (!/수량=H/.test(r.headerDesc)) 운것.push("①수량=H");
    //  전화 열이 없는 엑셀이다 — 없다고 말해야 한다(엉뚱한 열을 잡으면 안 된다)
    if (!/전화=-/.test(r.headerDesc)) 운것.push("①전화는없다");

    const e = r.entries[0];
    if (!e) { 운것.push("②줄을못읽음"); return 운것; }
    if (e.rawName !== "홍길동") 운것.push("②받는분이름");
    //  ★ 보내는 사람이 들어오면 큰일이다 ★
    if (/팩투유/.test(e.rawName)) 운것.push("②보내는사람이들어옴");
    //  ★ 주소가 이름 자리에 오면 안 된다 ★
    if (/서울|동|호/.test(e.rawName) && e.rawName !== "홍길동") 운것.push("②주소가이름으로");
    if (e.tracking !== "463510522230") 운것.push("②송장번호");
    if (e.rawItem !== "AJ도시락/5칸/흑(셋트)") 운것.push("②품목명");
    if (e.qty !== 2) 운것.push("②수량");
    if (e.phone !== "") 운것.push("②전화는빈값");

    /*  ③ 전에 쓰던 머리글도 그대로 읽혀야 한다 — 넓히다 좁히면 안 된다  */
    const r2 = ctx._gma_parseInvoiceRows_([
      ["보내는분성명", "운송장번호", "받는분성명", "받는분전화번호", "품목명", "박스수량"],
      ["팩투유", "463430548232", "김철수", "010-1111-2222", "탕용기캡", "1"],
    ]);
    const e2 = r2.entries[0];
    if (!e2 || e2.rawName !== "김철수") 운것.push("③옛머리글이름");
    if (!e2 || e2.phone !== "11112222") 운것.push("③옛머리글전화");
    if (!e2 || e2.qty !== 1) 운것.push("③옛머리글수량");

    /*  ④ 「받는분총주소」밖에 없으면 이름 열은 «없다»고 해야 한다 —
           주소를 이름으로 잡느니 못 찾는 편이 낫다  */
    const r3 = ctx._gma_parseInvoiceRows_([
      ["운송장번호", "받는분총주소", "품목명", "수량"],
      ["463510522230", "서울시 어딘가", "컵", "1"],
    ]);
    if (!/이름=-/.test(r3.headerDesc)) 운것.push("④주소를이름으로잡음");

    /*  ⑤ 못 찾은 칸이 있으면 머리글 줄을 보여 준다 — 이것이 없어서
           첫 예행 때 무슨 낱말인지 알 길이 없었다  */
    if (!/머리글 줄:/.test(r3.headerDesc)) 운것.push("⑤머리글을안보여줌");
    if (!/받는분총주소/.test(r3.headerDesc)) 운것.push("⑤본낱말을안적음");

    /*  ⑥ ★ 「보내시는 분 연락처」를 받는분 전화로 잡으면 안 된다 ★
           「보내는」만 거르던 때는 «보내시는»이 안 걸렸다. 이 엑셀에는 전화
           열이 없어 운 좋게 사고가 안 났을 뿐, 전화 칸이 생기는 순간
           보내는 사람 번호가 고객 번호로 들어간다. 그러면 매칭이 통째로
           엉킨다 — 같은 번호가 모든 줄에 붙기 때문이다.  */
    const r4 = ctx._gma_parseInvoiceRows_([
      /*  보내는 쪽에 «먼저 걸리는» 낱말(휴대폰)을 두었다. 받는 쪽은 그보다
          뒤에 걸리는 낱말(연락처)이다. 거르개가 안 들으면 보내는 쪽이 먼저
          잡힌다 — 그 길을 실제로 타게 하려고 이렇게 둔다.  */
      ["운송장번호", "보내시는 분", "보내시는 분 휴대폰", "받으시는 분", "받으시는 분 연락처", "품목명", "수량"],
      ["463510522230", "주식회사 팩투유", "031-923-7795", "홍길동", "010-3333-4444", "컵", "1"],
    ]);
    const e4 = r4.entries[0];
    if (!e4) 운것.push("⑥줄을못읽음");
    else {
      if (e4.rawName !== "홍길동") 운것.push("⑥보내는사람을이름으로");
      //  보내는 쪽 번호(…7795)가 아니라 받는 쪽(…4444) 이어야 한다
      if (e4.phone !== "33334444") 운것.push("⑥보내는사람전화를잡음");
    }
  } catch (err) {
    운것.push("터짐:" + err.message);
  }
  return 운것;
}

console.log("─ 아주팩 송장 머리글 ─\n");
const 운것 = 재보기();
운것.forEach((x) => { fail++; console.log("  ❌ " + x); });
if (!운것.length) pass = 18;
console.log(fail ? "✘ " + fail + "개 틀림" : "✔ 확인 " + pass + "가지 다 통과");

/*  ═══ 일부러 깨 본다 ═══  */
console.log("\n─ 일부러 깨 보기 (우는 게 맞다) ─\n");
const 깨기 = [
  ["「받으시는」을 다시 뺀다", (s) => s.replace('"받으시는분", "받으시는", ', "")],
  /*  ★ 줄이 둘이다 ★ 하나만 되돌리면 나머지가 막아 줘서 «안 운다».
      처음에 그렇게 해 놓고 「울타리가 없다」고 잘못 읽을 뻔했다 (2026-10-14).  */
  ["보내는 사람 거르개를 옛날로 (두 줄 다)", (s) => s
    .replace('if (key !== "phone" && /보내|송하인|발송인/.test(hdr[c2])) continue;',
      'if (key !== "phone" && /보내는|송하인|발송인/.test(hdr[c2])) continue;')
    .replace('if (key === "phone" && /보내|송하인|발송인/.test(hdr[c2])) continue;',
      'if (key === "phone" && /보내는|송하인|발송인/.test(hdr[c2])) continue;')],
  ["주소 거르개를 뺀다", (s) => s.replace(
    'if (key === "name" && /전화|휴대|연락|주소|우편/.test(hdr[c2])) continue;', "")],
  ["머리글 줄을 안 보여 준다", (s) => s.replace(
    /if \(본것\.length\) out\.headerDesc \+= "\\n      머리글 줄: " \+ 본것\.join\(" \| "\);/, "")],
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
