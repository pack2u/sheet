/**
 * home.html 배송조회 분기 검증.
 *
 * ★ 지켜야 할 불변식 ★
 *   「상태」 버튼(롯데 화물추적 API)은 **trackingUrl 이 롯데로 보내는 건에만** 붙어야 한다.
 *   둘이 어긋나면 CJ·로젠 송장에 롯데 조회 버튼이 붙어 CS 가 헛조회를 하게 되고,
 *   반대로 어긋나면 롯데 건인데 버튼이 안 붙는다.
 *   isLotteTrack 은 trackingUrl 의 분기를 손으로 베낀 것이라 한쪽만 고치면 깨진다.
 *   그 어긋남을 여기서 잡는다.
 *
 * 실행: node _home_track_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");
const html = fs.readFileSync("home.html", "utf8");

// home.html 의 <script> 에서 필요한 함수만 떼어 온다.
const NEED = [
  "isProxySource", "carrierTrackBuilder", "trackingUrl", "isLotteTrack",
  "lotteTrackUrl", "logenTrackUrl", "cjTrackUrl", "hanjinTrackUrl",
  "epostTrackUrl", "daesinTrackUrl", "kdexpTrackUrl", "naverTrackUrl"
];

const src = [];
for (const name of NEED) {
  const start = html.indexOf("\n    function " + name + "(");
  if (start < 0) { console.log("NG  home.html 에서 " + name + " 를 찾지 못했습니다."); process.exit(1); }
  // 4칸 들여쓰기 기준으로 함수 끝("\n    }")까지 자른다
  const end = html.indexOf("\n    }", start);
  src.push(html.slice(start, end + 6));
}
eval(src.join("\n"));

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  cond ? pass++ : fail++;
  console.log((cond ? "  OK " : "  NG ") + label + (extra ? "  → " + extra : ""));
}

const INV = "258131494106";

// 실제로 들어오는 조합 — 택배사 열(SSOT)과 출처 문자열
const CASES = [
  // [carrier, source, 설명]
  ["롯데택배", "", "택배사=롯데"],
  ["롯데", "허브", "택배사=롯데 + 대리출처"],
  ["CJ대한통운", "", "택배사=CJ"],
  ["로젠택배", "", "택배사=로젠"],
  ["한진택배", "", "택배사=한진"],
  ["우체국택배", "", "택배사=우체국"],
  ["대신택배", "", "택배사=대신"],
  ["경동택배", "", "택배사=경동"],
  ["", "롯데", "택배사 없음 + 출처 롯데"],
  ["", "CJ", "택배사 없음 + 출처 CJ"],
  ["", "대한통운", "택배사 없음 + 출처 대한통운"],
  ["", "로젠", "택배사 없음 + 출처 로젠"],
  ["", "한진", "택배사 없음 + 출처 한진"],
  ["", "대리판매", "택배사 없음 + 대리출처"],
  ["", "허브", "택배사 없음 + 허브"],
  ["", "기타", "택배사 없음 + 기타"],
  ["", "미매칭", "택배사 없음 + 미매칭"],
  ["", "", "둘 다 없음 (기본값)"],
  ["", "자사몰", "택배사 없음 + 알 수 없는 출처"]
];

console.log("\n[1] 「상태」 버튼은 trackingUrl 이 롯데로 보내는 건에만 붙어야 한다");
CASES.forEach(function (c) {
  const carrier = c[0], source = c[1], why = c[2];
  const goesLotte = trackingUrl(INV, source, carrier) === lotteTrackUrl(INV);
  const shows = isLotteTrack(source, carrier);
  ok(why.padEnd(28) + " 링크=" + (goesLotte ? "롯데" : "타사") +
     " 버튼=" + (shows ? "붙음" : "없음"),
     goesLotte === shows);
});

console.log("\n[2] 택배사 표기 변형");
[["롯데 택배", true], ["롯데글로벌로지스", true], ["(주)롯데택배", true],
 ["CJ", false], ["롯데슈퍼", true]].forEach(function (p) {
  ok("택배사 '" + p[0] + "' → " + (p[1] ? "롯데" : "타사"),
     isLotteTrack("", p[0]) === p[1]);
});

console.log("\n[3] 버튼 마크업이 실제로 렌더 코드에 들어갔는가");
ok("invoiceHtml 에 상태 버튼 분기 존재",
   /isLotteTrack\(source, carrier\)[\s\S]{0,200}os-trk/.test(html));
ok("onclick 이 lotteTrack 을 부른다", html.indexOf('onclick="lotteTrack(this)"') > -1);
ok("서버 함수 csLotteTrack 을 호출한다", html.indexOf(".csLotteTrack(inv") > -1);
ok("배지 CSS 정의됨", html.indexOf(".os-trk-done") > -1 && html.indexOf(".os-trk-run") > -1);

console.log("\n[4] 배송상태 판 — 툴팁이 아니라 남는 판이어야 한다 (2026-09-08)");
/* 전에는 btn.title 에 이력을 붙였다. 마우스만 움직여도 사라지고 글자를 고를 수 없어
   고객에게 붙여넣을 수가 없었다. 다시 그렇게 돌아가지 않게 못을 박는다. */
/* 테마 단추(3197줄)도 btn.title 을 쓴다. 그건 상관없다 —
   보는 곳을 lotteTrack 함수 안으로 좁힌다. */
const trackFn = (html.match(/function lotteTrack\(btn\)[\s\S]{0,2500}?\n    \}/) || [""])[0];
ok("lotteTrack 을 찾았다 (아래 검사의 전제)", trackFn.length > 200);
ok("이력을 title 툴팁으로 붙이지 않는다", !/\.title\s*=/.test(trackFn));
ok("판을 만드는 함수가 있다", html.indexOf("function _trkPanel_") > -1);
ok("판을 그리는 함수가 있다", html.indexOf("function _trkRender_") > -1);
ok("판을 접는 함수가 있다", html.indexOf("function _trkClose_") > -1);
ok("판 CSS 가 있다", html.indexOf(".os-trk-panel") > -1);
ok("판 안의 글자를 고를 수 있다 (user-select: text)",
   /\.os-trk-panel[\s\S]{0,400}user-select:\s*text/.test(html));
ok("두 번 누르면 서버를 다시 안 부르고 접었다 편다",
   /_trkPanel_\(btn, false\)[\s\S]{0,300}style\.display/.test(html));

console.log("\n[5] ★ 전체 복사는 줄바꿈이 살아 있어야 한다 ★");
/* js() 가 줄바꿈을 공백으로 바꾼다. onclick 안에 원문을 넣으면 이력이 한 줄로
   뭉쳐 붙여넣기가 쓸모없어진다. 숨긴 칸에 담고 거기서 읽어야 한다. */
ok("원문을 onclick 에 안 넣는다", html.indexOf("js(text)") === -1);
ok("숨긴 칸에 원문을 담는다", html.indexOf("os-trk-raw") > -1);
ok("복사는 그 칸에서 읽는다",
   /function _trkCopy_[\s\S]{0,300}os-trk-raw[\s\S]{0,160}copyText/.test(html));

console.log("\n[6] 담당기사 (2026-09-08 요청)");
const lotte = fs.readFileSync(__dirname + "/csLotte.gs", "utf8");
ok("응답의 empNm 을 버리지 않는다", /empNm:\s*String\(t\.empNm/.test(lotte));
ok("응답의 empTel 을 버리지 않는다", /empTel:\s*String\(t\.empTel/.test(lotte));
ok("가장 최근에 이름이 찍힌 이벤트에서 고른다",
   /for \(var e = hist\.length - 1; e >= 0; e--\)/.test(lotte));
ok("결과에 empNm·empTel 을 담는다",
   /empNm: emp \? emp\.empNm/.test(lotte) && /empTel: emp \? emp\.empTel/.test(lotte));
ok("화면이 담당기사를 그린다", html.indexOf("os-trk-emp") > -1);
ok("기사 번호로 바로 걸 수 있다", /os-trk-emp[\s\S]{0,500}href="tel:/.test(html));

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
