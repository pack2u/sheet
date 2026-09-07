/**
 * ══════════════════════════════════════════════════════════════
 *  [협력업체] 명세서 — 중앙 수집 → 업체별 분배
 *  파일: _partnerStatementDispatch.gs
 *  2026-09-07
 *
 *  ★ 왜 중앙에서 한 번만 수집하나 ★
 *    Gmail 은 업체를 구분하지 않는다. 첨부 있는 메일을 전부 가져가고
 *    처리한 스레드에 라벨(P2U_명세처리완료)을 붙인다.
 *    그래서 업체 파일마다 수집을 돌리면 **먼저 도는 업체가 남의 명세서까지
 *    가져가고 라벨까지 붙여** 나머지 업체는 영영 못 받는다.
 *
 *    그래서 수집은 여기서 한 번만 한다. 메일마다 업체를 가려
 *    각 협력업체 파일 「명세서_원본」에 나눠 넣는다.
 *    업체 파일에는 자기 명세서만 들어간다 — 결과는 "업체 파일마다 각각"이다.
 *
 *  ★ 못 가린 메일은 라벨을 안 붙인다 ★
 *    라벨을 붙이면 다시는 안 잡힌다. 판별 실패는 조용히 사라지면 안 되므로
 *    라벨 없이 남기고 「명세서_수집로그」와 알림에 올린다.
 *    사전(별칭)을 고치고 다시 돌리면 그대로 들어간다.
 *
 *  ★ 흐름 ★
 *    16:40 트리거 → partnerCollectStatementsDaily()
 *      ① 업체 사전·학습표 읽기
 *      ② Gmail 검색 → 첨부에서 표 추출
 *      ③ 표 내용으로 업체 판별 (사업자번호 > 거래처코드 > 상호 > 학습)
 *      ④ 해당 업체 파일 「명세서_원본」에 추가 + 발신주소 학습 + 라벨
 *      ⑤ 허브 「명세서_수집로그」 기록 + Chat 알림
 * ══════════════════════════════════════════════════════════════
 */

var _PSTMTD_LOG_TAB_ = "명세서_수집로그";

/** 한 번에 볼 스레드 수. 자동은 넉넉히 — 하루치를 놓치면 안 된다. */
var _PSTMTD_SCAN_AUTO_ = 40;
var _PSTMTD_SCAN_MANUAL_ = 60;

/** 판별용 본문은 앞쪽만 본다. 사업자번호·상호는 머리글 근처에 있다. */
var _PSTMTD_ID_ROWS_ = 40;

// ───────────────────────────────────────────────────────────
//  진입점
// ───────────────────────────────────────────────────────────

/** 16:40 트리거 — 자동 수집 */
function partnerCollectStatementsDaily() {
  return _pstmtd_run_(false);
}

/** [메뉴] 지금 수집 */
function partnerCollectStatementsNow() {
  var text = _pstmtd_run_(true);
  try {
    SpreadsheetApp.getUi().alert("명세서 수집", text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
  return text;
}

// ───────────────────────────────────────────────────────────
//  본체
// ───────────────────────────────────────────────────────────

function _pstmtd_run_(isManual) {
  var t0 = new Date().getTime();
  var stat = {
    scanned: 0,      // 본 메일
    tabled: 0,       // 표로 읽힌 첨부
    placed: 0,       // 업체 파일에 넣은 메일
    rows: 0,         // 넣은 행
    unknown: 0,      // 업체 못 가림
    unreadable: 0,   // 명세서인데 PDF·JPG 라 표로 못 읽음
    noFile: 0,       // 업체는 가렸으나 파일이 없음
    learned: 0,      // 발신주소 학습
    byVendor: {},    // 접두 → 행수
    unknownList: [],
    unreadableList: [],
    errors: [],
  };

  // ① 사전
  var dir;
  try {
    dir = _pstmtv_loadDirectory_();
  } catch (eD) {
    return _pstmtd_finish_(stat, t0, "업체 사전 읽기 실패: " + eD.message);
  }
  if (!dir.count) {
    // 사전 없이 돌면 전부 '판별 실패'가 되고, 그 사이 라벨은 안 붙으니 손실은 없다.
    // 그래도 헛돌 이유가 없으므로 여기서 멈추고 무엇을 해야 하는지 알린다.
    return _pstmtd_finish_(
      stat, t0,
      "업체 사전이 비어 있습니다.\n메뉴 「📋 명세서 정리 → 🏷 업체 사전 새로 만들기」 를 먼저 실행하세요."
    );
  }

  var learn = {};
  try {
    learn = _pstmtv_loadLearn_();
  } catch (eL) {
    stat.errors.push("학습표: " + eL.message);
  }

  // ② Gmail
  var processedLabel = null;
  try {
    processedLabel = _pstmt_getOrCreateGmailLabel_(_PSTMT_GMAIL_PROCESSED_LABEL_);
  } catch (eLb) {
    stat.errors.push("라벨 준비: " + eLb.message);
  }

  var threads = [];
  try {
    threads = GmailApp.search(
      _PSTMT_GMAIL_SEARCH_BASE_, 0,
      isManual ? _PSTMTD_SCAN_MANUAL_ : _PSTMTD_SCAN_AUTO_
    );
  } catch (eS) {
    return _pstmtd_finish_(stat, t0, "Gmail 검색 실패: " + eS.message);
  }

  // 파일은 한 번만 연다. 같은 업체 메일이 여러 통이어도 열기는 한 번이다.
  var ssCache = {};

  for (var ti = 0; ti < threads.length; ti++) {
    // 6분 제한. 남은 메일은 라벨이 없어 다음 실행에서 그대로 잡힌다.
    if (new Date().getTime() - t0 > 270000) {
      stat.errors.push("시간 초과로 중단 — 남은 메일은 다음 실행에서 처리됩니다.");
      break;
    }

    var thread = threads[ti];
    var msgs;
    try {
      msgs = thread.getMessages();
    } catch (eM) {
      stat.errors.push("스레드 읽기: " + eM.message);
      continue;
    }

    var threadPlaced = 0;
    var threadPending = 0;

    for (var mi = 0; mi < msgs.length; mi++) {
      var msg = msgs[mi];
      try {
        if (_pstmt_msgHasLabel_(msg, _PSTMT_GMAIL_PROCESSED_LABEL_)) continue;
      } catch (eH) {}

      stat.scanned++;

      var parsed;
      try {
        parsed = _pstmt_extractStatementFromMessage_(msg);
      } catch (eP) {
        stat.errors.push("첨부 읽기: " + eP.message);
        continue;
      }
      if (!parsed || !parsed.rows || !parsed.rows.length) {
        // ★ 표로 안 읽히는 명세서를 조용히 넘기지 않는다 (2026-09-07) ★
        //   실제 메일을 보니 첨부가 PDF·JPG 였다(웹캐시 비즈메일 JPG,
        //   매직빌 PDF). 지금 파서는 xlsx·xls·텍스트만 읽어서 rows 가 0이다.
        //   그냥 넘기면 "배정 0통"만 남고 왜 0인지 알 수 없다.
        //
        //   그래서 제목·첨부파일명으로 업체를 한 번 더 가려 본다.
        //   업체가 잡히면 그건 "명세서인데 못 읽은 것"이다 — 반드시 보고한다.
        //   안 잡히면 명세서가 아닌 첨부(도면·송장 등)이므로 조용히 넘긴다.
        var meta0 = (parsed && parsed.meta) || {};
        var names0 = [];
        try {
          var atts0 = msg.getAttachments();
          for (var an = 0; an < atts0.length; an++) names0.push(atts0[an].getName());
        } catch (eAt) {}
        var subj0 = "";
        try { subj0 = msg.getSubject() || ""; } catch (eSb) {}

        var who0 = null;
        try {
          who0 = _pstmtv_identify_(
            {
              from: meta0.from || msg.getFrom(),
              subject: subj0,
              fileName: names0.join(" "),
              text: subj0 + " " + names0.join(" "),
            },
            dir, learn
          );
        } catch (eI0) {}

        if (who0 && who0.pfx) {
          stat.unreadable++;
          stat.unreadableList.push({
            pfx: who0.pfx,
            name: who0.name,
            from: who0.addr,
            subject: subj0,
            file: names0.join(", "),
          });
        }
        continue;
      }
      stat.tabled++;

      // ③ 판별
      var idText = _pstmtd_rowsToText_(parsed.rows);
      var who;
      try {
        who = _pstmtv_identify_(
          {
            from: parsed.meta.from,
            subject: parsed.meta.subject,
            fileName: parsed.meta.fileName,
            text: idText,
          },
          dir, learn
        );
      } catch (eI) {
        stat.errors.push("판별: " + eI.message);
        continue;
      }

      if (!who.pfx) {
        stat.unknown++;
        threadPending++;
        stat.unknownList.push({
          from: who.addr || parsed.meta.from,
          subject: parsed.meta.subject,
          file: parsed.meta.fileName,
          date: parsed.meta.date,
        });
        continue; // ★ 라벨 안 붙임 — 사전 고치고 다시 돌리면 들어온다
      }

      var ent = dir.byPfx[who.pfx];
      if (!ent || !ent.fileId) {
        stat.noFile++;
        threadPending++;
        stat.errors.push(
          "[" + who.pfx + " " + who.name + "] 협력업체 파일을 못 찾음 — 사전의 파일ID 확인"
        );
        continue; // 넣을 곳이 없으니 라벨도 안 붙인다
      }

      // ④ 업체 파일에 넣기
      var vss = ssCache[ent.fileId];
      if (!vss) {
        try {
          vss = SpreadsheetApp.openById(ent.fileId);
          ssCache[ent.fileId] = vss;
        } catch (eO) {
          stat.noFile++;
          threadPending++;
          stat.errors.push("[" + ent.name + "] 파일 열기 실패: " + eO.message);
          continue;
        }
      }

      // 명세서 탭이 없으면 만든다. 신규 업체 때문에 수집이 멈추면 안 된다.
      if (!vss.getSheetByName(_PSTMT_TAB_RAW)) {
        try {
          _pstmt_ensureAllTabs_(vss, false);
        } catch (eT) {
          stat.errors.push("[" + ent.name + "] 명세서 탭 생성 실패: " + eT.message);
          threadPending++;
          continue;
        }
      }

      var appended = 0;
      try {
        appended = _pstmt_appendRawRows_(vss, parsed.rows, {
          channel: "gmail",
          meta: parsed.meta,
        });
      } catch (eA) {
        stat.errors.push("[" + ent.name + "] 원본 기록 실패: " + eA.message);
        threadPending++;
        continue;
      }
      if (appended <= 0) {
        threadPending++;
        continue;
      }

      stat.placed++;
      stat.rows += appended;
      stat.byVendor[who.pfx] = (stat.byVendor[who.pfx] || 0) + appended;
      threadPlaced++;

      // 발신주소 학습 — 본문으로 확정했을 때만.
      // 학습으로 붙인 건을 다시 학습하면 틀린 학습이 스스로 굳는다.
      if (who.basis.indexOf("학습") !== 0) {
        try {
          _pstmtv_learn_(who.addr, who.pfx, who.name, who.basis);
          stat.learned++;
        } catch (eLn) {
          stat.errors.push("학습 기록: " + eLn.message);
        }
      }

      _pstmtd_log_(vss, ent, who, parsed, appended);
    }

    // 스레드 전체가 처리됐을 때만 라벨. 한 통이라도 남으면 안 붙인다.
    if (threadPlaced > 0 && threadPending === 0 && processedLabel) {
      try {
        thread.addLabel(processedLabel);
      } catch (eLab) {
        stat.errors.push("라벨: " + eLab.message);
      }
    }
  }

  return _pstmtd_finish_(stat, t0, "");
}

// ───────────────────────────────────────────────────────────
//  보조
// ───────────────────────────────────────────────────────────

/** 표 앞부분을 판별용 문자열로 — 사업자번호·상호는 머리글 근처에 있다 */
function _pstmtd_rowsToText_(rows) {
  var n = Math.min(rows.length, _PSTMTD_ID_ROWS_);
  var buf = [];
  for (var i = 0; i < n; i++) {
    buf.push(rows[i].join(" "));
  }
  return buf.join("\n");
}

/** 허브 수집로그 한 줄 */
function _pstmtd_log_(vss, ent, who, parsed, appended) {
  try {
    var hub = SpreadsheetApp.openById(_PT.INFO_SS_ID);
    var tab = hub.getSheetByName(_PSTMTD_LOG_TAB_);
    if (!tab) {
      tab = hub.insertSheet(_PSTMTD_LOG_TAB_);
      var head = ["수집시각", "메일일자", "접두", "업체명", "판별근거", "발신주소", "첨부", "행수", "제목"];
      tab.getRange(1, 1, 1, head.length).setValues([head])
        .setFontWeight("bold").setBackground("#f1f3f4");
      tab.setFrozenRows(1);
    }
    tab.appendRow([
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
      parsed.meta.date
        ? Utilities.formatDate(parsed.meta.date, "Asia/Seoul", "yyyy-MM-dd")
        : "",
      who.pfx,
      ent.name,
      who.basis,
      who.addr,
      parsed.meta.fileName,
      appended,
      String(parsed.meta.subject || "").substring(0, 60),
    ]);
  } catch (e) {
    Logger.log("[PSTMTD] 로그 실패: " + e.message);
  }
}

function _pstmtd_finish_(stat, t0, fatal) {
  var secs = Math.round((new Date().getTime() - t0) / 1000);
  var L = ["═══ 명세서 수집 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm") + " · " + secs + "초", ""];

  if (fatal) {
    L.push("★ " + fatal);
    var ftext = L.join("\n");
    Logger.log(ftext);
    try {
      _chat_sendCard_("📋 명세서 수집 실패",
        Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
        [{ label: "원인", value: fatal.split("\n")[0] }]);
    } catch (e) {}
    return ftext;
  }

  L.push("메일 " + stat.scanned + "통 · 명세서 " + stat.tabled + "통");
  L.push("배정 " + stat.placed + "통 / " + stat.rows + "행");
  L.push("");

  var pfxs = Object.keys(stat.byVendor).sort();
  if (pfxs.length) {
    L.push("[업체별]");
    for (var i = 0; i < pfxs.length; i++) {
      L.push("  " + pfxs[i] + "  " + stat.byVendor[pfxs[i]] + "행");
    }
    L.push("");
  }

  if (stat.unknown) {
    L.push("★ 업체 못 가림 " + stat.unknown + "통 — 라벨을 안 붙였으니 사라지지 않습니다.");
    for (var u = 0; u < Math.min(stat.unknownList.length, 8); u++) {
      var x = stat.unknownList[u];
      L.push("    " + String(x.from).substring(0, 34) + " · " + String(x.file).substring(0, 26));
    }
    L.push("  → 「명세서_업체사전」 별칭 열에 명세서에 찍히는 상호를 추가한 뒤 다시 실행하세요.");
    L.push("");
  }
  if (stat.noFile) {
    L.push("★ 업체는 가렸으나 파일 없음 " + stat.noFile + "통 — 사전의 파일ID 확인");
    L.push("");
  }
  if (stat.unreadable) {
    L.push("★ 명세서인데 표로 못 읽음 " + stat.unreadable + "통 (첨부가 PDF·JPG)");
    for (var v = 0; v < Math.min(stat.unreadableList.length, 8); v++) {
      var y = stat.unreadableList[v];
      L.push("    " + y.pfx + " " + y.name + " · " + String(y.file).substring(0, 40));
    }
    L.push("  → 파서가 xlsx·xls·텍스트만 읽습니다. 이 업체들은 아직 수동입니다.");
    L.push("");
  }
  if (stat.learned) {
    L.push("발신주소 학습 " + stat.learned + "건 (쌓일수록 판별이 빨라집니다)");
    L.push("");
  }
  if (stat.errors.length) {
    L.push("[오류 " + stat.errors.length + "]");
    for (var e2 = 0; e2 < Math.min(stat.errors.length, 8); e2++) {
      L.push("  " + stat.errors[e2]);
    }
  }

  var text = L.join("\n");
  Logger.log(text);

  try {
    var kv = [
      { label: "📥 배정", value: stat.placed + "통 / " + stat.rows + "행" },
      { label: "🏢 업체", value: pfxs.length ? pfxs.join(", ") : "없음" },
    ];
    if (stat.unreadable) kv.push({ label: "📄 못 읽은 명세서", value: stat.unreadable + "통 (PDF·JPG)" });
    if (stat.unknown) kv.push({ label: "❓ 업체 못 가림", value: stat.unknown + "통 (라벨 미부착)" });
    if (stat.noFile) kv.push({ label: "📁 파일 없음", value: stat.noFile + "통" });
    if (stat.errors.length) kv.push({ label: "❌ 오류", value: stat.errors.length + "건" });
    _chat_sendCard_(
      "📋 거래명세서 수집",
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"),
      kv,
      stat.unknown ? "못 가린 메일은 사전 별칭 보완 후 재실행하면 들어갑니다" : ""
    );
  } catch (eC) {}

  return text;
}
