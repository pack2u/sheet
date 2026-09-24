/**
 * 화면이 「롯데」라고 부르지 않는가
 *
 *  > "롯데는 이제 사용을 안해.. 예비로 넣어놨을뿐이야."
 *
 *  2026-09-11 에 자사출고를 로젠으로 바꿨는데 화면은 계속 「롯데」라고 불렀다.
 *  그래서 「원천 · 롯데 0」을 보고도 그게
 *    «자사출고가 0건이다»  인지
 *    «안 쓰는 롯데 탭이 비었다» 인지
 *  가릴 수가 없었다. 실제로 그 줄을 놓고 한참을 헤맸다.
 *  이름이 틀리면 숫자가 일을 못 한다.
 *
 *  ★ 규칙 ★
 *    사람에게 보이는 자리에서 «자사출고»를 「롯데」라고 부르지 않는다.
 *    탭 이름·API 이름처럼 «진짜 롯데»를 가리키는 말은 그대로 둔다.
 *
 * 실행: node _naming_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const 볼것 = {
  "_partnerWebApp.gs": fs.readFileSync("_partnerWebApp.gs", "utf8"),
  "_partnerExclusivePush.gs": fs.readFileSync("_partnerExclusivePush.gs", "utf8"),
  "세트분리V2/gasMain.js": fs.readFileSync("세트분리V2/gasMain.js", "utf8"),
};

console.log("");
console.log("[이름] 자사출고를 「롯데」라 부르지 않는다");
check("★ 마감 알림 — 「롯데 송장:」 없음",
  볼것["_partnerWebApp.gs"].indexOf('" └ 롯데 송장: "') >= 0, false);
check("자사출고 송장이라 부른다",
  볼것["_partnerWebApp.gs"].indexOf('" └ 자사출고 송장: "') >= 0, true);
check("★ Chat 카드 — 「🚚 롯데 송장」 없음",
  볼것["_partnerWebApp.gs"].indexOf('label: "🚚 롯데 송장"') >= 0, false);
check("★ 한 줄 요약 — 「(롯데:」 없음",
  볼것["_partnerWebApp.gs"].indexOf('"건 (롯데:"') >= 0, false);
check("★ 마감표 출처 칸 — 「롯데:」 없음",
  볼것["_partnerExclusivePush.gs"].indexOf('sumRow[srcIdx] = "롯데:"') >= 0, false);

console.log("");
console.log("[전파] 같은 규칙");
check("★ 「· 원천 · 롯데」 없음",
  볼것["세트분리V2/gasMain.js"].indexOf("'  · 원천 · 롯데 '") >= 0, false);
check("자사출고라 부른다",
  볼것["세트분리V2/gasMain.js"].indexOf("'  · 원천 · 자사출고 '") >= 0, true);
check("★ 「· 사방넷송장 · 롯데」 없음",
  볼것["세트분리V2/gasMain.js"].indexOf("'  · 사방넷송장 · 롯데 '") >= 0, false);

console.log("");
console.log("[예비] 롯데 탭이 안 읽혀도 사고가 아니다");
check("★ 예비 표시가 있다",
  볼것["세트분리V2/gasMain.js"].indexOf("예비: true,") >= 0, true);
check("★ 예비 탭 실패는 경고로 안 올린다",
  볼것["세트분리V2/gasMain.js"].indexOf("if (o편.예비) {") >= 0, true);
check("대신 읽은 탭 줄에 적는다",
  볼것["세트분리V2/gasMain.js"].indexOf("'예비 탭이라 건너뜀'") >= 0 ||
  볼것["세트분리V2/gasMain.js"].indexOf("예비 탭이라 건너뜀") >= 0, true);

console.log("");
console.log("[남겨 둘 것] 진짜 롯데를 가리키는 말은 그대로");
check("롯데 탭 이름·GID 는 남는다",
  볼것["세트분리V2/gasMain.js"].indexOf("이름: '롯데'") >= 0, true);
check("롯데 화물추적 API 는 별개다",
  fs.readFileSync("CS_WebApp/csLotte.gs", "utf8").length > 0, true);

console.log("");
console.log(fail ? "실패 " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
