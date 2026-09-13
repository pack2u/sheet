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


/* ═══════════════════════════════════════════════════════════════
   마감이 옮겨 놓은 원천 둘 (2026-09-12)

   > "사방넷 송신 엑셀에서 대리공급 마감으로 넘어간건 인식 안하지?"

   대리공급 마감은 매일 23:30 에 «송장이 찍힌 행»만 골라
   대리공급_임시기록과 협력업체_발주허브에서 지운다.
   올려야 할 행만 사라지는데, 읽는 쪽은 원본 탭만 보고 있었다.

   보관탭은 앞에 2열이 더 붙어 있다. 그 오프셋이 두 파일에서 갈라지면
   운송장 자리에서 엉뚱한 칸을 읽는다 — 오류는 안 나고 쓰레기가 올라간다.
   그래서 «파일에 적힌 값»을 직접 꺼내 맞대 본다.
   ═══════════════════════════════════════════════════════════════ */
console.log("\n[원천 5] 대리공급_임시기록_보관 — 앞 2열 오프셋");
{
  const bulk = 읽기(path.join(뿌리, "gasBulk.js"));
  const hub = 읽기(path.join(허브, "_partnerOrders.gs"));

  eq("세트분리가 보관탭을 읽는다", bulk.includes("대리공급_임시기록_보관"), "true");
  eq("허브가 보관탭을 읽는다", hub.includes("_po_getTempArchiveTab_(ss)"), "true");

  //  세트분리는 값을 박아 쓰고, 허브는 상수를 쓴다 — 둘이 같아야 한다
  const 세트오프 = bulk.match(/보관오프셋 = ([0-9]+)/);
  const 허브오프 = hub.match(/_PO_TEMP_ARCHIVE_COL_OFFSET_ = ([0-9]+)/);
  eq("세트분리 오프셋", 세트오프 && 세트오프[1], 2);
  eq("허브 오프셋", 허브오프 && 허브오프[1], 2);
  eq("★ 두 파일의 오프셋이 같다", 세트오프[1] === 허브오프[1], "true");

  //  원본 칸 자리 (P=15 주문번호 · X=23 송장 · W=22 업체prefix · C=2 일자)
  eq("주문번호 15+오프셋", bulk.includes("[15 + 보관오프셋]"), "true");
  eq("송장 23+오프셋", bulk.includes("[23 + 보관오프셋]"), "true");
  eq("업체prefix 22+오프셋", bulk.includes("[22 + 보관오프셋]"), "true");
  eq("일자 2+오프셋", bulk.includes("[2 + 보관오프셋]"), "true");
  eq("허브도 주문번호 uidCol+오프셋", hub.includes("[uidCol + archOff]"), "true");
  eq("허브도 송장 invCol+오프셋", hub.includes("[invCol + archOff]"), "true");
  eq("허브도 업체prefix 22+오프셋", hub.includes("[22 + archOff]"), "true");
}

console.log("\n[원천 6] 송장원장 — 출처에서 업체명을 읽는다");
{
  const bulk = 읽기(path.join(뿌리, "gasBulk.js"));
  const hub = 읽기(path.join(허브, "_partnerOrders.gs"));

  eq("세트분리가 송장원장을 읽는다", bulk.includes("'송장원장'"), "true");
  eq("허브가 송장원장을 읽는다", hub.includes("_PIL_TAB_NAME_"), "true");

  /* 출처는 「전용마감:올팩」·「발주마감:올팩」 꼴이다.
     임시기록·임시기록보관 줄은 콜론이 없어 저절로 빠지고,
     허브아카이브는 업체명이 없어 택배사를 못 정한다 — 세기만 한다. */
  for (const [이름, src] of [["세트분리", bulk], ["허브", hub]]) {
    eq(이름 + " 전용마감을 본다", src.includes("전용마감"), "true");
    eq(이름 + " 발주마감을 본다", src.includes("발주마감"), "true");
    eq(이름 + " 업체 못 정한 건 세어 둔다", src.includes("ledgerNoVendor"), "true");
    //  원장은 60일치다. 그대로 얹으면 두 달치가 사방넷에 다시 올라간다.
    eq(이름 + " ★ 15일 하한이 있다", /15 [*] 86400000/.test(src), "true");
  }
}


/* ═══════════════════════════════════════════════════════════════
   합포장 전파 — 동봉 형제에게 대표의 송장 (2026-09-13)

   > "대표의 송장번호가 나머지 사방넷 번호에도 같이 붙어 줘야
      사방넷 번호마다 송장번호 대량등록이 가능해"

   2026-09-12: 합포장 동봉 83줄이 통째로 빠졌다. 원장의 송장매칭이
   전부 빈칸 — 「송장 전파」를 안 돌렸기 때문이다. 대표 17건만 올라갔다.
   이제는 전파를 돌렸든 말든 저장이 스스로 짝을 짓는다.

   여기서는 «시트 없이» 그 함수를 직접 돌려 본다. 원천 표를 읽는 부분과
   달리 이건 순수 계산이라 진짜로 돌려 볼 수 있고, 그래야 의미가 있다.
   ═══════════════════════════════════════════════════════════════ */
console.log("\n[합포장 전파] 대표 송장이 동봉 아홉에게 붙는가");
{
  const core = 읽기(path.join(뿌리, "core.js"));
  const bulk = 읽기(path.join(뿌리, "gasBulk.js"));
  //  GAS 전역은 안 쓰는 함수만 꺼내 쓴다 — 쓰면 그 자리에서 터진다
  const 꺼내기 = new Function(
    "Utilities", "SpreadsheetApp", "Logger", "module",
    core + "\n" + bulk + "\n" +
    "return { ssb_spreadMerged: ssb_spreadMerged, ssb_addRows: ssb_addRows };",
  );
  const { ssb_spreadMerged } = 꺼내기(null, null, { log() {} }, undefined);

  const 새판 = () => ({ rows: [], seen: {}, uidSeen: {}, seenOrd: {},
    res: { skipNoCode: 0, skipGen: 0, byCode: {}, noCodeNames: {} } });

  //  열 건 한 박스 — 대표 하나만 로젠에서 송장을 받아 왔다
  {
    const p = 새판();
    p.rows.push(["2161996128", "45141526102", "", "", "007"]);
    p.seen["2161996128|45141526102"] = true;
    p.seenOrd["2161996128"] = true;
    const 박스 = { "평택S-1♦김산♦양평♦팩투유♦샘플": {
      rep: "2161996128",
      kids: ["2161996129", "2161996130", "2161996131", "2161996132",
             "2161996133", "2161996134", "2161996135"],
    } };
    const n = ssb_spreadMerged(p.rows, p.seen, 박스, p.res, p.uidSeen, p.seenOrd);
    eq("동봉 일곱이 다 붙는다", n, 7);
    eq("줄 수 = 대표1 + 동봉7", p.rows.length, 8);
    eq("★ 전부 대표와 같은 송장", p.rows.every((r) => r[1] === "45141526102"), "true");
    eq("★ 주문번호는 저마다 다르다", new Set(p.rows.map((r) => r[0])).size, 8);
    eq("택배사 코드도 대표 것", p.rows.every((r) => r[4] === "007"), "true");
  }

  //  대표 송장이 아직 안 왔다 — 조용히 빠지지 않고 «세어서» 알린다
  {
    const p = 새판();
    const 박스 = { g1: { rep: "2161996128", kids: ["2161996129", "2161996130"] } };
    const n = ssb_spreadMerged(p.rows, p.seen, 박스, p.res, p.uidSeen, p.seenOrd);
    eq("붙인 것 없음", n, 0);
    eq("★ 못 붙인 동봉을 센다", p.res.mergeNoRep, 2);
    eq("박스는 세어 둔다", p.res.mergeBoxes, 1);
  }

  //  제 송장으로 이미 잡힌 동봉은 덮지 않는다
  {
    const p = 새판();
    p.rows.push(["2161996128", "45141526102", "", "", "007"]);
    p.seenOrd["2161996128"] = true;
    p.rows.push(["2161996129", "99999999999", "", "", "007"]);
    p.seenOrd["2161996129"] = true;
    const 박스 = { g1: { rep: "2161996128", kids: ["2161996129", "2161996130"] } };
    const n = ssb_spreadMerged(p.rows, p.seen, 박스, p.res, p.uidSeen, p.seenOrd);
    eq("새로 붙은 것은 하나", n, 1);
    eq("★ 제 송장을 안 덮는다", p.rows[1][1], "99999999999");
  }

  //  사방넷 번호가 아닌 동봉(전화주문)은 못 올린다 — 그것도 세어 둔다
  {
    const p = 새판();
    p.rows.push(["2161996128", "45141526102", "", "", "007"]);
    p.seenOrd["2161996128"] = true;
    const 박스 = { g1: { rep: "2161996128", kids: ["0913-PH-abcde"] } };
    const n = ssb_spreadMerged(p.rows, p.seen, 박스, p.res, p.uidSeen, p.seenOrd);
    eq("전화주문 ID 는 안 올라간다", n, 0);
    eq("제외로 센다", p.res.skipGen, 1);
  }

  //  대표만 있고 동봉이 없는 박스는 아무 일도 안 한다
  {
    const p = 새판();
    p.rows.push(["2161996128", "45141526102", "", "", "007"]);
    const 박스 = { g1: { rep: "2161996128", kids: [] } };
    eq("혼자면 그대로", ssb_spreadMerged(p.rows, p.seen, 박스, p.res, p.uidSeen, p.seenOrd), 0);
    eq("줄도 안 는다", p.rows.length, 1);
  }
}

console.log("\n[합포장 짝짓기] 송장이 없어도 짝은 모은다");
{
  const src = 읽기(path.join(뿌리, "gasBulk.js"));
  /* 동봉 줄은 전파 전에는 운송장번호가 비어 있다. 짝을 모으는 자리가
     「송장 없으면 continue」 아래로 내려가면 영영 못 짓는다. */
  const 짝 = src.indexOf("박스[grp4] = { rep: '', kids: [] }");
  const 거름 = src.indexOf("if (!uid4 || !inv4) continue;");
  eq("짝 모으기가 있다", 짝 > 0, "true");
  eq("★ 짝을 «송장 거르기보다 먼저» 모은다", 짝 < 거름, "true");
  eq("전파 결과를 화면에 적는다", src.includes("합포장 전파 "), "true");
  eq("못 붙인 동봉을 알린다", src.includes("mergeNoRep"), "true");
}

console.log(실패 ? `\n실패 ${실패}건` : "\n세 파일이 같은 표를 쓴다");
process.exit(실패 ? 1 : 0);
