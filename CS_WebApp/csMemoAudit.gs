/**
 * ══════════════════════════════════════════════════════════════
 *  업체에게 «보이고 있는» CS 메모를 뽑아 본다  (2026-09-18)
 *  파일: csMemoAudit.gs
 *
 *  왜 만드나
 *    반품카드의 「메모」 단추로 적으면서 「내부」를 체크해도 `[내부]` 가
 *    안 붙는 탈이 있었다(2026-09-18 고침). 창은 「상담」 기준으로
 *    만들어지는데 체크상자를 찾는 이름이 모드를 따라가서, 없는 것을
 *    뒤지다 조용히 넘어갔다.
 *
 *    협력업체 포털은 «기본이 공개»다. 형식이 맞는 비고 줄은 전부
 *    consult 로 보고 내보낸다 (prpLedger.prpPublicTimeline_).
 *    그래서 내부인 줄 알고 적은 글이 업체에게 보였을 수 있다.
 *
 *  ★ 무엇을 알 수 있고 무엇을 모르는가 ★
 *    알 수 있다 : 지금 업체에게 «보이는» 줄이 무엇인지 — 정확히.
 *    모른다     : 그 글을 적을 때 사람이 「내부」를 체크했는지.
 *                 체크 상태는 어디에도 안 남았다. 그러니 이 표는
 *                 «내부였던 글 목록»이 아니라 «지금 보이는 글 목록»이다.
 *                 그중 내부여야 했던 것은 사람이 골라야 한다.
 *
 *    그래서 눈에 걸리는 낱말이 든 줄을 위로 올린다 — 전부 읽지 않아도
 *    되게. 낱말은 아래 _CMA_SUSPECT_ 에 있다.
 *
 *  쓰는 법
 *    Apps Script 편집기에서 csAuditPublicMemos 를 실행한다.
 *    결과는 반품대장에 「CS메모_공개점검」 탭으로 남는다.
 * ══════════════════════════════════════════════════════════════
 */

/** 결과를 남길 탭 */
var _CMA_TAB_ = "CS메모_공개점검";

var _CMA_HEADER_ = [
  "확인", "의심", "탭", "행", "날짜", "시각", "적은이",
  "글", "왜 의심스러운가", "업체", "고객", "처리상태",
];

/**
 * 내부일 법한 낱말.
 * ★ 이것으로 «판정»하지 않는다 ★ 사람이 먼저 볼 것을 위로 올릴 뿐이다.
 * 걸리지 않았다고 공개해도 되는 글이라는 뜻이 아니다.
 */
var _CMA_SUSPECT_ = [
  "원가", "단가", "마진", "매입", "사입", "떼", "정산",
  "내부", "우리끼리", "말하지", "비밀",
  "클레임", "진상", "블랙", "컴플",
  "업체가", "업체는", "업체 탓", "업체잘못", "업체 잘못",
  "손해", "물어", "보상", "환불해주", "그냥 해주",
  "사장님", "대표님", "윗선",
];

/** 포털이 «안 내보내는» 표시 — prpConfig.PRP_INTERNAL_MARK_ 와 같아야 한다 */
var _CMA_INTERNAL_RE_ = /^(?:\[내부\]|#내부|내부\s*[:：])\s*/;

/**
 * 업체에게 보이는 CS 메모를 모아 탭으로 낸다.
 *
 * @param {number=} months 최근 몇 달치를 볼지 (기본 6). 0 이면 전부.
 */
function csAuditPublicMemos(months) {
  var 시작 = Date.now();
  months = (months === undefined || months === null) ? 6 : Number(months);

  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var 탭들 = ss.getSheets();

  /*  탭 이름이 「202609」 꼴이다. 최근 것부터 본다 —
      6분에 걸리더라도 «최근»은 반드시 담기게. */
  var 볼탭 = [];
  for (var t = 0; t < 탭들.length; t++) {
    var nm = 탭들[t].getName();
    if (!/^\d{6}$/.test(nm)) continue;
    볼탭.push(nm);
  }
  볼탭.sort().reverse();
  if (months > 0) 볼탭 = 볼탭.slice(0, months);

  var 줄들 = [];
  var 셈 = { 훑음: 0, 형식없음: 0, 상태: 0, 사진: 0, 업체글: 0, 내부표시: 0, 공개: 0, 의심: 0 };
  var 못본탭 = [];
  var 멈춤 = "";

  for (var i = 0; i < 볼탭.length; i++) {
    if (Date.now() - 시작 > 4 * 60 * 1000) {
      멈춤 = 볼탭.slice(i).join(", ") + " 는 시간이 모자라 못 봤습니다. " +
        "csAuditPublicMemos(" + (볼탭.length - i) + ") 로 나머지만 보세요.";
      break;
    }
    var sh = ss.getSheetByName(볼탭[i]);
    if (!sh || sh.getLastRow() < 2) { 못본탭.push(볼탭[i] + "(비었음)"); continue; }

    var lastCol = Math.max(sh.getLastColumn(), 15);
    var all = sh.getRange(1, 1, sh.getLastRow(), lastCol).getDisplayValues();
    var hIdx = _cs_findReturnHeaderRow_(all);
    if (hIdx < 0) { 못본탭.push(볼탭[i] + "(머리글 못 찾음)"); continue; }
    var col = _cs_mapReturnLedgerCols_(all[hIdx]);
    if (col.notice < 0) { 못본탭.push(볼탭[i] + "(비고 칸 없음)"); continue; }

    for (var r = hIdx + 1; r < all.length; r++) {
      var notice = String(all[r][col.notice] || "");
      if (!notice) continue;
      var vendor = col.vendor >= 0 ? String(all[r][col.vendor] || "").trim() : "";
      var cust = col.name >= 0 ? String(all[r][col.name] || "").trim() : "";
      var st = col.status >= 0 ? String(all[r][col.status] || "").trim() : "";

      var lines = notice.split(/\n/);
      for (var li = 0; li < lines.length; li++) {
        var ln = String(lines[li] || "").trim();
        if (!ln) continue;
        셈.훑음++;

        //  메타 줄 — 포털이 따로 내보낸다
        if (/^반품송장\s*[:：]|^회수송장\s*[:：]/.test(ln)) continue;

        /*  포털과 «같은 자»로 읽는다. 여기서 다르게 읽으면 이 표를 못 믿는다.
            형식: [YYMMDD HH:MM 적은이] 글  */
        var m = ln.match(/^\[(\d{6})\s+(\d{1,2}:\d{2})\s+([^\]]+)\]\s*(.*)$/);
        if (!m) { 셈.형식없음++; continue; }   // 포털도 안 내보낸다

        var who = String(m[3] || "").trim();
        var body = String(m[4] || "").trim();

        if (who.indexOf("업체:") === 0) { 셈.업체글++; continue; }   // 업체가 쓴 글
        if (_CMA_INTERNAL_RE_.test(body)) { 셈.내부표시++; continue; } // 안 나간다
        if (/^상태→/.test(body)) { 셈.상태++; continue; }             // 상태는 원래 공개
        if (/^사진\s*첨부/.test(body) && /https?:\/\//.test(body)) { 셈.사진++; continue; }

        //  여기까지 왔으면 포털이 «CS팀 상담»으로 내보내는 줄이다
        셈.공개++;
        var 걸린낱말 = [];
        for (var k = 0; k < _CMA_SUSPECT_.length; k++) {
          if (body.indexOf(_CMA_SUSPECT_[k]) >= 0) 걸린낱말.push(_CMA_SUSPECT_[k]);
        }
        if (걸린낱말.length) 셈.의심++;

        줄들.push([
          false,
          걸린낱말.length ? "★" : "",
          볼탭[i], r + 1,
          m[1], m[2], who,
          body.substring(0, 500),
          걸린낱말.join(" · "),
          vendor, cust, st,
        ]);
      }
    }
  }

  //  의심스러운 것부터, 그 다음 최근 것부터
  줄들.sort(function (a, b) {
    if ((a[1] ? 1 : 0) !== (b[1] ? 1 : 0)) return a[1] ? -1 : 1;
    return String(b[4] + b[5]).localeCompare(String(a[4] + a[5]));
  });

  //  탭에 쓴다
  var out = ss.getSheetByName(_CMA_TAB_);
  if (!out) out = ss.insertSheet(_CMA_TAB_);
  out.clear();
  out.getRange(1, 1, 1, _CMA_HEADER_.length).setValues([_CMA_HEADER_]);
  out.getRange("1:1").setBackground("#7f1d1d").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center");
  out.setFrozenRows(1);
  if (줄들.length) {
    out.getRange(2, 1, 줄들.length, _CMA_HEADER_.length).setValues(줄들);
    out.getRange(2, 1, 줄들.length, 1).insertCheckboxes();
    //  의심 줄은 바탕을 달리해 눈에 걸리게
    for (var z = 0; z < 줄들.length; z++) {
      if (줄들[z][1] === "★") {
        out.getRange(2 + z, 2, 1, _CMA_HEADER_.length - 1).setBackground("#fff4e5");
      }
    }
  }
  out.setColumnWidth(8, 520);
  out.setColumnWidth(9, 200);

  var NL = String.fromCharCode(10);
  var 말 = [];
  말.push("🔎 업체에게 «보이는» CS 메모 점검");
  말.push("");
  말.push("본 탭 : " + 볼탭.join(", ") + (못본탭.length ? "   (못 봄: " + 못본탭.join(", ") + ")" : ""));
  말.push("훑은 줄 : " + 셈.훑음);
  말.push("");
  말.push("★ 업체에게 보이는 CS 상담글 : " + 셈.공개 + "줄");
  말.push("   그중 눈에 걸리는 낱말이 든 것 : " + 셈.의심 + "줄  ← 먼저 보세요");
  말.push("");
  말.push("안 나가는 것 —");
  말.push("   [내부] 가 붙은 줄 : " + 셈.내부표시);
  말.push("   형식이 없는 옛 줄 : " + 셈.형식없음);
  말.push("   업체가 쓴 글       : " + 셈.업체글);
  말.push("원래 공개인 것 —");
  말.push("   상태 바뀜 : " + 셈.상태 + "   사진 : " + 셈.사진);
  말.push("");
  말.push("결과 탭 : 「" + _CMA_TAB_ + "」");
  말.push("");
  말.push("※ 「내부」를 체크했는지는 어디에도 안 남았습니다.");
  말.push("   그래서 이 표는 «내부였던 글 목록»이 아니라");
  말.push("   «지금 업체에게 보이는 글 목록»입니다.");
  말.push("   숨기려면 그 줄 맨 앞에 [내부] 를 붙이면 즉시 안 나갑니다.");
  if (멈춤) { 말.push(""); 말.push("※ " + 멈춤); }

  var 글 = 말.join(NL);
  Logger.log(글);
  try { SpreadsheetApp.getUi().alert(글); } catch (e) {}
  return 글;
}

/** 최근 3개월만 빠르게 */
function csAuditPublicMemosRecent() { return csAuditPublicMemos(3); }

/** 전부 (오래 걸린다 — 6분에 걸리면 안내가 나온다) */
function csAuditPublicMemosAll() { return csAuditPublicMemos(0); }
