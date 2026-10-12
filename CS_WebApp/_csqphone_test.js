/**
 * 「CS 문의로 남기기」가 ★전화번호도★ 들고 가나.
 *
 * > "CS웹앱에서 주문송장조회에서 CS문의로 보내기 할때 전화번호도 같이 따라가게해줘"
 *   (2026-10-12)
 *
 * CS 문의에는 전화 칸이 따로 없다. 거래처·품목·관련번호는 칸이 있고, 수취인·
 * 송장·날짜는 본문 머리에 적는다 — 전화도 거기에 적는다.
 *
 * ★ 왜 시험을 두나 ★ 전화는 «나중에» 쓰는 값이다. 문의를 적을 때는 화면에
 * 번호가 보이니 아쉽지 않지만, 며칠 뒤 그 문의를 열면 번호가 없어 주문조회로
 * 되돌아가야 한다. 그 아쉬움은 늦게 와서, 빠져도 한참 모른다.
 *
 * 돌리기:  node _csqphone_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");

let 실패 = 0;
function 같나(이름, 받은것, 바란것) {
  if (받은것 === 바란것) { console.log("  ✔ " + 이름); return; }
  console.log("  ✘ " + 이름 + " — 바란 것 「" + 바란것 + "」 받은 것 「" + 받은것 + "」");
  실패++;
}

/*  함수 몸통만 떼어 본다 — 같은 글자가 다른 데도 있다(바이토·반품 등).  */
const i = html.indexOf("function csqFromOrder(");
같나("csqFromOrder 를 찾았다", i >= 0, true);
const 몸 = html.slice(i, html.indexOf("\n    }", i));
같나("몸통을 떼었다", 몸.length > 300, true);

console.log("── 본문 머리에 무엇이 들어가나 ──");
같나("수취인을 적는다", /보탬\.push\('수취인 ' \+ r\.name\)/.test(몸), true);
같나("★ 전화를 적는다 ★", /보탬\.push\('전화 ' \+ r\.phone\)/.test(몸), true);
같나("송장을 적는다", /보탬\.push\('송장 ' \+ r\.invoice\)/.test(몸), true);
/*  ★ 번호가 없는 건도 있다 ★ 없으면 그 칸을 통째로 빼야지, 「전화 undefined」가
    적히면 안 된다. 다른 줄과 똑같이 if 로 감싼다.                        */
같나("전화가 없으면 안 적는다", /if \(r\.phone\) 보탬\.push/.test(몸), true);
/*  차례 — 수취인 다음이 자연스럽다(사람 → 연락처 → 물건) */
같나("수취인 다음에 전화가 온다",
  몸.indexOf("'수취인 '") < 몸.indexOf("'전화 '") &&
  몸.indexOf("'전화 '") < 몸.indexOf("'송장 '"), true);

console.log("── 어떤 번호인가 ──");
/*  r.phone 은 _cs_phoneDisplay_ 가 만든 ★온전한★ 번호다(010-1234-5678).
    가려진 번호(phoneMasked 같은 것)를 넣으면 전화를 못 건다.             */
같나("★ 가린 번호를 넣지 않는다 ★", /보탬\.push\('전화 ' \+ r\.phoneMask/.test(몸), false);
같나("숫자만(phoneDigits)이 아니라 보기 좋은 번호다",
  /보탬\.push\('전화 ' \+ r\.phoneDigits\)/.test(몸), false);

console.log("── 이미 쓰던 글은 안 덮는다 ──");
/*  글쓰기 칸에 쓰던 것이 있으면 덮지 않는다 — 넣기() 가 그 약속을 쥐고 있다 */
같나("넣기 는 빈 칸에만 쓴다",
  /if \(e && !String\(e\.value \|\| ''\)\.trim\(\)\) e\.value/.test(몸), true);
같나("본문도 넣기 로 넣는다", /넣기\('csqnBody'/.test(몸), true);

console.log(실패 ? "\n✘ " + 실패 + "개 틀렸습니다" : "\n✔ 다 맞았습니다");
process.exit(실패 ? 1 : 0);
