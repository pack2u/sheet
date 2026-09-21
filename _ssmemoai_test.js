/**
 * 적요확인 — AI 는 «제안»만 하고, 사람이 고른 조치만 먹는다
 *
 *  > "ai가 첨부되면 속도면에서는 마이너스인가?"   "그곳에서 조치도 가능한가?"
 *
 *  ★ 여기서 지키는 것 ★
 *    ① AI 가 읽은 값이 «저절로» 들어오는 길이 없다. 조치가 유일한 문이다.
 *       AI 는 같은 글에 어제와 다른 답을 낼 수 있어서, 덮어쓰게 두면 주소가
 *       회차마다 흔들린다. 아침에 나간 송장과 어긋나는 것이 그렇게 생긴다.
 *    ② 조치는 고유ID 에 매인다. 씨앗은 «원주소»로 만들므로 여기서 주소를
 *       바꿔도 ID 가 안 바뀐다 — 그래서 다음 회차까지 살아남는다.
 *    ③ 세트분리가 «끝난 뒤» 5초 뒤에 따로 깨어난다. 체감 0초.
 *
 * 실행: node _ssmemoai_test.js
 */
const fs = require("fs"), path = require("path");
const core = require(path.join(__dirname, "세트분리V2", "core.js"));

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const 머리 = ["순번", "일자-No.", "품목코드", "품목명", "수량", "거래처명", "주소1",
  "전화", "모바일", "적요", "합계", "주문자명(주문서)", "주문자명(사방넷)",
  "배송지(주문서)/배송메시지(주문서)", "추가문자형7"];
const 줄 = (순번, 적요) => [String(순번), "20260922-100", "A100", "밀폐용기 500ml", "2",
  "보돌미역", "경기도 파주시 소라지로 138-53", "", "01000000000", 적요,
  "10000", "", "", "", ""];

function 돌려(적요, 조치) {
  const 기억 = { 표: {}, 다음: {} };
  const cfg = Object.assign({}, core.SS_DEFAULT_CONFIG, { _전화ID기억: 기억 });
  //  한 번 돌려 고유ID 를 얻는다 (조치는 그 ID 에 매인다)
  const 첫 = core.ssNormalize([머리, 줄(1, 적요)], cfg, [])[0];
  if (!조치) return { line: 첫, uid: 첫.고유ID, warnings: [] };

  const 기억2 = { 표: JSON.parse(JSON.stringify(기억.표)), 다음: Object.assign({}, 기억.다음) };
  const w = [];
  const cfg2 = Object.assign({}, core.SS_DEFAULT_CONFIG, {
    _전화ID기억: 기억2,
    _적요조치: { [첫.고유ID]: 조치 },
  });
  const 둘 = core.ssNormalize([머리, 줄(1, 적요)], cfg2, w)[0];
  return { line: 둘, uid: 둘.고유ID, 첫: 첫, warnings: w };
}

/*  규칙이 «못 읽는» 적요 — AI 가 물어볼 대상이다. 실제 적요다. */
const 안읽히는적요 = "경남 사천시 사남면 조동길 14 진지한국밥";

console.log("\n① 조치가 없으면 아무것도 안 바뀐다");
{
  const r = 돌려(안읽히는적요, null);
  ok("규칙이 이 적요를 못 읽는다 (그래서 AI 대상이다)",
    core.ssParseAddrOverride(안읽히는적요) === null);
  ok("주소가 본사 그대로", r.line.주소1 === "경기도 파주시 소라지로 138-53", r.line.주소1);
  ok("주소변경 표식이 없다", !r.line.주소변경, r.line.주소변경);
}

console.log("\n② 「이대로 적용」을 고르면 그때 바뀐다");
{
  const r = 돌려(안읽히는적요, {
    조치: "이대로 적용",
    이름: "진지한국밥", 전화: "", 휴대: "010-1234-5678",
    주소: "경남 사천시 사남면 조동길 14",
  });
  ok("주소가 바뀐다", r.line.주소1 === "경남 사천시 사남면 조동길 14", r.line.주소1);
  ok("휴대가 바뀐다", r.line.모바일 === "010-1234-5678", r.line.모바일);
  ok("받는분이 바뀐다", r.line.받는분 === "진지한국밥", r.line.받는분);
  ok("★ 원래 값을 남긴다", r.line.원주소1 === "경기도 파주시 소라지로 138-53", r.line.원주소1);
  ok("  원연락처도", r.line.원연락처 === "01000000000", r.line.원연락처);
  ok("경고에 올린다", r.warnings.some((w) => (w.code || w[1]) === "MEMO_ACTION"),
    JSON.stringify(r.warnings).slice(0, 120));
  ok("★ 고유ID 가 안 바뀐다 (조치가 다음 회차까지 산다)", r.uid === r.첫.고유ID,
    r.첫.고유ID + " → " + r.uid);
}

console.log("\n③ 「미발송」을 고르면 안 나간다");
{
  const r = 돌려(안읽히는적요, { 조치: "미발송" });
  ok("표식이 붙는다", r.line.적요조치 === "미발송", r.line.적요조치);
  const why = core.ssNonShipReason(
    { 적요조치: "미발송", 합계: 10000, 품목명: "밀폐용기 500ml", 원본코드: "A100" },
    core.SS_DEFAULT_CONFIG);
  ok("비배송으로 간다", !!why, why);
  ok("  까닭을 말한다", /적요확인/.test(why), why);
  ok("주소는 안 건드린다", r.line.주소1 === "경기도 파주시 소라지로 138-53", r.line.주소1);
}

console.log("\n④ 「아님」을 고르면 아무 일도 없다");
{
  const r = 돌려(안읽히는적요, { 조치: "아님", 주소: "엉뚱한 주소 123" });
  ok("주소가 그대로", r.line.주소1 === "경기도 파주시 소라지로 138-53", r.line.주소1);
  ok("미발송도 아니다", !r.line.적요조치, r.line.적요조치);
}

console.log("\n⑤ 조치에 주소가 없으면 안 바꾼다 (AI 가 빈 값을 줬을 때)");
{
  const r = 돌려(안읽히는적요, { 조치: "이대로 적용", 이름: "진지한국밥", 주소: "" });
  ok("주소가 그대로", r.line.주소1 === "경기도 파주시 소라지로 138-53", r.line.주소1);
  ok("이름도 안 건드린다", r.line.받는분 === "보돌미역", r.line.받는분);
}

console.log("\n⑥ 배선 — 소스에서 직접 확인");
{
  const 밑 = path.join(__dirname, "세트분리V2");
  const ai = fs.readFileSync(path.join(밑, "gasAi.js"), "utf8");
  const main = fs.readFileSync(path.join(밑, "gasMain.js"), "utf8");
  const io = fs.readFileSync(path.join(밑, "gasIO.js"), "utf8");

  ok("탭 이름이 등록돼 있다", /적요확인: '적요확인'/.test(io));
  ok("★ 실행이 «끝난 뒤» 예약한다 (본 실행을 안 늦춘다)",
    /ScriptApp\.newTrigger\(SS_AI_FN_\)[\s\S]{0,60}\.after\(5 \* 1000\)/.test(ai));
  ok("1회용 트리거를 치운다", /_ss_ai_트리거정리_/.test(ai));
  ok("끄는 길이 있다 (MEMO_AI = off)", /MEMO_AI/.test(ai));
  ok("키를 함수 «안»에서 읽는다 (파일 차례 함정)",
    /function _ss_ai_key_\(\)[\s\S]{0,200}GEMINI_API_KEY/.test(ai));
  ok("★ 규칙이 읽은 것은 안 묻는다", /if \(ssParseAddrOverride\(memo\)\) continue;/.test(ai));
  ok("★ 이미 올라간 줄은 안 덮는다 (조치가 날아가면 안 된다)",
    /_ss_ai_탭에있는ID_/.test(ai) && /이미\[uid\]/.test(ai));
  ok("한 통에 묶어 한 번만 부른다",
    (ai.match(/UrlFetchApp\.fetch/g) || []).length === 1);
  ok("조치 고르개를 단다", /requireValueInList\(SS_AI_ACTIONS/.test(ai));

  //  ★ 조치를 «회차 확정보다 먼저» 걷어야 한다 — 지문도 ssNormalize 를 돌린다
  const 걷는자리 = main.indexOf("cfg._적요조치 = ssm_captureMemoActions()");
  const 첫엔진 = main.search(/\b(ssRun|ssNormalize)\s*\(/);
  ok("★ 조치를 엔진보다 먼저 걷는다", 걷는자리 > 0 && 걷는자리 < 첫엔진,
    "걷기 " + 걷는자리 + " · 엔진 " + 첫엔진);
  ok("끝난 뒤 AI 를 예약한다", /var ai예약 = ss_적요AI_예약_\(runKey\);/.test(main));

  /*  ★ .claspignore 는 «화이트리스트»다 ★  (2026-09-22 에 여기서 걸렸다)
      새 파일을 거기 안 적으면 clasp push 가 조용히 빼고 올린다. 시트에는 그
      함수가 없으니 「함수를 찾을 수 없습니다」로 죽는데, 코드는 멀쩡해 보인다. */
  const ignore = fs.readFileSync(path.join(밑, ".claspignore"), "utf8");
  const 안올라가는것 = fs.readdirSync(밑)
    .filter((n) => /\.(js|gs)$/.test(n))
    .filter((n) => ignore.indexOf("!" + n) < 0);
  ok("★ 폴더의 모든 .js/.gs 가 올릴 목록에 있다",
    안올라가는것.length === 0, 안올라가는것.join(" · "));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
