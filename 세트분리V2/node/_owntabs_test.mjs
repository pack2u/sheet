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
  const 짝 = src.indexOf("박스[grp4] = { rep: '', kids: [], rk: '' }");
  const 거름 = src.indexOf("if (!uid4 || !inv4) continue;");
  eq("짝 모으기가 있다", 짝 > 0, "true");
  eq("★ 짝을 «송장 거르기보다 먼저» 모은다", 짝 < 거름, "true");
  eq("전파 결과를 화면에 적는다", src.includes("합포장 전파 "), "true");
  eq("못 붙인 동봉을 알린다", src.includes("mergeNoRep"), "true");
}

console.log(실패 ? `\n실패 ${실패}건` : "\n세 파일이 같은 표를 쓴다");

/* ═══════════════════════════════════════════════════════════════
   도서산간 — «같은 분이 2건 이상일 때만» 조치를 받는가

   > "1번이야 도서산간에서 2건 이상일때만 조치.."

   여태 도서산간은 한 건도 빠짐없이 「조치」 칸을 채워야 나갔다. 한 분에게
   한 박스면 운임도 한 번이라 확인해서 달라질 것이 없는데도 그랬다.
   날마다 뜻 없이 칸을 채우면 손이 먼저 움직이고, 정작 봐야 할 2건짜리도
   같이 채워진다.

   ssb_islandKeep 은 순수 계산이라 시트 없이 진짜로 돌려 볼 수 있다.
   ═══════════════════════════════════════════════════════════════ */
console.log("\n[도서산간] 2건 이상일 때만 조치를 받는가");
{
  const core = 읽기(path.join(뿌리, "core.js"));
  const bulk = 읽기(path.join(뿌리, "gasBulk.js"));
  const 꺼내기 = new Function(
    "Utilities", "SpreadsheetApp", "Logger", "module",
    core + "\n" + bulk + "\n" +
    "return { ssb_islandKeep: ssb_islandKeep };",
  );
  const { ssb_islandKeep } = 꺼내기(null, null, { log() {} }, undefined);

  //  도서산간 탭 머리글 — 앞 네 칸이 더 있고 「조치」가 맨 뒤다
  const H = ["권역", "우편번호", "판정", "도선료",
             "출고지", "순번", "일자-No.", "품목코드", "품목명", "택배박스수량", "수량",
             "전화", "모바일", "주소1", "배송메시지", "합계", "거래처명", "단품배송비",
             "적요", "사방넷주문번호", "보내는분", "보내는분전화", "보내는주소(팩투유)", "조치"];
  //  한 줄 만들기 — 받는분·주소·조치만 달리 준다
  const 줄 = (받는분, 주소, 조치) => {
    const r = new Array(H.length).fill("");
    r[H.indexOf("거래처명")] = 받는분;
    r[H.indexOf("주소1")] = 주소;
    r[H.indexOf("보내는분")] = "팩투유";
    r[H.indexOf("조치")] = 조치 || "";
    return r;
  };

  {
    //  혼자 온 분 둘 · 두 줄인 분 하나(조치 비었음)
    const v = [H,
      줄("김철수", "제주시 1로"),
      줄("이영희", "울릉읍 2로"),
      줄("박민수", "완도군 3로"),
      줄("박민수", "완도군 3로")];
    const r = ssb_islandKeep(v);
    eq("조치 열을 찾는다", r.ok, "true");
    eq("★ 1건씩인 분은 확인 없이 실린다", r.자동, 2);
    eq("실린 줄 수", r.나감, 2);
    eq("★ 2건인 분은 붙든다", r.보류, 2);
    eq("kept 는 머리글 + 실은 줄", r.kept.length, 3);
    eq("누구를 봐야 하는지 말한다", r.확인.map((x) => x.이름 + x.건수).join(","), "박민수2");
  }

  {
    //  2건짜리에 조치를 적으면 나간다
    const v = [H,
      줄("박민수", "완도군 3로", "발송"),
      줄("박민수", "완도군 3로", "발송")];
    const r = ssb_islandKeep(v);
    eq("★ 「발송」을 적으면 2건도 나간다", r.나감, 2);
    eq("붙든 것 없음", r.보류, 0);
    eq("자동으로 나간 건 아니다", r.자동, 0);
  }

  {
    //  ★ 「발송」이 아닌 글자는 안 통한다 ★  보류 탭과 같은 낱말로 통일했다
    const v = [H,
      줄("박민수", "완도군 3로", "O"),
      줄("박민수", "완도군 3로", "O")];
    const r = ssb_islandKeep(v);
    eq("★ O 를 적어도 2건은 안 나간다", r.나감, 0);
    eq("붙든다", r.보류, 2);
    eq("★ 무엇을 적었는지 그대로 알려준다", r.딴말.join(" · "), "박민수 「O」 · 박민수 「O」");
  }

  {
    //  한 분에게 한 줄뿐이면 뭘 적었든 나간다 — 어차피 확인 없이 나가는 줄이다
    const r = ssb_islandKeep([H, 줄("김철수", "제주시 1로", "O")]);
    eq("1건은 O 라도 나간다", r.나감, 1);
    eq("자동으로 친다", r.자동, 1);
    eq("딴말로 안 센다", r.딴말.length, 0);
  }

  {
    //  같은 이름이라도 주소가 다르면 다른 사람이다 (동명이인)
    const v = [H,
      줄("김철수", "제주시 1로"),
      줄("김철수", "울릉읍 9로")];
    const r = ssb_islandKeep(v);
    eq("★ 주소가 다르면 따로 센다", r.자동, 2);
    eq("붙들지 않는다", r.보류, 0);
  }

  {
    //  「조치」 열이 없는 옛 탭은 거르지 않는다 (하나도 안 나가면 그게 제일 나쁘다)
    const v = [H.slice(0, -1), 줄("김철수", "제주시 1로").slice(0, -1)];
    const r = ssb_islandKeep(v);
    eq("★ 조치 열이 없으면 거르지 않는다", r.ok, "false");
  }

  {
    //  사람을 못 가리면 예전처럼 전부 조치를 받는다
    const H2 = H.slice();
    H2[H2.indexOf("거래처명")] = "받는사람";     // 이름이 바뀐 셈
    const r = ssb_islandKeep([H2,
      줄("김철수", "제주시 1로"),
      줄("이영희", "울릉읍 2로")]);
    eq("★ 사람을 못 가리면 전부 붙든다", r.보류, 2);
    eq("그 사실을 알린다", r.사람못가림, "true");
    eq("자동으로 나간 것 없음", r.자동, 0);
  }

  {
    //  세 줄인 분 — 셋 다 붙들고 건수를 그대로 센다
    const v = [H,
      줄("최지우", "흑산도 1로"),
      줄("최지우", "흑산도 1로"),
      줄("최지우", "흑산도 1로"),
      줄("한가람", "제주시 5로")];
    const r = ssb_islandKeep(v);
    eq("세 줄이면 셋 다 붙든다", r.보류, 3);
    eq("혼자 온 분은 그대로 나간다", r.자동, 1);
    eq("건수를 그대로 말한다", r.확인[0].이름 + r.확인[0].건수, "최지우3");
  }
}

console.log(실패 ? "\n실패 " + 실패 + "건" : "\n도서산간 규칙 그대로");
if (실패) process.exit(1);

/* ═══════════════════════════════════════════════════════════════
   미매칭 메꾸기 — 두 탭의 «칸»을 제대로 집는가

   > "응 두 탭 다 읽게 고쳐줘"

   여태 롯데 탭 하나만 읽었다. 로젠으로 갈아탄 뒤 그 탭이 비어서 이 기능은
   늘 「메꿀 재료가 없습니다」만 뱉었다 — 조용히 죽어 있었다.

   두 탭은 머리글이 다르고, 로젠에는 「명」이 둘이다(앞=보내는 쪽, 뒤=받는분).
   앞을 집으면 모든 줄이 「주식회사 팩투유」가 되어 아무와도 안 맞는다.
   오류는 안 난다 — 0건이 될 뿐이다. 그래서 여기서 직접 집어 본다.
   ═══════════════════════════════════════════════════════════════ */
console.log("\n[메꾸기] 두 탭의 칸을 제대로 집는가");
{
  const auto = 읽기(path.join(뿌리, "gasAuto.js"));
  const core = 읽기(path.join(뿌리, "core.js"));
  const 꺼내기 = new Function(
    "Utilities", "SpreadsheetApp", "Logger", "module",
    core + "\n" + auto + "\n" + "return { _ssf_freeCols_: _ssf_freeCols_ };",
  );
  const { _ssf_freeCols_ } = 꺼내기(null, null, { log() {} }, undefined);

  {
    //  롯데 — 이름표가 분명하다
    const rh = ["집하일자", "운송장번호", "주문번호", "수하인명", "상품명"];
    const c = _ssf_freeCols_(rh);
    eq("롯데 운송장", c.inv, 1);
    eq("롯데 주문번호", c.ord, 2);
    eq("롯데 받는분", c.nm, 3);
    eq("롯데 상품명", c.it, 4);
  }

  {
    //  로젠 — 「명」이 둘. 앞(8)은 보내는 쪽, 뒤(14)가 받는분이다
    const rh = ["No.", "집배구분", "접수일자", "집하일자", "집하여부", "송일",
                "배송여부", "코드", "명", "주문번호", "운송장번호", "송장번호구분",
                "집하지점", "배송지점", "명", "우편번호", "주소"];
    const c = _ssf_freeCols_(rh);
    eq("로젠 주문번호 J", c.ord, 9);
    eq("로젠 운송장 K", c.inv, 10);
    eq("★ 로젠 받는분은 «뒤쪽» 명 (앞은 보내는 쪽)", c.nm, 14);
    eq("로젠엔 상품명이 없다 → -1", c.it, -1);
  }

  {
    //  이름 칸이 아예 없으면 -1 — 자리로 떨어지지 않는다
    const c = _ssf_freeCols_(["운송장번호", "주문번호", "우편번호", "주소"]);
    eq("★ 받는분 칸이 없으면 -1", c.nm, -1);
    eq("그래도 운송장은 찾는다", c.inv, 0);
  }

  {
    //  다른 이름표들도 받는다
    eq("「받는분」도 잡는다", _ssf_freeCols_(["운송장번호", "받는분"]).nm, 1);
    eq("「수취인명」도 잡는다", _ssf_freeCols_(["운송장번호", "수취인명"]).nm, 1);
    eq("「송장번호」도 운송장으로 본다", _ssf_freeCols_(["송장번호", "수하인명"]).inv, 0);
  }

  {
    //  «두 탭 다» 읽는다고 코드에 적혀 있는가 — 한 탭으로 되돌아가면 잡는다
    eq("★ 로젠 탭 GID 를 본다", auto.includes("cfg['로젠송장탭GID']"), "true");
    eq("★ 롯데 탭 GID 도 본다", auto.includes("cfg['롯데송장탭GID']"), "true");
    eq("이름 칸을 못 찾으면 건너뛴다", auto.includes("받는분 칸을 못 찾음"), "true");
    eq("어느 탭을 읽었는지 화면에 적는다", auto.includes("읽은말"), "true");
  }
}

console.log(실패 ? "\n실패 " + 실패 + "건" : "\n메꾸기 칸도 그대로");
if (실패) process.exit(1);

/* ═══════════════════════════════════════════════════════════════
   중복점검 — «연속 블록»으로 딸려온 지난 회차를 잡는가

   > "판매현황에서 이전회차건이 실수로 같이 딸려오는경우
   >  (확실한건 고유아이디인데.. 전화주문은 고유아이디가 없다보니)"

   한 줄씩 보면 정상 재주문과 구분이 안 된다. 붙여넣기 범위가 겹쳐 딸려온
   것은 여러 줄이 지난 회차와 «같은 차례로» 이어진다 — 그 이어짐이 증거다.
   고유ID 는 안 본다. 전화주문에는 없기 때문이다.
   ═══════════════════════════════════════════════════════════════ */
console.log("\n[중복점검] 이어진 블록을 잡는가");
{
  const core = 읽기(path.join(뿌리, "core.js"));
  const 꺼내기 = new Function(
    "Utilities", "SpreadsheetApp", "Logger", "module",
    core + "\n" + "return { ssDupRunGroups: ssDupRunGroups };",
  );
  const { ssDupRunGroups } = 꺼내기(null, null, { log() {} }, undefined);

  //  고유ID 는 «일부러» 비운다 — 전화주문이 그렇다
  const 줄 = (회차, 이름, 주소, 코드, 수량 = 1) =>
    ({ 회차, 고유ID: "", 받는분: 이름, 주소, 품목코드: 코드, 수량,
       품목명: 코드, 경로: "로젠택배", 전화: "", 금액: 0 });

  {
    //  어제 4줄 중 «가운데 3줄»이 오늘에 같은 차례로 딸려왔다
    const recs = [
      줄("260913-1", "김철수", "서울 1로", "A"),
      줄("260913-1", "이영희", "서울 2로", "B"),
      줄("260913-1", "박민수", "서울 3로", "C"),
      줄("260913-1", "최지우", "서울 4로", "D"),
      줄("260914-1", "이영희", "서울 2로", "B"),
      줄("260914-1", "박민수", "서울 3로", "C"),
      줄("260914-1", "최지우", "서울 4로", "D"),
      줄("260914-1", "한가람", "서울 9로", "Z"),
    ];
    const g = ssDupRunGroups(recs, "260914", 2);
    eq("★ 이어진 덩이를 찾는다", g.length, 1);
    eq("★ 세 줄이 이어졌다", g[0].길이, 3);
    eq("오늘 줄만 가리킨다", g[0].members.join(","), "4,5,6");
    eq("어느 회차에서 왔는지 말한다", g[0].이전회차, "260913-1");
    eq("회차간으로 표시한다", g[0].회차간, "true");
    eq("확실 등급", g[0].grade, "🔴 확실");
  }

  {
    //  한 줄만 겹치는 건 «정상 재주문»일 수 있다 — 여기서는 안 잡는다
    const recs = [
      줄("260913-1", "김철수", "서울 1로", "A"),
      줄("260914-1", "김철수", "서울 1로", "A"),
      줄("260914-1", "한가람", "서울 9로", "Z"),
    ];
    eq("★ 한 줄은 안 잡는다 (등급 검사의 몫)", ssDupRunGroups(recs, "260914", 2).length, 0);
  }

  {
    //  차례가 다르면 이어진 게 아니다 — 흩어진 재주문
    const recs = [
      줄("260913-1", "김철수", "서울 1로", "A"),
      줄("260913-1", "이영희", "서울 2로", "B"),
      줄("260914-1", "이영희", "서울 2로", "B"),
      줄("260914-1", "한가람", "서울 9로", "Z"),
      줄("260914-1", "김철수", "서울 1로", "A"),
    ];
    eq("★ 차례가 끊기면 안 잡는다", ssDupRunGroups(recs, "260914", 2).length, 0);
  }

  {
    //  수량이 다르면 같은 줄이 아니다
    const recs = [
      줄("260913-1", "김철수", "서울 1로", "A", 1),
      줄("260913-1", "이영희", "서울 2로", "B", 1),
      줄("260914-1", "김철수", "서울 1로", "A", 2),
      줄("260914-1", "이영희", "서울 2로", "B", 1),
    ];
    eq("수량이 다르면 안 이어진다", ssDupRunGroups(recs, "260914", 2).length, 0);
  }

  {
    //  주소가 비면 못 가린다 — 세지 않는다 (엉뚱한 것을 묶느니 조용한 편이 낫다)
    const recs = [
      줄("260913-1", "김철수", "", "A"),
      줄("260913-1", "이영희", "", "B"),
      줄("260914-1", "김철수", "", "A"),
      줄("260914-1", "이영희", "", "B"),
    ];
    eq("★ 가릴 수 없는 줄은 안 센다", ssDupRunGroups(recs, "260914", 2).length, 0);
  }

  {
    //  긴 덩이 하나만 남긴다 — 같은 사실을 두 번 말하지 않는다
    const recs = [
      줄("260912-1", "김철수", "서울 1로", "A"),
      줄("260912-1", "이영희", "서울 2로", "B"),
      줄("260913-1", "김철수", "서울 1로", "A"),
      줄("260913-1", "이영희", "서울 2로", "B"),
      줄("260913-1", "박민수", "서울 3로", "C"),
      줄("260914-1", "김철수", "서울 1로", "A"),
      줄("260914-1", "이영희", "서울 2로", "B"),
      줄("260914-1", "박민수", "서울 3로", "C"),
    ];
    const g = ssDupRunGroups(recs, "260914", 2);
    eq("★ 겹치는 덩이는 긴 것 하나만", g.length, 1);
    eq("세 줄짜리를 남긴다", g[0].길이, 3);
    eq("더 가까운 회차를 가리킨다", g[0].이전회차, "260913-1");
  }

  {
    //  오늘 것이 최소 길이보다 적으면 볼 것이 없다
    eq("오늘이 한 줄이면 그냥 끝", ssDupRunGroups([줄("260914-1", "김", "서울", "A")], "260914", 2).length, 0);
  }
}

console.log(실패 ? "\n실패 " + 실패 + "건" : "\n이어짐도 그대로");
if (실패) process.exit(1);
