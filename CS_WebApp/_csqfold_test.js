/**
 * ══════════════════════════════════════════════════════════════
 *  After CS — 펴지는 카드는 «하나»  ·  반품 사진에 글 같이 올리기
 *
 *  > "after cs도 카드 클릭하면 하나만 펼쳐지고 나머지는 접혀있게..
 *  >  다른부분들처럼 해줘..그리고 반품카드 사진 올릴때 글도 같이
 *  >  올릴수 있게 해줘"                                   (2026-10-07)
 *
 *  ★ 왜 시험이 있나 ★
 *    ① 「하나만 펴진다」는 «값이 하나인가»로 정해진다. 맵(CSQ_OPEN)으로
 *       돌아가면 여러 장이 다시 펴진다 — 그리고 눈으로만 아는 일이라
 *       되돌아가도 아무것도 울지 않는다. 접힘 손질은 이미 한 번 되돌아갔다.
 *    ② 사진 글은 «적는 자리»가 중요하다. 비고 한 줄에서 주소를 걷어낸
 *       나머지가 사진 카드의 설명이 된다(procPhotoHtml 의 caption).
 *       주소 «뒤»에 붙이면 설명이 둘로 갈려 엉뚱하게 보인다.
 *       줄바꿈이 들어가면 뒷줄이 제 이력 카드가 되어 사진과 갈려 선다.
 *
 *  실행: node CS_WebApp/_csqfold_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
const ATT = fs.readFileSync(path.join(__dirname, "csAttach.gs"), "utf8");
const OS = fs.readFileSync(path.join(__dirname, "csOrderSearch.gs"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ok   " + 이름); return; }
  틀린것++;
  console.log("  FAIL " + 이름 + (덧붙임 ? "\n         " + 덧붙임 : ""));
}
function eq(이름, 얻은, 바란) {
  ok(이름 + "  →  " + JSON.stringify(얻은),
    JSON.stringify(얻은) === JSON.stringify(바란),
    "기대 " + JSON.stringify(바란));
}

/* ══ [1] After CS — 한 장만 펴진다 ══════════════════════════ */
console.log("\n[1] 펴지는 카드가 «하나»인가");

ok("★ 펴진 카드를 값 하나로 담는다 (CSQ_OPEN_ID)",
  /var CSQ_OPEN_ID\s*=\s*''\s*;/.test(HTML));
ok("★ 맵으로 돌아가지 않았다 (CSQ_OPEN[…] 가 없다)",
  !/CSQ_OPEN\[/.test(HTML),
  "맵이면 여러 장이 동시에 펴집니다");
/*  전에는 CSQ_OPEN(펴진 것)과 CSQ_LAST_OPEN(마지막으로 편 것) 둘이
    같은 것을 정하고 있었다. 한 장뿐이면 둘이 늘 같은 값이다.  */
ok("★ 같은 것을 정하는 값이 둘이 아니다 (CSQ_LAST_OPEN 없음)",
  !/var CSQ_LAST_OPEN/.test(HTML));

const 토글 = (HTML.match(/function csqToggle\(el\)\s*\{[\s\S]{0,900}?\n    \}/) || [""])[0];
ok("csqToggle 를 찾았다", 토글.length > 0);
ok("★ 다른 카드를 누르면 그것 «하나»만 펴진다",
  /CSQ_OPEN_ID\s*=\s*\(CSQ_OPEN_ID === id\)\s*\?\s*''\s*:\s*id;/.test(토글),
  "같은 것을 또 누르면 접고, 아니면 덮어쓴다");
ok("  다시 그린다", /renderCsq\(\)/.test(토글));
/*  나머지가 접히면 그만큼 아래가 올라와 «누른 카드»가 화면 밖으로 간다.
    반품 카드(focusReturnCard)와 같은 식으로 붙들어 둔다.  */
ok("★ 누른 카드를 눈에 붙들어 둔다 (scrollIntoView)",
  /scrollIntoView/.test(토글));
ok("  이미 보이는 카드는 안 움직인다 (block:'nearest')",
  /block:\s*'nearest'/.test(토글),
  "'center' 면 볼 때마다 화면이 튄다");

//  펴짐 판정이 그 값 하나만 본다
const 카드 = (HTML.match(/function csqCardHtml\(c\)\s*\{[\s\S]{0,400}?var 열림[^\n]*/) || [""])[0];
ok("★ 펴짐 판정이 그 값 하나를 본다",
  /var 열림 = \(id !== '' && CSQ_OPEN_ID === id\);/.test(카드));

//  붙여넣기 자리도 같은 값을 본다 — 두 길이 갈리면 엉뚱한 데 붙는다
const 붙임 = (HTML.match(/function csqPasteTarget\(\)[\s\S]{0,1400}?\n    \}/) || [""])[0];
ok("★ 사진 붙여넣기 자리도 같은 값을 본다",
  /var id = CSQ_OPEN_ID;/.test(붙임),
  "다른 값을 보면 안 펴진 카드에 사진이 붙습니다");

//  완료로 목록에서 뺄 때 펴진 상태도 같이 거둔다
ok("★ 완료로 뺀 카드가 펴진 채로 남지 않는다",
  /if \(CSQ_OPEN_ID === String\(id\)\) CSQ_OPEN_ID = '';/.test(HTML));

/* ══ [2] 반품 사진에 글 같이 ════════════════════════════════ */
console.log("\n[2] 사진에 글을 같이 올린다");

ok("★ 글 적는 칸이 사진 첨부 판에 있다",
  /id="ret-photo-memo-' \+ idx \+ '"/.test(HTML));
ok("  선택이라고 알려 준다", /사진에 같이 남길 말 \(선택\)/.test(HTML));
ok("  곁다리라 낮게 둔다",
  /\.ret-act-pop textarea\.ret-photo-memo \{[^}]*min-height/.test(HTML));

const 올리기 = (HTML.match(/function submitRetPhotos\(idx\)[\s\S]{0,3200}?\n    \}/) || [""])[0];
ok("submitRetPhotos 를 찾았다", 올리기.length > 0);
ok("★ 적은 글을 집어 보낸다",
  /ret-photo-memo-' \+ idx/.test(올리기) && /memo: memo,/.test(올리기));
ok("★ 올린 뒤 칸을 비운다 (다음 사진에 옛 글이 안 따라붙게)",
  /if \(memoEl\) memoEl\.value = '';/.test(올리기));

/* ── 서버: 어디에 적는가 ───────────────────────────────── */
console.log("\n[2-1] 서버 — 글을 «주소 앞»에 적는다");

const 줄짓기 = (ATT.match(/notice = _cs_appendNoticeLine_\([\s\S]{0,400}?\);/) || [""])[0];
ok("비고 한 줄 짓는 자리를 찾았다", 줄짓기.length > 0);

/*  ★ 자리가 중요하다 ★ 화면은 「줄에서 주소만 걷어낸 나머지」를 설명으로 쓴다.
    주소 뒤에 붙이면 설명이 둘로 갈린다.  */
const 글자리 = 줄짓기.indexOf("memo");
const 주소자리 = 줄짓기.indexOf("urls.join");
ok("★ 글이 주소 «앞»에 온다", 글자리 > 0 && 주소자리 > 0 && 글자리 < 주소자리,
  "글 " + 글자리 + " · 주소 " + 주소자리);

const 다듬기 = (ATT.match(/var memo = String\(payload\.memo[\s\S]{0,420}?;/) || [""])[0];
ok("글을 다듬는 자리를 찾았다", 다듬기.length > 0);
ok("★ 줄바꿈을 빈칸으로 바꾼다 (비고는 한 줄 = 한 이력)",
  /\[\\r\\n\\t\]\+/.test(다듬기),
  "여러 줄이면 뒷줄이 제 이력 카드가 되어 사진과 갈려 섭니다");
ok("★ 「|」를 뺀다 (포털·v2 가 칸 가르는 글자다)",
  /replace\(\/\\\|\/g/.test(다듬기));
ok("  길이를 끊는다", /substring\(0, \d+\)/.test(다듬기));
ok("★ 글이 없으면 여태 모습 그대로", /\(memo \? " · " \+ memo : "\."\)/.test(줄짓기));

/* ── 화면이 그 줄을 사진 카드로 알아보는가 ─────────────── */
console.log("\n[2-2] 그 줄이 여전히 «사진 줄»로 읽힌다");

/*  _cs_isPhotoLine_ 는 머리가 「사진 첨부」이고 주소가 있어야 사진 줄로 본다.
    글을 가운데 끼워도 그 둘은 그대로다 — 그것을 여기서 못 박는다.         */
const 사진줄규칙 = (OS.match(/function _cs_isPhotoLine_\(body\)[\s\S]{0,300}?\n\}/) || [""])[0];
ok("사진 줄 규칙을 찾았다", 사진줄규칙.length > 0);
const re = /\^\(사진\\s\*첨부\|현장입고\)/.test(사진줄규칙);
ok("★ 머리말로 가른다 (글은 뒤에 와도 된다)", re);
ok("  주소가 있어야 사진 줄", /https\?:\\\/\\\//.test(사진줄규칙));

//  실제로 우리가 적을 줄을 그 규칙에 넣어 본다
function 사진줄인가(body) {
  return /^(사진\s*첨부|현장입고)/.test(String(body || "")) &&
         /https?:\/\//.test(String(body || ""));
}
const 글있는줄 = "사진 첨부 2장 · 뚜껑 깨짐 https://a/1 https://a/2";
const 글없는줄 = "사진 첨부 2장. https://a/1 https://a/2";
ok("★ 글 있는 줄도 사진 줄로 읽힌다", 사진줄인가(글있는줄));
ok("  글 없는 줄도 그대로", 사진줄인가(글없는줄));

//  설명(caption) 이 제대로 떨어지는가 — home.html procPhotoHtml 과 같은 식
const caption = (s) => String(s).replace(/https?:\/\/[^\s]+/g, "").trim();
eq("★ 설명에 글이 온전히 남는다",
  caption(글있는줄), "사진 첨부 2장 · 뚜껑 깨짐");
eq("  글이 없으면 여태 그대로", caption(글없는줄), "사진 첨부 2장.");

console.log("");
console.log(틀린것 ? "실패 " + 틀린것 + "건 / 통과 " + (잰것 - 틀린것)
                  : "모두 통과 (" + 잰것 + "건)");
process.exit(틀린것 ? 1 : 0);
