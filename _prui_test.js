/**
 * _partnerPriceRaise.gs — 편집기에서도 돌고, ★안 써야 할 때 안 쓰나★.
 *
 * 왜 이 시험이 생겼나 (2026-10-11)
 *   사장님이 편집기에서 partnerPriceRaiseBuild 를 눌렀는데 539행에서 터졌다:
 *     Exception: Cannot call SpreadsheetApp.getUi() from this context.
 *   메뉴에서 부를 때만 창이 있다. 이 일은 «한 번 눌러서 끝내는» 일이라
 *   편집기에서 돌리는 것이 정상인데, 창에 기대 짜 두었다.
 *
 *   고치면서 더 위험한 길이 생겼다 — 확인 창이 없으면 그냥 진행하게 만들면
 *   편집기에서 ▶ 를 잘못 눌러 341줄이 바뀐다. 그래서 창이 없을 때는
 *   ★안 하고 멈추고★ 편집기용 이름을 알려 준다. 그 약속을 여기서 잰다.
 *
 * 돌리기:  node _prui_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const 소스 = fs.readFileSync(path.join(__dirname, "_partnerPriceRaise.gs"), "utf8");

let 실패 = 0;
function 같나(이름, 받은것, 바란것) {
  if (받은것 === 바란것) { console.log("  ✔ " + 이름); return; }
  console.log("  ✘ " + 이름 + " — 바란 것 「" + 바란것 + "」 받은 것 「" + 받은것 + "」");
  실패++;
}

/* ── ① 창·활성시트에 기대지 않나 ──────────────────────────────── */
console.log("── 편집기에서도 도나 ──");
/*  ★ 머리말에도 그 글자가 나온다 ★ 까닭을 적어 뒀기 때문이다. 처음엔
    「줄 머리가 * 나 / 가 아닌 줄」만 걸러 코드만 본다고 했는데, 블록 주석
    «안쪽» 줄(「     Exception: Cannot call …」)이 남아 울었다 — 코드는
    멀쩡했다. 글자를 세지 말고 ★모든 getUi() 가 try 안에 있나★ 를 잰다.
    그게 지키려는 것이기도 하다.                                        */
const getUi줄 = 소스.split("\n").filter((l) => /SpreadsheetApp\.getUi\(\)/.test(l));
같나("getUi() 가 있는 줄을 찾았다", getUi줄.length >= 2, true);
같나("★ 모든 getUi() 가 try 안에 있다 ★",
  getUi줄.filter((l) => !/^\s*try \{/.test(l) && !/^\s*\*|^\s{4,}Exception/.test(l)).length, 0);
const 코드 = 소스.split("\n").filter((l) => !/^\s*[*/]/.test(l)).join("\n");
같나("코드가 getActiveSpreadsheet 를 날로 안 부른다",
  /var ss = SpreadsheetApp\.getActiveSpreadsheet\(\)/.test(코드), false);
같나("시트를 ID 로 여는 길이 있다", /openById\(_PT\.INFO_SS_ID\)/.test(소스), true);
같나("알림 도우미가 있다", /function _pr_say_\(/.test(소스), true);
같나("알림은 로그에도 남긴다", /function _pr_say_[\s\S]{0,120}Logger\.log/.test(소스), true);

/* ── ② ★ 창이 없을 때 그냥 진행하지 않나 ★ ───────────────────── */
console.log("── ★ 창이 없으면 안 쓰나 ★ ──");
같나("확인 도우미가 있다", /function _pr_ask_\(/.test(소스), true);
const ask = 소스.slice(소스.indexOf("function _pr_ask_("), 소스.indexOf("/** 상품정보시트"));
같나("창이 있으면 YES/NO 로 묻는다", /ButtonSet\.YES_NO/.test(ask), true);
/*  ★ 이것이 이 고침의 핵심 약속이다 ★ 창이 없고 「정말」도 아니면 false 다 */
같나("창이 없고 정말이 아니면 false 를 돌려준다", /return false;/.test(ask), true);
같나("창이 없을 때 쓸 이름을 알려 준다", /편집기이름/.test(ask), true);
같나("확인을 안 받고 나아가는 길이 없다",
  /if \(정말\) \{[\s\S]{0,160}return true;/.test(ask), true);

/* ── ③ 쓰는 함수가 둘 다 확인을 지나나 ───────────────────────── */
console.log("── 쓰는 함수가 확인을 지나나 ──");
/*  ★ 수를 못 박지 않는다 ★ 처음에 「둘이다」로 적어 뒀더니, 비교표 만들기에
    울타리를 하나 더 세우자 셋이 되어 울었다 — 코드는 좋아졌는데 시험이
    막았다. 「로젠택배 API」 방의 `>= 6` 과 같은 함정을 반대로 밟은 것이다.
    수를 세지 말고 ★쓰는 함수가 다 지나는가★ 를 잰다.                   */
같나("쓰는 함수 셋이 다 _pr_ask_ 를 지난다",
  ["_pr_build_", "_pr_applyProduct_", "_pr_mapping_"].every((fn) => {
    const 시작 = 소스.indexOf("function " + fn + "(");
    if (시작 < 0) return false;
    //  다음 function 선언까지를 그 함수 몸으로 본다
    const 다음 = 소스.indexOf("\nfunction ", 시작 + 1);
    const 몸 = 소스.slice(시작, 다음 < 0 ? 소스.length : 다음);
    return /_pr_ask_\(/.test(몸);
  }), true);
같나("적용이 편집기용 이름을 안내한다",
  /partnerPriceRaiseApplyNow/.test(소스), true);
같나("매핑이 편집기용 이름을 안내한다",
  /partnerPriceRaiseApplyMappingNow/.test(소스), true);
/*  편집기용 이름은 «정말» 로 부른다 — 그 이름을 고르는 것이 「예」다 */
같나("ApplyNow 가 정말로 부른다",
  /function partnerPriceRaiseApplyNow\(\) \{ _pr_applyProduct_\(false, true\); \}/.test(소스), true);
같나("ApplyMappingNow 가 정말로 부른다",
  /function partnerPriceRaiseApplyMappingNow\(\) \{ _pr_mapping_\(true\); \}/.test(소스), true);
/*  보통 이름은 «정말» 이 아니다 — 메뉴에서 창으로 묻는다 */
같나("Apply 는 정말이 아니다",
  /function partnerPriceRaiseApply\(\) \{ _pr_applyProduct_\(false, false\); \}/.test(소스), true);
같나("ApplyMapping 은 정말이 아니다",
  /function partnerPriceRaiseApplyMapping\(\) \{ _pr_mapping_\(false\); \}/.test(소스), true);

/* ── ④ 미리보기는 아무것도 안 쓰나 ───────────────────────────── */
console.log("── 미리보기가 안 쓰나 ──");
같나("Preview 는 미리=true 로 부른다",
  /function partnerPriceRaisePreview\(\) \{ _pr_applyProduct_\(true\); \}/.test(소스), true);
/*  ★ 이력을 «먼저» 남기나 ★  (2026-10-11)
    주석은 「바꾸기 전」이라고 적어 두고 코드는 다 바꾼 뒤에 적고 있었다.
    341줄을 한 칸씩 쓰다 한도에 걸려 죽으면 바뀐 줄의 옛 값이 아무 데도
    안 남는다 — 되돌릴 길이 사라진다.
    처음엔 /_PR_LOG_TAB_/ 로 쟀는데 그 이름을 _PR_LOG_TAB_XX 로 바꿔도
    통과했다(앞뒤가 겹친다). ★자리로 잰다★ — 이력 쓰기가 단가 쓰기보다 앞인가. */
const 적용 = 소스.slice(소스.indexOf("function _pr_applyProduct_("),
                       소스.indexOf("function _pr_writeLog_("));
const 이력쓰기 = 적용.indexOf("_pr_writeLog_(이력)");
const 단가쓰기 = 적용.indexOf("_PR_P_NET_).setValue");
같나("이력 쓰기와 단가 쓰기를 둘 다 찾았다", 이력쓰기 >= 0 && 단가쓰기 >= 0, true);
같나("★ 이력을 단가보다 «먼저» 쓴다 ★", 이력쓰기 < 단가쓰기, true);
같나("이력을 쓴 뒤 flush 한다 — 죽어도 남게",
  /_pr_writeLog_\(이력\);\s*\r?\n\s*SpreadsheetApp\.flush\(\);/.test(적용), true);


/* ══════════════════════════════════════════════════════════════
   비교표 만들기도 미리 볼 수 있나  (2026-10-11 · 「일단 확인하고 돌려야지」)

   Build 는 상품정보시트에 341줄을 «쓴다». 그리고 탭이 이미 있으면
   tab.clear() 로 지우고 다시 만든다 — ★체크해 둔 것이 다 날아간다★.
   200줄을 체크해 둔 뒤 누가 다시 돌리면 그 수고가 사라진다.
   ══════════════════════════════════════════════════════════════ */
console.log("── 비교표 만들기를 미리 볼 수 있나 ──");
같나("미리보기 함수가 있다", /function partnerPriceRaiseBuildPreview\(\) \{ _pr_build_\(true\); \}/.test(소스), true);
/*  ★ 「있나」가 아니라 「몇 번인가」로 잰다 ★ 깨서 보니 Build 를 정말로
    바꿔도 BuildNow 줄이 남아 있어 두 재기가 다 통과했다.
    정말=false 로 부르는 자리와 true 로 부르는 자리가 ★각각 하나★ 여야 한다. */
같나("_pr_build_(false, false) 를 부르는 자리가 하나다",
  (소스.match(/_pr_build_\(false, false\)/g) || []).length, 1);
같나("_pr_build_(false, true) 를 부르는 자리가 하나다",
  (소스.match(/_pr_build_\(false, true\)/g) || []).length, 1);
같나("그 하나가 Build 다", /function partnerPriceRaiseBuild\(\) \{ _pr_build_\(false, false\); \}/.test(소스), true);
같나("그 하나가 BuildNow 다", /function partnerPriceRaiseBuildNow\(\) \{ _pr_build_\(false, true\); \}/.test(소스), true);

const 빌드 = 소스.slice(소스.indexOf("function _pr_build_("), 소스.indexOf("function _pr_readChecked_("));
/*  ★ 미리보기가 쓰기 «앞»에서 돌아가야 한다 ★ 뒤에 있으면 이미 다 쓴 뒤다 */
const 미리자리 = 빌드.indexOf("if (미리) {");
/*  ★ "tab.clear()" 로 찾으면 안 된다 ★ 그 글자가 설명 주석에 두 번 먼저
    나와서(596·687행) 엉뚱한 자리를 짚는다. 실제로 지우는 ★그 한 줄★ 을
    통째로 찾는다. 오늘 네 번째로 머리말을 잰 꼴이다.                   */
const 쓰기자리 = 빌드.indexOf("if (tab) tab.clear(); else tab = ss.insertSheet(");
같나("미리보기와 쓰기를 둘 다 찾았다", 미리자리 >= 0 && 쓰기자리 >= 0, true);
같나("★ 미리보기가 쓰기 앞에서 돌아간다 ★", 미리자리 < 쓰기자리, true);
/*  ★ 「미리 다음에 return 이 있나」로 재면 안 된다 ★ 뒤쪽 아무 return 에나
    걸린다. 깨서 보니 return 을 지워도 안 울었다.
    ★미리보기 자리와 쓰기 자리 «사이»에 return 이 있나★ 로 잰다 —
    그게 「미리보기는 안 쓴다」는 뜻이다.                               */
const 사이 = 빌드.slice(미리자리, 쓰기자리);
같나("미리보기와 쓰기 사이에 return 이 있다", /\breturn;/.test(사이), true);

/*  ★ 체크를 말없이 지우지 않나 ★ */
같나("체크 수를 센다", /체크수\+\+/.test(빌드), true);
같나("체크가 있으면 _pr_ask_ 로 묻는다",
  /if \(체크수 && !_pr_ask_\(/.test(빌드), true);
같나("묻는 것이 clear 앞이다",
  빌드.indexOf("체크수 && !_pr_ask_") < 쓰기자리, true);
같나("편집기에서 쓸 이름을 안내한다", /partnerPriceRaiseBuildNow'\)\) return;|partnerPriceRaiseBuildNow"\)\) return;/.test(빌드), true);

/* ══════════════════════════════════════════════════════════════
   _PR_C 에 «없는 키»를 집지 않나  (2026-10-11)

   미리보기가 「종전  →  」 로 빈칸을 찍었다. 머리글은 「종전단가·인상단가·
   매칭근거」인데 _PR_C 의 키는 「종전·인상·근거」다. 없는 키를 집으면
   undefined - 1 = NaN 이고 q[NaN] 은 undefined — ★오류 없이 빈칸★ 이다.
   머리글 이름과 키 이름이 다르다는 것을 잊으면 또 그런다.
   ══════════════════════════════════════════════════════════════ */
console.log("── _PR_C 에 있는 키만 집나 ──");
const PRC = (() => {
  const i = 소스.indexOf("var _PR_C = {");
  const j = 소스.indexOf("};", i);
  const 몸 = 소스.slice(i + "var _PR_C = {".length, j);
  const 키 = [];
  for (const m of 몸.matchAll(/([가-힣A-Za-z_][가-힣A-Za-z0-9_]*)s*:/g)) 키.push(m[1]);
  return 키;
})();
같나("_PR_C 키를 읽었다 (" + PRC.length + "개)", PRC.length >= 15, true);
/*  ★ 점을 꼭 escape 한다 ★ /_PR_C.(…)/ 는 점이 「아무 글자」라서 주석의
    「_PR_C 의 키는」까지 잡아 ★없는 키 「의」★ 를 찾아냈다고 울었다.
    코드는 멀쩡했다. 이 줄을 고치는 스크립트에서 백슬래시가 먹혔다 —
    escape 가 든 글은 Edit 로 고친다.                                   */
const 쓴키 = [...new Set([...소스.matchAll(/_PR_C\.([가-힣A-Za-z_][가-힣A-Za-z0-9_]*)/g)].map((m) => m[1]))];
같나("쓴 키를 읽었다 (" + 쓴키.length + "개)", 쓴키.length > 0, true);
const 없는키 = 쓴키.filter((k) => PRC.indexOf(k) < 0);
같나("★ _PR_C 에 없는 키를 집는 자리가 없다 ★", 없는키.join(",") , "");
/* ══════════════════════════════════════════════════════════════
   색 · 못 찾은 목록 · 손으로 넣은 코드  (2026-10-11)

   > 「적용된것들은 셀칼라가 노란색으로」
   > 「못찾은 목록도 보이게 … 못찾은것들중에 단가 인상된게 있나?」
   > 「미확인을 내가 찾아서 적용시키고 싶으면 … 이카운트코드를 넣어주면 적용되게」

   실측: 단가표 180줄 중 못 찾음 38 — 그중 ★17개가 단가가 올랐다★.
   그대로 두면 우리가 옛 단가로 산다. 그래서 눈에 띄게 하고, 손으로 코드를
   넣으면 적용되게 했다.
   ══════════════════════════════════════════════════════════════ */
console.log("── 색 ──");
같나("적용 색이 브랜드 노랑이다", /_PR_DONE_BG_ = "#FDB813"/.test(소스), true);
같나("못 찾은 줄 색이 따로 있다", /_PR_MISS_BG_ = "#[0-9A-Fa-f]{6}"/.test(소스), true);
같나("두 색이 다르다",
  (소스.match(/_PR_DONE_BG_ = "(#[0-9A-Fa-f]{6})"/) || [])[1] !==
  (소스.match(/_PR_MISS_BG_ = "(#[0-9A-Fa-f]{6})"/) || [])[1], true);
/*  ★ 한 줄씩 칠하면 357번이다 ★ getRangeList 로 한 번에 칠한다 */
같나("줄 여럿을 한 번에 칠한다", /getRangeList\(자리\)\.setBackground/.test(소스), true);
같나("적용 뒤 노랑으로 칠한다", /_pr_paint_\(got\.tab, 칠할줄, _PR_DONE_BG_\)/.test(소스), true);
같나("못 찾은 줄을 칠한다", /_pr_paint_\(tab, 못찾은줄, _PR_MISS_BG_\)/.test(소스), true);

console.log("── 못 찾은 목록을 보여 주나 ──");
같나("못 찾은 줄도 표에 넣는다", /못찾은줄\.push/.test(소스), true);
/*  ★ 오른 것만 따로 모은다 ★ 동결은 못 붙어도 손해가 없다 */
같나("단가가 오른 것만 따로 모은다", /if \(차 !== ""[\s\S]{0,40}못찾고오름\.push/.test(소스), true);
같나("보고에 그 목록을 적는다", /못찾고오름\.slice\(0, 20\)/.test(소스), true);
같나("옛 단가로 산다는 것을 말한다", /옛 단가로 사게/.test(소스), true);

console.log("── 손으로 넣은 코드로 적용되나 ──");
/*  ★ 이것이 안 되면 코드를 넣어도 「적용후 단가가 비어 있습니다」로 걸린다 ★ */
같나("적용후가 비면 인상단가로 셈한다",
  /적용후 === ""[\s\S]{0,200}적용후 = Number\(인상칸\)/.test(소스), true);
같나("손으로 넣은 것을 표시해 들고 간다", /손으로: 손으로/.test(소스), true);
같나("적용후 칸에 되적는다", /if \(b\.손으로\) got\.tab\.getRange\(b\.행, _PR_C\.적용후\)/.test(소스), true);
같나("적용결과에 「손으로 넣은 코드」라고 적는다", /손으로 넣은 코드/.test(소스), true);
/*  ★ 세트·소분은 막는다 ★ 세트는 몸통+뚜껑 합, 소분은 따로 센다 —
    인상단가를 그대로 쓰면 틀린 값이 들어간다. 모르면 쓰지 않는다. */
같나("세트·소분은 손으로도 막는다",
  /손으로 && \(byCode\[code\]\.kind === "세트" \|\| byCode\[code\]\.kind === "소분"\)/.test(소스), true);
/*  ★ 끝맺음은 파일 «맨 끝»에 둔다 ★  (2026-10-11)
    시험을 더하면서 이 두 줄 «뒤»에 붙였더니 그 뒤가 아예 안 돌았다.
    Build 울타리 열 줄이 한 번도 실행되지 않았는데 「다 맞았습니다」가
    찍혔다 — 깨뜨려 봤는데도 안 울어서 알았다.
    ★돌지 않는 시험은 통과가 아니다★                                 */
console.log(실패 ? "\n✘ " + 실패 + "개 틀렸습니다" : "\n✔ 다 맞았습니다");
process.exit(실패 ? 1 : 0);
