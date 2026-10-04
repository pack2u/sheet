/**
 * 나가기 직전 점검 — 송장이 될 수 없는 줄을 잡는가
 *
 *  > "세트분리, 상품정보등에서 품목, 주소등 중요사항들이 빠지는 경우가
 *  >  있는지 다시 한번 체크해줘."
 *
 *  찾아보니 그물은 «주소 하나»뿐이었다(ADDR_EMPTY). 받는분이 비어도,
 *  전화가 둘 다 비어도, 품목명이 비어도 아무 말 없이 출력 탭으로 갔다.
 *  그 넷은 송장 한 장이 되기 위한 최소다. 하나라도 비면 그 건은 못 간다.
 *
 * 실행: node node/_preflight_test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const 뿌리 = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/*  ★ 줄바꿈에 휘둘리지 않는다 ★  (2026-09-15)
    이 시험들은 소스를 «글자 그대로» 맞춰 본다. 그런데 윈도우 git 이
    체크아웃할 때 LF 를 CRLF 로 바꿔 놓는다 — 코드는 하나도 안 바뀌었는데
    여러 줄짜리 대조가 통째로 어긋나 「없다」고 나온다. 실제로 오늘
    git stash 한 번에 일일마감 검사가 거짓으로 실패했다. 한 가지로 맞춰 읽는다. */
const 읽기 = (p) => fs.readFileSync(p, "utf8").split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
let 실패 = 0;
function eq(설명, 받은, 바란) {
  const ok = JSON.stringify(받은) === JSON.stringify(바란);
  if (!ok) 실패++;
  console.log((ok ? "  통과 " : "★ 실패 ") + 설명 +
    (ok ? "" : "  got " + JSON.stringify(받은) + " want " + JSON.stringify(바란)));
}

const main = 읽기(path.join(뿌리, "gasMain.js"));
const core = 읽기(path.join(뿌리, "core.js"));
const io = 읽기(path.join(뿌리, "gasIO.js"));

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

const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  함수떼기(core, "ssText"),
  함수떼기(core, "ssNum"),
  함수떼기(core, "ssWarn"),
  변수떼기(core, "SS_ROUTE", "{", "}"),
  //  SSIO_TABS 는 gasIO 에 있다 — 출력 탭 이름만 쓴다
  변수떼기(io, "SSIO_TABS", "{", "}"),
  변수떼기(main, "SS_SHIP_MUST", "[", "]"),
  함수떼기(main, "ss출고점검"),
].join("\n"), ctx);

const 온전 = () => ({
  순번: "000001", 받는분: "김다영", 주소1: "경기도 평택시 포승읍",
  모바일: "01012345678", 전화: "", 품목명: "BF 죽용기 대", 출력품목명: "",
  수량: 2,
});
function 통 (rows) {
  const b = {};
  b[ctx.SS_ROUTE.LOTTE] = rows;
  return b;
}

console.log("\n[출고 점검] 온전한 줄은 아무 말도 안 한다");
{
  const w = [];
  const r = ctx.ss출고점검(통([온전(), 온전()]), w);
  eq("★ 빠진 칸 없음", r, {});
  eq("★ 경고도 없다 — 날 일이 없는 경고여야 한다", w.length, 0);
}

console.log("\n[출고 점검] 송장이 될 수 없는 줄을 잡는다");
{
  const 없다 = (k, v) => { const u = 온전(); u[k] = v; return u; };
  const 본다 = (u) => { const w = []; return { 셈: ctx.ss출고점검(통([온전(), u]), w), w }; };

  eq("★ 받는분 없음", 본다(없다("받는분", "")).셈, { 받는분: 1 });
  eq("★ 주소 없음", 본다(없다("주소1", "")).셈, { 주소: 1 });
  eq("★ 품목명 없음", 본다(없다("품목명", "")).셈, { 품목명: 1 });
  eq("★ 수량 0", 본다(없다("수량", 0)).셈, { 수량: 1 });

  const 전화둘다 = 온전(); 전화둘다.모바일 = ""; 전화둘다.전화 = "";
  eq("★ 전화·모바일이 «둘 다» 비어야 잡는다", 본다(전화둘다).셈, { 연락처: 1 });

  const 집전화만 = 온전(); 집전화만.모바일 = ""; 집전화만.전화 = "0319237795";
  eq("집전화라도 있으면 안 잡는다", 본다(집전화만).셈, {});
}

console.log("\n[출고 점검] «한 건»부터 말한다");
{
  //  ADDR_EMPTY 는 「다섯 줄 넘고 20%」인데, 여기는 이미 나갈 줄만 남은 뒤다.
  const w = [];
  const 많이 = [];
  for (let i = 0; i < 100; i++) 많이.push(온전());
  const 하나 = 온전(); 하나.받는분 = ""; 하나.순번 = "000042";
  많이.push(하나);
  const r = ctx.ss출고점검(통(많이), w);
  eq("★ 100줄 중 한 줄이어도 잡는다", r, { 받는분: 1 });
  eq("★ 오류로 올린다", w[0].level, "오류");
  eq("★ 어느 줄인지 순번을 적는다", /000042/.test(w[0].msg), true);
  eq("★ 왜 문제인지 말한다", /택배가 못 갑니다/.test(w[0].msg), true);
}

console.log("\n[출고 점검] 나갈 줄만 본다");
{
  const b = {};
  b[ctx.SS_ROUTE.LOTTE] = [온전()];
  const 빈줄 = 온전(); 빈줄.주소1 = "";
  b[ctx.SS_ROUTE.NONSHIP] = [빈줄];
  b[ctx.SS_ROUTE.HOLD] = [빈줄];
  const w = [];
  eq("★ 비배송·보류는 안 본다 (물건이 안 나간다)", ctx.ss출고점검(b, w), {});
}

console.log("\n[출고 점검] 대리발송도 본다");
{
  const b = {};
  const 빈줄 = 온전(); 빈줄.주소1 = "";
  b[ctx.SS_ROUTE.PARTNER] = [빈줄];
  eq("★ 대리발송 줄도 송장이 나간다", ctx.ss출고점검(b, []), { 주소: 1 });
}

console.log("\n[출고 점검] 소스 코드가 지켜야 할 것");
{
  eq("★ 출력 탭을 쓰기 «전»에 본다",
    main.indexOf("var 출고빔 = ss출고점검(res.buckets, res.warnings);") <
    main.indexOf("var name = SSIO_TABS.출력[i];"), true);
  eq("★ 실행요약 맨 앞쪽에 세운다",
    main.includes("sum.push(['★★ 나갈 줄에 빠진 칸'"), true);
  eq("★ 빠진 게 없으면 그 줄 자체가 안 뜬다",
    main.includes("if (빔글.length) sum.push("), true);
  eq("★ 경고 탭은 무조건 쓰인다 (조건부가 아니다)",
    main.includes("// 경고\n    ssio_write(SSIO_TABS.경고, SS_WARN_HEADER,"), true);
}

console.log("\n" + (실패 ? "실패 " + 실패 + "건" : "다 통과"));
process.exit(실패 ? 1 : 0);
