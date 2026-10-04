/**
 * 보류(미발송) 탭 「메모」 칸에 주소를 적으면 그 주소로 보낸다
 *
 *  > "미발송으로 빠져서 확인을 하고 주소라고 적으면 주소로 적용되면 좋겠어.."
 *
 *  ★ 왜 「조치」 칸이 아닌가 ★
 *    조치 칸은 이미 꽉 찼다 — 아무 글자나 적으면 「미등록 업체코드 → 대리발송」이
 *    되어 엉뚱한 업체로 간다 (gasMasters.js 의 조치 갈래).
 *    메모 칸은 지금 아무 뜻도 없는 자유 칸이라 부딪히는 것이 없다.
 *
 *  ★ 문법은 하나다 ★
 *    적요를 읽는 ssParseAddrOverride 를 그대로 쓴다. 「배송지 …」 도, 주소만도 먹는다.
 *
 * 실행: node _ssholdaddr_test.js
 */
const fs = require("fs"), path = require("path");
const core = require(path.join(__dirname, "세트분리V2", "core.js"));

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

/** 주문 한 줄 (세트가 쪼개지면 원본코드가 같은 줄이 둘이 된다) */
function 줄(코드, 이름) {
  return {
    고유ID: "p0928000012", 원본코드: "AJ100", 품목코드: 코드, 품목명: 이름,
    받는분: "황금코다리 해운대구 최란희", 주소1: "부산광역시 해운대구 좌동순환로 39, 지상1층",
    전화: "051-111-2222", 모바일: "010-9277-9123",
    우편번호: "48099", 수량: 1, 합계: 10000,
  };
}
const 마스터 = { override: {}, items: { AJ100: { 품목명: "AJ 타원찜 대" } }, bom: {} };

console.log("\n① 메모에 적은 주소가 먹는다 — 쪼개진 두 줄에 «둘 다»");
{
  const units = [줄("AJ100-B", "몸통만"), 줄("AJ100-L", "뚜껑만")];
  const w = [];
  const M = JSON.parse(JSON.stringify(마스터));
  M.override["p0928000012|AJ100"] = {
    조치: "발송", 업체코드: "", 메모: "부산광역시 기장군 기장읍 동부리 273-16",
    새코드: "", 새이름: "",
    새주소: "부산광역시 기장군 기장읍 동부리 273-16", 새받는분: "", 새전화: "", 새모바일: "",
  };
  const n = core.ssApplyManualEdits(units, M, w);
  ok("두 줄 다 바뀐다", units.every((u) => u.주소1 === "부산광역시 기장군 기장읍 동부리 273-16"),
    JSON.stringify(units.map((u) => u.주소1)));
  ok("  ★ 코드와 달리 여러 줄이어도 먹인다 (한 주문은 한 곳으로 간다)", n === 2, String(n));
  ok("원래 주소를 남긴다", units[0].원주소1 === "부산광역시 해운대구 좌동순환로 39, 지상1층",
    units[0].원주소1);
  ok("★ 주소변경 표식이 붙는다 (적요확인 세우기가 다시 안 걸려야 한다)",
    units[0].주소변경 === "보류 메모(사람이 적음)", units[0].주소변경);
  ok("★ 우편번호를 비운다 (옛 주소의 우편번호가 남으면 도서산간이 틀린다)",
    units[0].우편번호 === "", units[0].우편번호);
  ok("경고에 적는다", w.some((x) => String(x[1] || x.code || JSON.stringify(x)).indexOf("MANUAL_ADDR") >= 0),
    JSON.stringify(w[0]));
  ok("연락처는 안 건드린다 (메모에 전화가 없었다)",
    units[0].모바일 === "010-9277-9123" && units[0].전화 === "051-111-2222",
    units[0].모바일 + " / " + units[0].전화);
}

console.log("\n② 메모에 이름·전화까지 적으면 그것도 바뀐다");
{
  const units = [줄("AJ100-B", "몸통만")];
  const M = JSON.parse(JSON.stringify(마스터));
  M.override["p0928000012|AJ100"] = {
    조치: "발송", 새코드: "", 새이름: "",
    새주소: "경기 남양주시 진접읍 장현로 135", 새받는분: "김치말이국수 진접점",
    새전화: "031-555-6666", 새모바일: "010-5260-6056",
  };
  core.ssApplyManualEdits(units, M, []);
  ok("주소", units[0].주소1 === "경기 남양주시 진접읍 장현로 135", units[0].주소1);
  ok("받는분", units[0].받는분 === "김치말이국수 진접점", units[0].받는분);
  ok("유선은 전화(F)", units[0].전화 === "031-555-6666", units[0].전화);
  ok("휴대는 모바일(G)", units[0].모바일 === "010-5260-6056", units[0].모바일);
}

console.log("\n③ 메모에 주소가 없으면 아무 일도 없다");
{
  const units = [줄("AJ100-B", "몸통만")];
  const M = JSON.parse(JSON.stringify(마스터));
  M.override["p0928000012|AJ100"] = {
    조치: "발송", 메모: "손님이 전화 준다고 함", 새코드: "", 새이름: "", 새주소: "",
  };
  const n = core.ssApplyManualEdits(units, M, []);
  ok("주소 그대로", units[0].주소1 === "부산광역시 해운대구 좌동순환로 39, 지상1층", units[0].주소1);
  ok("표식도 안 붙는다", !units[0].주소변경, units[0].주소변경);
  ok("바꾼 줄 0", n === 0, String(n));
}

console.log("\n④ 같은 주소를 또 적어도 헛일을 안 한다");
{
  const units = [줄("AJ100-B", "몸통만")];
  const M = JSON.parse(JSON.stringify(마스터));
  M.override["p0928000012|AJ100"] = {
    조치: "발송", 새코드: "", 새이름: "",
    새주소: "부산광역시 해운대구 좌동순환로 39, 지상1층",
  };
  const n = core.ssApplyManualEdits(units, M, []);
  ok("바꾼 줄 0 (이미 그 주소다)", n === 0, String(n));
  ok("  원래 값을 헛되게 덮지 않는다", units[0].원주소1 === undefined, String(units[0].원주소1));
}

console.log("\n⑤ 적요를 읽는 함수를 그대로 쓴다 (문법이 둘로 갈리지 않는다)");
{
  const 읽기 = core.ssParseAddrOverride;
  ok("메모에 「배송지 …」 를 적어도 읽는다",
    !!읽기("배송지 부산광역시 기장군 기장읍 동부리 273-16"));
  ok("메모에 주소만 적어도 읽는다",
    !!읽기("부산광역시 기장군 기장읍 동부리 273-16"));
  ok("메모가 주소가 아니면 안 읽는다", 읽기("손님이 전화 준다고 함") === null);
}

console.log("\n⑥ 배선 — 소스에서 직접 확인");
{
  const 밑 = path.join(__dirname, "세트분리V2");
  const src = fs.readFileSync(path.join(밑, "core.js"), "utf8");
  const mst = fs.readFileSync(path.join(밑, "gasMasters.js"), "utf8");
  const io = fs.readFileSync(path.join(밑, "gasIO.js"), "utf8");

  ok("수동조치 칸이 16개다", core.SS_MANUAL_HEADER
    ? core.SS_MANUAL_HEADER.length === 16
    : /.새주소., .새받는분., .새전화., .새모바일., .적은말./.test(src));
  ok("  칸을 뒤에만 더했다 (앞을 밀면 이미 적힌 줄이 어긋난다)",
    /'새코드', '새품목명',[\s\S]{0,80}'새주소'/.test(src));
  ok("메모를 적요와 같은 함수로 읽는다", /var 메모주소 = 메모 \? ssParseAddrOverride\(메모\) : null;/.test(mst));
  ok("★ 메모에 주소가 있으면 조치 칸이 비어도 「발송」이다",
    /if \(!조치 && 메모주소\) 조치 = '발송';/.test(mst));
  ok("  사람이 조치에 적은 것이 먼저다 (위에서 이미 정해진다)",
    mst.indexOf("if (적은값 === '발송')") < mst.indexOf("if (!조치 && 메모주소)"));
  ok("적어 둘 칸 넷을 만든다", /var 새주소 = 메모주소 \? ssText\(메모주소\.addr\) : '';/.test(mst));
  ok("이미 있는 줄도 고쳐 쓴다 (13칸)", /getRange\(b0 \+ 2, 4, 1, 13\)/.test(mst));
  ok("  ★ 주소가 달라졌으면 다시 먹인다", /옛새주소 === 새주소\) continue;/.test(mst));
  ok("조치를 읽을 때 주소도 읽는다", /새주소: ssText\(body\[i\]\[11\]\)/.test(mst));
  ok("옛 시트의 짧은 머리글을 늘린다",
    /getLastColumn\(\) < SS_MANUAL_HEADER\.length/.test(mst));

  ok("★ 설정 바로잡기 표가 있다", /SSIO_CONFIG_FIXES = \[/.test(io));
  ok("  합포장 일반 한도 14 → 2", /\['합포장_최대건수', '14', '2',/.test(io));
  ok("  ★ 지금 값이 정확히 14 일 때만 고친다 (사람이 바꿔 둔 값은 안 건드린다)",
    /if \(cfg\[_키\] !== _옛\) continue;/.test(io));
  ok("  고친 것을 남긴다", /\[설정 바로잡음\]/.test(io));
  ok("샘플 한도는 14 그대로", /합포장_최대건수_샘플: '14'/.test(src));
}

console.log("\n⑦ 「보류」라고 적으면 그대로 세워 둔다  (2026-09-28)");
{
  /*  > "도서산간에서 발송으로 처리 안했는데도 넘어가네.. 일부러 보류라고 적었는데도"

      여태 조치 칸의 안내는 「비워 둠 = 그대로 보류」 하나뿐이었다. 그래서 「보류」라고
      적으면 모르는 «업체코드»로 보고 대리발송으로 돌렸다 — 세워 두려고 적은 말이
      «보내라»는 뜻이 된 셈이다. 그 말이 우연히 등록된 두 글자 코드와 같으면
      그 업체로 그냥 나간다.  */
  const W = core.SS_HOLD_KEEP_WORDS || [];
  ok("「보류」를 알아듣는다", W.indexOf("보류") >= 0, JSON.stringify(W.slice(0, 6)));
  ["그대로", "두기", "홀드", "대기", "확인중", "미발송", "안보냄"].forEach((w) => {
    ok("  「" + w + "」도", W.indexOf(w) >= 0);
  });

  const mst = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasMasters.js"), "utf8");
  ok("★ 세우는 말이 「발송」보다 먼저 걸린다",
    mst.indexOf("if (세우기)") < mst.indexOf("else if (적은값 === '발송')"));
  ok("★ 모르는 말을 업체코드로 «받지 않는다» (여태 대리발송으로 돌렸다)",
    /else if \(적은값\) 뜻모름 = true;/.test(mst) &&
    !/else if \(적은값\) \{ 조치 = '대리발송'; 업체 = up; \}/.test(mst));
  ok("  모르는 말은 그대로 보류하고 말해 준다",
    /if \(뜻모름\) \{/.test(mst) && /못알아들음\.push/.test(mst) && /못 알아들어/.test(mst));
  ok("등록된 업체코드는 그대로 먹는다", /else if \(up && vendors\[up\]\)/.test(mst));

  ok("★ 적은 말을 그대로 적어 둔다 (왜 그리 됐는지 되짚을 수 있게)",
    /'새모바일', '적은말'\]/.test(fs.readFileSync(path.join(__dirname, "세트분리V2", "core.js"), "utf8")) &&
    /새모바일, 적은값\]\);/.test(mst));
  ok("  이미 있는 줄도 적은 말까지 고쳐 쓴다 (13칸)", /getRange\(b0 \+ 2, 4, 1, 13\)/.test(mst));

  const main = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasMain.js"), "utf8");
  ok("★ 고르개를 진짜로 단다 (주석은 있다더니 코드엔 없었다)",
    /requireValueInList\(\['발송', '보류', '대리발송'\]\.concat\(codes\), true\)/.test(main));
  ok("  적을 수도 있게 열어 둔다 (막으면 메모를 못 적는다)",
    /setAllowInvalid\(true\)/.test(main));
  ok("  안내문에 「보류」를 적는다", /보류        그대로 세워 둔다/.test(main));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
