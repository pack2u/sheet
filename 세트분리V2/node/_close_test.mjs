/**
 * 일일마감 — 원장 한 줄이 마감 한 줄이 되는가
 *
 *  > "일일 마감 미매칭건이 열라 많아…
 *  >  세트분리에서 일일 마감을 만들어 실행해보자."
 *
 *  허브 일일마감은 송장을 「롯데 탭」에서 가져온다. 9월 11일에 로젠으로
 *  갈아탔으므로 그날부터 주 송장원이 비었다 — 미매칭 475건이 그 숫자다.
 *  세트분리의 원장에는 ss_송장전파 가 로젠·롯데·발주허브·대리공급을 다 읽어
 *  운송장번호를 이미 붙여 뒀다. 그래서 이 마감은 맞추는 일이 아니라 옮겨
 *  적는 일이다.
 *
 *  지켜야 할 것
 *    · 칸은 허브 _UNIFIED_HEADERS_ 19칸과 «똑같이» 낸다
 *    · 원장의 「거래처명」 칸은 실은 받는분이다 — 수취인명에 넣는다
 *    · 택배사는 송장 자릿수로 가린다 (ssb_ownCode 한 곳의 규칙)
 *    · 비배송·보류는 마감에 안 담는다 — 나간 물건이 아니다
 *
 * 실행: node node/_close_test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const 읽기 = (p) => fs.readFileSync(p, "utf8");

let 실패 = 0;
function eq(설명, 받은, 바란) {
  const ok = JSON.stringify(받은) === JSON.stringify(바란);
  if (!ok) 실패++;
  console.log((ok ? "  통과 " : "★ 실패 ") + 설명 +
    (ok ? "" : "  got " + JSON.stringify(받은) + " want " + JSON.stringify(바란)));
}

const main = 읽기(path.join(뿌리, "gasMain.js"));
const core = 읽기(path.join(뿌리, "core.js"));
const bulk = 읽기(path.join(뿌리, "gasBulk.js"));

function 함수떼기(src, name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, 봤다 = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; 봤다 = true; }
    else if (src[i] === "}") { d--; if (봤다 && d === 0) return src.slice(s, i + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
function 변수떼기(src, name, 열, 닫) {
  const at = src.indexOf("var " + name + " = " + 열);
  if (at < 0) throw new Error(name + " 를 못 찾음");
  let d = 0;
  for (let i = src.indexOf(열, at); i < src.length; i++) {
    if (src[i] === 열) d++;
    else if (src[i] === 닫) { d--; if (d === 0) return src.slice(at, i + 1) + ";"; }
  }
  throw new Error(name + " 가 안 닫힘");
}

const ctx = { Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext([
  함수떼기(core, "ssText"),
  함수떼기(core, "ssNum"),
  변수떼기(core, "SS_ROUTE", "{", "}"),
  "var SSB_LOTTE_CODE = '002', SSB_ROZEN_CODE = '007';",
  함수떼기(bulk, "ssb_ownCode"),
  변수떼기(main, "SS_CLOSE_HEADER", "[", "]"),
  변수떼기(main, "SS_CLOSE_SKIP_ROUTES", "[", "]"),
  함수떼기(main, "ss_마감줄_"),
  함수떼기(main, "ss_마감읽기_"),
  함수떼기(main, "ss_마감키_"),
].join("\n"), ctx);

const 칸 = ctx.SS_CLOSE_HEADER;
const 자리 = (n) => 칸.indexOf(n);

/** 원장 한 줄을 이름으로 만든다 */
function 원장줄(o) {
  const 이름들 = ["회차키", "고유ID", "경로", "출고지", "품목코드", "품목명", "출력품목명",
    "수량", "거래처명", "전화", "모바일", "주소1", "배송메시지", "합계", "적요",
    "보내는분", "배송비", "운송장번호", "조치업체"];
  const ix = {}, row = [];
  이름들.forEach((n, i) => { ix[n] = i; row[i] = o[n] === undefined ? "" : o[n]; });
  return { row, ix };
}
const 마감 = (o, at) => {
  const { row, ix } = 원장줄(o);
  return ctx.ss_마감줄_(ctx.ss_마감읽기_(row, ix), at || "2026-09-14 20:30:00");
};

console.log("\n[일일마감] 칸이 허브 것과 같은가");
{
  //  허브 _partnerExclusivePush.gs 의 _UNIFIED_HEADERS_ 와 한 글자도 달라지면 안 된다
  const 허브 = ["출처", "기록일시", "주문번호", "운송장번호", "수취인명", "전화번호", "휴대폰",
    "주소", "품목코드", "품목명", "수량", "배송메시지", "업체/판매처", "운임/배송비",
    "비고", "발주업체", "주문유형", "단가", "정산금액"];
  eq("★ 19칸이 허브 _UNIFIED_HEADERS_ 와 똑같다", 칸, 허브);
}

console.log("\n[일일마감] 자사출고 — 택배사를 송장 자릿수로 가린다");
{
  const 로젠 = 마감({ 경로: "로젠택배", 운송장번호: "12345678901", 고유ID: "0914-PH-1" });
  eq("★ 11자리는 로젠", 로젠[자리("출처")], "로젠");
  const 롯데 = 마감({ 경로: "로젠택배", 운송장번호: "123456789012", 고유ID: "0914-PH-2" });
  eq("★ 12자리는 롯데 (9/10 까지의 옛 건)", 롯데[자리("출처")], "롯데");
  const 없음 = 마감({ 경로: "로젠택배", 고유ID: "0914-PH-3" });
  eq("송장이 없으면 「자사출고」", 없음[자리("출처")], "자사출고");
  eq("송장 칸은 비어 있다", 없음[자리("운송장번호")], "");
}

console.log("\n[일일마감] 대리발송 — 출처가 업체다");
{
  const a = 마감({ 경로: "대리발송", 조치업체: "HR", 운송장번호: "12345678901" });
  eq("★ 조치업체가 있으면 그 업체", a[자리("출처")], "대리공급(HR)");
  eq("발주업체 칸에도 적는다", a[자리("발주업체")], "HR");
  const b = 마감({ 경로: "대리발송", 출고지: "대리발송-TY", 운송장번호: "12345678901" });
  eq("조치업체가 없으면 출고지에서 본다", b[자리("출처")], "대리공급(대리발송-TY)");
  eq("★ 대리발송은 자릿수로 택배사를 안 가린다", b[자리("출처")].indexOf("로젠"), -1);
}

console.log("\n[일일마감] 원장의 「거래처명」은 실은 받는분이다");
{
  const r = 마감({ 경로: "로젠택배", 거래처명: "김다영", 전화: "0311234567",
    모바일: "01012345678", 주소1: "경기도 평택시", 운송장번호: "12345678901" });
  eq("★ 수취인명 ← 원장 거래처명(=받는분)", r[자리("수취인명")], "김다영");
  eq("전화번호", r[자리("전화번호")], "0311234567");
  eq("휴대폰", r[자리("휴대폰")], "01012345678");
  eq("주소", r[자리("주소")], "경기도 평택시");
}

console.log("\n[일일마감] 품목명은 출력품목명이 이긴다");
{
  const r = 마감({ 경로: "로젠택배", 품목명: "구성품 이름", 출력품목명: "BF 죽용기 대 500세트" });
  eq("★ 출력품목명이 있으면 그것", r[자리("품목명")], "BF 죽용기 대 500세트");
  const r2 = 마감({ 경로: "로젠택배", 품목명: "구성품 이름" });
  eq("없으면 품목명", r2[자리("품목명")], "구성품 이름");
}

console.log("\n[일일마감] 숫자 칸은 숫자로");
{
  const r = 마감({ 경로: "로젠택배", 수량: "3", 배송비: "4000" });
  eq("수량", r[자리("수량")], 3);
  eq("운임/배송비", r[자리("운임/배송비")], 4000);
  eq("단가는 원장이 모른다", r[자리("단가")], "");
  eq("정산금액도 모른다", r[자리("정산금액")], "");
}

console.log("\n[일일마감] 주문유형은 경로 그대로");
{
  eq("합포장동봉", 마감({ 경로: "합포장동봉" })[자리("주문유형")], "합포장동봉");
  eq("도서산간", 마감({ 경로: "로젠택배-도서산간" })[자리("주문유형")], "로젠택배-도서산간");
}

console.log("\n[일일마감] 나간 물건이 아닌 것은 안 담는다");
{
  eq("★ 비배송은 건너뛴다", ctx.SS_CLOSE_SKIP_ROUTES.indexOf("비배송") >= 0, true);
  eq("★ 보류는 건너뛴다", ctx.SS_CLOSE_SKIP_ROUTES.indexOf("보류") >= 0, true);
  eq("로젠택배는 담는다", ctx.SS_CLOSE_SKIP_ROUTES.indexOf("로젠택배") < 0, true);
  eq("대리발송도 담는다", ctx.SS_CLOSE_SKIP_ROUTES.indexOf("대리발송") < 0, true);
}

console.log("\n[일일마감] 소스 코드가 지켜야 할 것");
{
  eq("★ 그날 회차만 담는다 (회차키 앞 6자)",
    main.includes("if (rk.substring(0, 6) !== 오늘) continue;"), true);
  eq("★ 원장 칸을 «이름»으로 찾는다",
    main.includes("꼭필요 = ['회차키', '고유ID', '운송장번호', '경로', '품목코드', '수량'];"), true);
  eq("★ 칸이 없으면 조용히 넘어가지 않고 멈춘다",
    main.includes("if (없는칸.length) {"), true);
  eq("★ 원장에 아무것도 안 쓴다",
    main.slice(main.indexOf("function ss_일일마감")).slice(0, 4000).includes("lg.getRange(2, 1, lv.length"), false);
  eq("★ 매칭률을 말한다", main.includes("'  ★ 매칭률  : ' + 율 + '%'"), true);
  eq("★ 미매칭은 따로 탭에 낸다",
    main.includes("ssio_write(이름 + SS_CLOSE_MISS_SUFFIX, SS_CLOSE_HEADER, 미매칭"), true);
  eq("★ 다음에 뭘 할지 알려 준다",
    main.includes("「🔁 송장 전파」를 먼저 돌려 보세요"), true);
  eq("★ 택배사 규칙을 여기 또 적지 않았다 (ssb_ownCode 를 부른다)",
    main.includes("ssb_ownCode(inv) === SSB_LOTTE_CODE"), true);
  eq("★ 메뉴에 있다", main.includes("'📋 일일마감 (원장 → 마감표)', 'ss_일일마감'"), true);
}

console.log("\n[일일마감] 「아직 안 온 것」과 「사라진 것」을 가르는가");
{
  //  > "3차 오후3시 발주건들은 대리공급업체에서 송장번호를 다음날 기입하게 되"
  eq("★ 늦은 회차 대리발송은 «대기»로 센다",
    main.includes("if (경로 === SS_ROUTE.PARTNER && 늦은회차[rk]) {"), true);
  eq("★ 대기는 따로 탭에 낸다",
    main.includes("ssio_write(이름 + SS_CLOSE_WAIT_SUFFIX, SS_CLOSE_HEADER, 대기"), true);
  eq("★ 매칭률 분모에서 대기를 뺀다",
    main.includes("var 볼수있음 = 센다.총 - 센다.대기;"), true);
  eq("★ 뺐다는 사실을 같은 줄에 적는다 (숨긴 게 아니다)",
    main.includes("'   (대기 ' + 센다.대기 + '건 뺀 '"), true);
  eq("★ 전체 기준 비율도 같이 보여 준다",
    main.includes("전체로는 ' + 전체율 + '%)"), true);
  eq("★ 이른 회차 대리발송이 비면 그건 «진짜 미매칭»",
    main.includes("} else {\n      센다.미매칭++;\n      미매칭.push(줄);"), true);
  eq("★ 자사출고는 늦어도 대기로 안 샌다 (경로를 함께 본다)",
    main.includes("경로 === SS_ROUTE.PARTNER && 늦은회차[rk]"), true);
}

console.log("\n[일일마감] 늦은 회차를 «시각»으로 가린다");
{
  eq("★ 회차 탭의 최초실행을 본다",
    main.includes("if (ci['회차키'] === undefined || ci['최초실행'] === undefined) return 늦음;"), true);
  eq("★ 회차 «번호»로 가리지 않는다 (3차 같은 못박기가 없다)",
    main.includes("ss_마감늦은회차_") && !main.includes("회차번호 >= 3"), true);
  eq("★ 기준 시각은 설정에서 온다",
    main.includes("ssText(cfg['마감_업체송장_기준시각']) || '14:00'"), true);
  eq("★ Date 도 글자도 읽는다",
    main.includes("if (t instanceof Date) {"), true);
  eq("★ 못 읽으면 «늦지 않은 것»으로 둔다 — 사고를 숨기지 않는다",
    main.includes("//  모르면 «늦지 않은 것»으로 둔다 — 사고를 숨기는 쪽으로 기울지 않는다"), true);
  eq("★ 설정 기본값이 있다",
    읽기(path.join(뿌리, "gasIO.js")).includes("['마감_업체송장_기준시각', '14:00'"), true);
}

console.log("\n" + (실패 ? "실패 " + 실패 + "건" : "다 통과"));
process.exit(실패 ? 1 : 0);
