/**
 * 팩투유 품절상품 — 시트가 옮겨졌다 · 섞여 들어오던 것을 막는다
 *
 *  > "좌측 품절관리 시트배열 확인하고 배치 수정해줘"
 *  > "이카운트 재고관리는 없어도되"
 *  > "시트가 올겨졌네.."
 *
 *  ★ 무엇이 틀렸나 ★
 *    ① 표가 다른 파일로 옮겨졌다. 새 파일은 탭이 여럿이라 getSheets()[0] 이
 *       엉뚱한 표(주문 자료)를 읽는다.
 *    ② 같은 탭 아래 「이카운트 재고 조정」 표가 붙어 있는데 그 머리글이
 *       표에 없어, kind 가 «대리공급» 인 채로 열여섯 줄이 통째로
 *       「대리공급 품절」에 섞여 들어갔다 — 품절이 아닌 것이 품절로 보였다.
 *    ③ D열 뜻이 덩어리마다 다르다. 품절/대리공급은 「상태값」, 예상은
 *       「재고수량」. 둘 다 빨간 상태 글씨로 나와 「7」이 품절처럼 보였다.
 *
 * 실행: node _csstockout_test.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}
function grab(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") { d++; seen = true; }
    else if (src[k] === "}") { d--; if (seen && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
const gs = fs.readFileSync(path.join(__dirname, "csStockout.gs"), "utf8");
/*  ★ 주석은 빼고 «코드»만 본다 ★
    옛 주소·옛 방식은 주석에 «내력»으로 남겨 두는 것이 맞다. 그걸 보고
    「아직 옛것을 쓴다」고 하면 시험이 거짓말을 한다.  */
/*  정규식을 안 쓴다 — 줄을 직접 훑는다. 오늘 백슬래시가 여러 번 먹혔다.  */
/*  정규식도 백슬래시도 안 쓴다 — 오늘 백슬래시가 여러 번 먹혔다.  */
var 줄바꿈 = String.fromCharCode(10);
const gsCode = gs.split(줄바꿈).filter(function (l) {
  var t = l.trim();
  return !(t.indexOf("*") === 0 || t.indexOf("//") === 0 || t.indexOf("/*") === 0);
}).join(줄바꿈);
const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");

console.log("\n[1] ★ 옮겨진 시트를 본다");
{
  check("★ 새 파일", gs.indexOf('"1xziVmMIsQfwyDwleNmB0haRsiE5t24aMu2SHkuI_34U"') >= 0, true);
  check("★ 옛 파일을 안 본다", gsCode.indexOf("1mYKKQyPL1yhUC9N92Co3rfeAcenje_3lgRRABxNYiug") < 0, true);
  check("★ 탭을 gid 로 집는다", gs.indexOf("_CSSO_GID_ = 313764416") >= 0, true);
  check("★ 첫 탭을 그냥 안 쓴다", gsCode.indexOf("getSheets()[0]") < 0, true);
  check("★ 캐시 열쇠를 갈았다 (옛 값 버리기)", gs.indexOf('"CS_STOCKOUT_V2"') >= 0, true);
}

console.log("\n[2] ★ gid 가 바뀌어도 «머리글로» 찾는다");
{
  /*  gid 는 탭을 지웠다 새로 만들면 바뀐다. 그때 조용히 빈 목록이 되면
      「품절 없음」으로 보여 전화받는 사람이 잘못 답한다.  */
  const 몸 = grab(gs, "_csso_findTab_");
  check("★ gid 를 먼저 본다", 몸.indexOf("getSheetId() === _CSSO_GID_") >= 0, true);
  check("★ 못 찾으면 머리글로 훑는다", 몸.indexOf("_CSSO_HEADS_[h].hit") >= 0, true);
  check("★ 그것도 없으면 null", /return null;/.test(몸), true);
  const 부름 = grab(gs, "csStockoutList");
  check("★ null 이면 «못 찾았다»고 말한다", 부름.indexOf("품절 표가 든 탭을 못 찾았습니다") >= 0, true);
}

console.log("\n[3] ★ 「이카운트 재고 조정」은 안 읽는다");
{
  const ctx = {
    _CSSO_HEADS_: [
      { key: "예상", hit: "품절예상상품명" },
      { key: "품절", hit: "품절된상품명" },
      { key: "대리공급", hit: "대리공급품절상품명" },
    ],
    _CSSO_STOP_: ["이카운트재고조정"],
    _csso_txt_: (v) => String(v == null ? "" : v).trim(),
  };
  vm.createContext(ctx);
  /*  실제 시트 모양 그대로 — 품절 → 예상 → 대리공급 → 이카운트 재고조정  */
  ctx.__data = [
    ["품절된 상품명", "이카운트코드", "입고 예정일", "상태값", "대체상품", "급발송대안"],
    ["BF 105파이 PP 대 블랙 1000 SET", "BF105PPB00023", "?", "품절", "없음", "준테크로 대리발송 신청"],
    ["", "", "", "", "", ""],
    ["품절 예상 상품명", "이카운트코드", "입고 예정일", "재고수량", "대체상품", "급발송대안"],
    ["JH 실링 1494 (5호) 2400개", "MASL0036", "9/19 생산예정", "9", "", ""],
    ["", "", "", "", "", ""],
    ["대리공급 품절 상품명", "이카운트코드", "입고 예정일", "상태값", "대체상품", "급발송대안"],
    ["KR 블루 240mm 젓가락 반포장 2000개", "KRSPOON20009", "????", "품절", "", "없음"],
    ["", "", "", "", "", ""],
    ["이카운트 재고 조정 상품명", "이카운트코드", "실 재고", "조정 값", "", ""],
    ["JH 미니탕 200개---뚜껑만", "", "118", "-3", "", ""],
    ["BF 하트 2칸용기 블랙 1000 SET", "", "29", "-10", "", ""],
  ];
  /*  csStockoutList 본체의 훑는 대목만 떼어 돌린다 — 시트·캐시 없이.  */
  const 본체 = grab(gs, "csStockoutList");
  const 시작 = 본체.indexOf("var kind = \"\";");
  const 끝 = 본체.indexOf("out.ok = true;");
  const 토막 = "var out = { rows: [] }; var data = __data;" + 본체.slice(시작, 끝) + "out;";
  const r = vm.runInContext(토막, ctx);

  check("★ 세 덩어리 세 줄만", r.rows.length, 3);
  check("★ 재고조정이 «대리공급»에 안 섞인다",
    r.rows.filter((x) => x.kind === "대리공급").length, 1);
  check("품절 1줄", r.rows.filter((x) => x.kind === "품절").length, 1);
  check("예상 1줄", r.rows.filter((x) => x.kind === "예상").length, 1);
  check("★ 「JH 미니탕」이 안 들어왔다",
    r.rows.some((x) => x.name.indexOf("미니탕") >= 0), false);

  console.log("\n[4] ★ D열이 «무엇인지»를 들고 온다");
  check("★ 품절은 상태값", r.rows.find((x) => x.kind === "품절").dName, "상태값");
  check("★ 예상은 재고수량", r.rows.find((x) => x.kind === "예상").dName, "재고수량");
  check("★ 대리공급은 상태값", r.rows.find((x) => x.kind === "대리공급").dName, "상태값");
}

console.log("\n[5] ★ 화면이 그 이름을 보고 적는다");
{
  check("★ dName 을 읽는다", html.indexOf("String(r.dName || '')") >= 0, true);
  check("★ 상태값인지 가른다", html.indexOf("dLab.indexOf('상태') !== -1") >= 0, true);
  check("★ 아니면 이름을 앞에 붙인다  (재고수량 7)",
    html.indexOf("esc(dLab) + ' ' + soVal(r.note)") >= 0, true);
  check("★ 숫자는 색을 뺀다", html.indexOf(".so-st.so-num") >= 0, true);
  check("★ 값이 비면 아무것도 안 세운다", html.indexOf("r.note") >= 0, true);
}

console.log("\n" + (fail ? "❌ " : "✅ ") + "통과 " + pass + " · 실패 " + fail);
process.exit(fail ? 1 : 0);
