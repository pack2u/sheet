/**
 * 자사출고 송장 원천 — 두 탭의 «칸 자리»와 «택배사 코드»가 짝이 맞는가.
 *
 * ★ 왜 이 시험이 있나 ★  (2026-09-11 롯데 → 로젠)
 *   > "거래관리대장송장의 입력_로젠주문실적에서 송장번호를 불러와야되"
 *
 *   두 탭은 칸 자리가 «다르다» —
 *     입력_로젠주문실적  E(4)=주문번호  F(5)=운송장
 *     롯데택배           J(9)=주문번호  G(6)=운송장
 *   짝을 잘못 붙이면 운송장 자리에서 엉뚱한 값을 읽는다. 오류는 안 난다 —
 *   사방넷에 쓰레기가 올라가거나 그 줄이 조용히 빠질 뿐이다.
 *
 *   같은 표가 세 파일에 있다(gasBulk·gasMain, 그리고 허브 _partnerOrders).
 *   한 곳만 고치면 갈라지므로 여기서 «파일에 적힌 값»을 직접 꺼내 맞대 본다.
 *
 * 실행: node node/_owntabs_test.mjs
 */
import fs from "node:fs";
import path from "node:path";

const 뿌리 = path.join(import.meta.dirname, "..");
const 허브 = path.join(뿌리, "..");
const 읽기 = (p) => fs.readFileSync(p, "utf8");

let 실패 = 0;
function eq(설명, 받은, 바란) {
  const ok = String(받은) === String(바란);
  if (!ok) 실패++;
  console.log((ok ? "  통과 " : "★ 실패 ") + 설명 + (ok ? "" : `  got ${받은} want ${바란}`));
}
/** 소스에서 { 이름: 'X', ... uid: n, inv: m ... } 한 덩이를 꺼낸다 */
function 편찾기(src, 이름, uid키, inv키) {
  const i = src.indexOf(`이름: '${이름}'`);
  if (i < 0) return null;
  const 끝 = src.indexOf("}", i);
  const 조각 = src.substring(i, 끝);
  const u = 조각.match(new RegExp(uid키 + ":[ ]*([0-9]+)"));
  const v = 조각.match(new RegExp(inv키 + ":[ ]*([0-9]+)"));
  const g = 조각.match(/gid:[^,]*?([0-9]{6,})/);
  const c = 조각.match(/code:[ ]*([A-Za-z_]+)/);
  return { uid: u && u[1], inv: v && v[1], gid: g && g[1], code: c && c[1] };
}

console.log("\n[gasBulk] 원천 3 — 자사출고 두 탭");
{
  const src = 읽기(path.join(뿌리, "gasBulk.js"));
  const 로젠 = 편찾기(src, "로젠", "uid", "inv");
  const 롯데 = 편찾기(src, "롯데", "uid", "inv");
  eq("로젠 주문번호 = S(18)", 로젠.uid, 18);
  eq("로젠 운송장 = D(3)", 로젠.inv, 3);
  eq("로젠 탭 GID", 로젠.gid, 548505068);
  eq("로젠 코드는 로젠 것", 로젠.code, "SSB_ROZEN_CODE");
  eq("롯데 주문번호 = I(8)", 롯데.uid, 8);
  eq("롯데 운송장 = G(6)", 롯데.inv, 6);
  eq("롯데 탭 GID", 롯데.gid, 1575029201);
  eq("롯데 코드는 롯데 것", 롯데.code, "SSB_LOTTE_CODE");
  eq("★ 지금 택배사(로젠)를 «먼저» 읽는다", src.indexOf("이름: '로젠'") < src.indexOf("이름: '롯데'"), "true");
}

console.log("\n[gasMain] 송장 전파 — 같은 표를 써야 한다");
{
  const src = 읽기(path.join(뿌리, "gasMain.js"));
  const 로젠 = 편찾기(src, "로젠", "uid", "inv");
  const 롯데 = 편찾기(src, "롯데", "uid", "inv");
  eq("로젠 주문번호", 로젠.uid, 18);
  eq("로젠 운송장", 로젠.inv, 3);
  eq("롯데 주문번호", 롯데.uid, 8);
  eq("롯데 운송장", 롯데.inv, 6);
  eq("★ 택배사를 박아 두지 않는다 — 탭에서 온 것을 쓴다",
    src.includes("lotte[uid].c"), "true");
  eq("★ 옛 「롯데 직접」을 안 쓴다", src.includes("'롯데 직접'"), "false");
}

console.log("\n[허브 _partnerOrders.gs] 사방넷 대량등록도 같은 표");
{
  const src = 읽기(path.join(허브, "_partnerOrders.gs"));
  eq("로젠 탭을 자사출고 원천으로 쓴다", src.includes("_PT_PRIMARY_INVOICE_GID, code: ROZEN_CODE"), "true");
  eq("롯데 탭도 계속 읽는다", src.includes("_PT_SECONDARY_INVOICE_GID, code: LOTTE_CODE"), "true");
}

console.log("\n[_partnerHelpers.gs] 로젠 칸 자리는 한 군데");
{
  const src = 읽기(path.join(허브, "_partnerHelpers.gs"));
  const m = src.match(/_PT_ROZEN_FIXED_COL[^{]*[{]([^}]*)[}]/);
  eq("상수가 있다", !!m, "true");
  eq("주문번호 S(18)", /uid:[ ]*18/.test(m[1]), "true");
  eq("운송장 D(3)", /invoice:[ ]*3/.test(m[1]), "true");
}

console.log("\n[머리글을 찾는가] 1행에 있다고 믿으면 로젠은 0행이 된다");
{
  /* 로젠 탭은 1행이 제목(「주문등록_출력…」)이고 머리글은 2행이다.
     1행만 보면 이름을 못 찾아 고정 자리로 떨어지는데, 그 자리가 엉뚱해
     한 줄도 안 걸린다 — 오류 없이 0행. 385건이 91건이 된 진짜 원인이다. */
  eq("gasBulk 가 머리글을 찾는다", 읽기(path.join(뿌리, "gasBulk.js")).includes("function ssb_findHeader"), "true");
  eq("gasMain 이 그것을 쓴다", 읽기(path.join(뿌리, "gasMain.js")).includes("ssb_findHeader(lTab)"), "true");
  eq("허브도 찾는다", 읽기(path.join(허브, "_partnerOrders.gs")).includes("_po_findInvoiceHeader_"), "true");
  //  로젠엔 집하일자가 없다 — 파일명(20260911.xls)이 날짜를 담는다
  eq("날짜 칸으로 파일명도 본다", 읽기(path.join(뿌리, "gasBulk.js")).includes("h === 0x27파일명0x27".split("0x27").join(String.fromCharCode(39))), "true");
}

console.log(실패 ? `\n실패 ${실패}건` : "\n세 파일이 같은 표를 쓴다");
process.exit(실패 ? 1 : 0);
