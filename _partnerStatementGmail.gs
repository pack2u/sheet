/**
 * [협력업체] 명세서 정리 — Gmail 첨부 수집 (업체 무관 범용)
 * 파일: _partnerStatementGmail.gs
 *
 * 발신 업체 필터 없이 첨부 있는 메일만 수집 → 현재 시트 「명세서_원본」에 적재
 */

var _PSTMT_GMAIL_PROCESSED_LABEL_ = "P2U_명세처리완료";
var _PSTMT_GMAIL_SEARCH_BASE_ = "has:attachment -label:P2U_명세처리완료 newer_than:14d";

/** 메뉴 — 현재 스프레드시트에 Gmail 명세 첨부 적재 */
function partnerFetchStatementFromGmail() {
  partnerFetchStatementFromGmail_(true);
}

function partnerFetchStatementFromGmail_(isManual) {
  var ui = null;
  if (isManual) {
    try {
      ui = SpreadsheetApp.getUi();
    } catch (e) {}
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    if (ui) ui.alert("⚠️ 다른 작업 실행 중입니다. 잠시 후 다시 시도하세요.");
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    _pstmt_ensureAllTabs_(ss, false);
    var result = _pstmt_processStatementMails_(ss, isManual);

    var msg =
      "📧 Gmail 명세 수집\n\n" +
      "처리 메일: " + result.mailCount + "건\n" +
      "적재 행: " + result.rowCount + "행\n" +
      "스킵: " + result.skipped + "건";

    if (result.details.length) {
      msg += "\n\n" + result.details.slice(0, 8).join("\n");
    }
    if (result.errors.length) {
      msg += "\n\n⚠️ " + result.errors.slice(0, 5).join("\n");
    }
    if (result.mailCount === 0) {
      msg =
        "📧 Gmail 명세 수집\n\n" +
        "미처리 첨부 메일이 없습니다.\n" +
        "(라벨 「" + _PSTMT_GMAIL_PROCESSED_LABEL_ + "」 제외, 최근 14일)";
    }

    _pstmt_log_(ss, "gmail", "mail=" + result.mailCount + " rows=" + result.rowCount);
    if (ui) ui.alert(msg);
  } catch (e) {
    _pstmt_log_(ss, "gmail", "FAIL " + e.message);
    if (ui) ui.alert("❌ Gmail 수집 실패: " + (e.message || e));
  } finally {
    lock.releaseLock();
  }
}

/** 허브에서 — 미처리 메일 목록만 점검 (적재 없음) */
function partnerDiagnoseStatementGmail() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];
  try {
    var label = _pstmt_getOrCreateGmailLabel_(_PSTMT_GMAIL_PROCESSED_LABEL_);
    lines.push("처리라벨: " + (label ? label.getName() : "(생성 실패)"));
    lines.push("검색: " + _PSTMT_GMAIL_SEARCH_BASE_);

    var threads = GmailApp.search(_PSTMT_GMAIL_SEARCH_BASE_, 0, 20);
    lines.push("미처리 스레드(최대20): " + threads.length + "건");
    for (var ti = 0; ti < Math.min(threads.length, 10); ti++) {
      var msgs = threads[ti].getMessages();
      var last = msgs[msgs.length - 1];
      lines.push(
        " · " +
          last.getDate().toLocaleDateString("ko-KR") +
          " | " +
          last.getFrom().substring(0, 40) +
          " | " +
          last.getSubject().substring(0, 50)
      );
    }
    lines.push("");
    lines.push("적재: 업체 시트 열고 「📋 명세서 정리 → Gmail 첨부 수집」");
    ui.alert("🧪 Gmail 명세 점검\n\n" + lines.join("\n"));
  } catch (e) {
    ui.alert("점검 오류: " + e.message);
  }
}

// ═══════════════════════════════════════════
//  내부
// ═══════════════════════════════════════════

function _pstmt_processStatementMails_(ss, isManual) {
  var out = {
    mailCount: 0,
    rowCount: 0,
    skipped: 0,
    details: [],
    errors: [],
  };

  var processedLabel = _pstmt_getOrCreateGmailLabel_(_PSTMT_GMAIL_PROCESSED_LABEL_);
  var threads = GmailApp.search(_PSTMT_GMAIL_SEARCH_BASE_, 0, isManual ? 15 : 5);

  for (var ti = 0; ti < threads.length; ti++) {
    var thread = threads[ti];
    var msgs = thread.getMessages();
    for (var mi = 0; mi < msgs.length; mi++) {
      var msg = msgs[mi];
      if (_pstmt_msgHasLabel_(msg, _PSTMT_GMAIL_PROCESSED_LABEL_)) continue;

      var parsed = _pstmt_extractStatementFromMessage_(msg);
      if (!parsed.rows.length) {
        out.skipped++;
        continue;
      }

      var appended = _pstmt_appendRawRows_(ss, parsed.rows, {
        channel: "gmail",
        meta: parsed.meta,
      });
      if (appended <= 0) {
        out.skipped++;
        continue;
      }

      out.mailCount++;
      out.rowCount += appended;
      out.details.push(
        "✅ " +
          parsed.meta.from.substring(0, 30) +
          " · " +
          parsed.meta.fileName +
          " (" +
          appended +
          "행)"
      );

      try {
        if (processedLabel) thread.addLabel(processedLabel);
        var settingsTab = ss.getSheetByName(_PSTMT_TAB_SETTINGS);
        if (settingsTab) settingsTab.getRange("B9").setValue("gmail");
      } catch (eLab) {
        out.errors.push("라벨: " + eLab.message);
      }
    }
  }

  return out;
}

function _pstmt_extractStatementFromMessage_(msg) {
  var meta = {
    from: msg.getFrom() || "",
    subject: msg.getSubject() || "",
    date: msg.getDate(),
    fileName: "",
  };
  var rows = [];

  var attachments = msg.getAttachments();
  for (var ai = 0; ai < attachments.length; ai++) {
    var att = attachments[ai];
    var name = att.getName() || "attachment";
    var lower = name.toLowerCase();
    var data = null;

    if (lower.indexOf(".xlsx") !== -1 || lower.indexOf(".xls") !== -1) {
      data = _pstmt_readSpreadsheetAttachment_(att);
    } else if (
      lower.indexOf(".csv") !== -1 ||
      lower.indexOf(".txt") !== -1 ||
      att.getContentType().indexOf("text/") !== -1
    ) {
      data = _pstmt_readTextAttachmentAsRows_(att);
    } else if (lower.indexOf(".pdf") !== -1 || lower.indexOf(".png") !== -1 || lower.indexOf(".jpg") !== -1) {
      continue;
    }

    if (data && data.length >= 2) {
      meta.fileName = name;
      rows = data;
      break;
    }
  }

  if (!rows.length) {
    var bodyPairs = _pstmt_tryBodyAsTable_(msg);
    if (bodyPairs.length >= 2) {
      meta.fileName = "(본문)";
      rows = bodyPairs;
    }
  }

  return { rows: rows, meta: meta };
}

function _pstmt_readSpreadsheetAttachment_(blob) {
  var temp = null;
  try {
    temp = DriveApp.createFile(blob);
    var converted = temp.getAs(MimeType.GOOGLE_SHEETS);
    var ss = SpreadsheetApp.open(converted);
    var sheet = ss.getSheets()[0];
    var data = sheet.getDataRange().getDisplayValues();
    try {
      DriveApp.getFileById(ss.getId()).setTrashed(true);
    } catch (eTrash) {}
    return data;
  } catch (e) {
    try {
      if (typeof Drive !== "undefined" && Drive.Files && Drive.Files.insert) {
        var tempFile = Drive.Files.insert(
          { title: "_pstmt_" + Date.now(), mimeType: "application/vnd.google-apps.spreadsheet" },
          blob,
          { convert: true }
        );
        var ss2 = SpreadsheetApp.openById(tempFile.id);
        var data2 = ss2.getSheets()[0].getDataRange().getDisplayValues();
        Drive.Files.remove(tempFile.id);
        return data2;
      }
    } catch (e2) {
      Logger.log("[PSTMT] xlsx 변환 실패: " + e2.message);
    }
    return null;
  } finally {
    if (temp) {
      try {
        temp.setTrashed(true);
      } catch (eF) {}
    }
  }
}

function _pstmt_readTextAttachmentAsRows_(blob) {
  var content = "";
  try {
    content = blob.getDataAsString("UTF-8");
  } catch (e) {
    try {
      content = blob.getDataAsString("EUC-KR");
    } catch (e2) {}
  }
  if (!content || content.length < 5) return null;

  var lines = content.split(/\r?\n/);
  var rows = [];
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    if (!String(line).trim()) continue;
    var cols = line.indexOf("\t") !== -1 ? line.split("\t") : line.split(",");
    rows.push(cols);
  }
  return rows.length ? rows : null;
}

function _pstmt_tryBodyAsTable_(msg) {
  var plain = msg.getPlainBody();
  if (!plain || plain.length < 30) return [];
  var lines = plain.split(/\r?\n/);
  var rows = [];
  for (var i = 0; i < lines.length; i++) {
    if (!String(lines[i]).trim()) continue;
    if (lines[i].indexOf("\t") !== -1) {
      rows.push(lines[i].split("\t"));
    }
  }
  return rows.length >= 3 ? rows : [];
}

function _pstmt_appendRawRows_(ss, matrix, opts) {
  var tab = ss.getSheetByName(_PSTMT_TAB_RAW);
  if (!tab) throw new Error("「" + _PSTMT_TAB_RAW + "」탭 없음 — ① 탭 생성 먼저");

  var lastRow = tab.getLastRow();
  var startRow = lastRow < 2 ? 2 : lastRow + 1;

  var lc = 0;
  for (var ri = 0; ri < matrix.length; ri++) {
    lc = Math.max(lc, matrix[ri].length);
  }
  lc = Math.max(lc, 8);

  var block = [];
  for (var rj = 0; rj < matrix.length; rj++) {
    var row = matrix[rj].slice();
    while (row.length < lc) row.push("");
    block.push(row);
  }

  // getRange 의 3번째 인자는 **행 개수**다. 끝 행 번호가 아니다.
  //   startRow 는 늘 2 이상이라 (startRow + len - 1) 을 넣으면 요청 행 수가
  //   데이터보다 많아져 setValues 가 매번 예외를 던졌다. 수집이 통째로 죽는다.
  tab.getRange(startRow, 1, block.length, lc).setValues(block);

  if (opts && opts.meta) {
    var note =
      "Gmail " +
      Utilities.formatDate(opts.meta.date, "Asia/Seoul", "yyyy-MM-dd") +
      " | " +
      opts.meta.from +
      " | " +
      opts.meta.subject;
    try {
      tab.getRange(startRow, 1).setNote(note.substring(0, 500));
    } catch (eN) {}
  }

  return block.length;
}

function _pstmt_getOrCreateGmailLabel_(name) {
  var labels = GmailApp.getUserLabels();
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].getName() === name) return labels[i];
  }
  try {
    return GmailApp.createLabel(name);
  } catch (e) {
    Logger.log("[PSTMT] label create fail: " + e.message);
    return null;
  }
}

function _pstmt_msgHasLabel_(msg, labelName) {
  var labels = msg.getThread().getLabels();
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].getName() === labelName) return true;
  }
  return false;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  [메뉴] 명세서 메일 발신처 조사 — 업체별 자동 분배의 준비
 *  파일: _partnerStatementGmail.gs
 *
 *  ★ 왜 필요한가 (2026-09-07) ★
 *    지금 Gmail 수집은 업체를 구분하지 않는다. 첨부 있는 메일을 전부
 *    가져와 **현재 시트**에 넣고 처리 라벨을 붙인다. 그래서 업체별로
 *    자동 실행하면 먼저 도는 업체가 남의 명세서까지 다 가져간다.
 *
 *    가르려면 발신 주소 → 업체 접두 매핑이 있어야 하는데, 실제 주소를
 *    모르면 만들 수 없다. 그래서 먼저 조사한다.
 *
 *  최근 30일 첨부 메일의 발신 주소를 모아, 업체명·접두로 짐작되는 것을
 *  같이 보여준다. 이 결과로 매핑표를 만든다.
 *
 *  ★ 읽기만 한다 ★
 *    라벨을 붙이지 않는다. 조사가 실제 수집을 방해하면 안 된다.
 * ══════════════════════════════════════════════════════════════
 */
function partnerSurveyStatementSenders(optDays) {
  var days = parseInt(optDays, 10) || 30;
  var L = ["═══ 명세서 메일 발신처 조사 (최근 " + days + "일) ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];
  try {
    // 처리 라벨을 뺀 조건은 쓰지 않는다 — 이미 처리된 것도 발신처는 봐야 한다
    var q = "has:attachment newer_than:" + days + "d";
    var threads = GmailApp.search(q, 0, 200);
    L.push("검색: " + q + "  →  스레드 " + threads.length + "개");
    L.push("");

    // 업체 접두 → 이름 (푸시 쪽 표를 그대로 쓴다)
    var names = (typeof _PEP_VENDOR_NAME_ !== "undefined") ? _PEP_VENDOR_NAME_ : {};

    var bySender = {};
    var mails = 0, withRows = 0;
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        var msg = msgs[m];
        var from = String(msg.getFrom() || "").trim();
        if (!from) continue;
        mails++;

        // 첨부가 표로 읽히는 것만 명세서 후보다
        var hasTable = false;
        try {
          var parsed = _pstmt_extractStatementFromMessage_(msg);
          hasTable = !!(parsed && parsed.rows && parsed.rows.length);
        } catch (eP) {}
        if (hasTable) withRows++;

        if (!bySender[from]) {
          bySender[from] = { n: 0, table: 0, subj: "", file: "", last: "" };
        }
        var e = bySender[from];
        e.n++;
        if (hasTable) e.table++;
        if (!e.subj) e.subj = String(msg.getSubject() || "").substring(0, 34);
        e.last = Utilities.formatDate(msg.getDate(), "Asia/Seoul", "MM-dd");
        if (!e.file) {
          try {
            var at = msg.getAttachments();
            if (at.length) e.file = at[0].getName().substring(0, 30);
          } catch (eA) {}
        }
      }
    }

    L.push("메일 " + mails + "통 · 표로 읽히는 첨부 " + withRows + "통");
    L.push("");
    L.push("[발신처별] — 표 건수가 0이면 명세서가 아닐 가능성이 큽니다");
    var keys = Object.keys(bySender).sort(function (a, b) {
      return bySender[b].table - bySender[a].table || bySender[b].n - bySender[a].n;
    });
    for (var k = 0; k < keys.length; k++) {
      var s = bySender[keys[k]];
      // 발신 문자열에서 업체 접두를 짐작한다 — 이름이 들어 있는 경우가 많다
      var guess = "";
      for (var pfx in names) {
        if (keys[k].indexOf(names[pfx]) !== -1) { guess = pfx + " " + names[pfx]; break; }
      }
      L.push("  " + keys[k].substring(0, 46));
      L.push("      메일 " + s.n + " · 표 " + s.table + " · 최근 " + s.last +
        (guess ? "   → 짐작: " + guess : "   → ★ 업체 불명"));
      if (s.subj) L.push("      제목: " + s.subj);
      if (s.file) L.push("      첨부: " + s.file);
    }

    L.push("");
    L.push("[다음] 이 목록에서 명세서를 보내는 발신처를 골라 주세요.");
    L.push("  발신주소 → 업체 접두 매핑표를 만들면, 16:40 자동 수집이");
    L.push("  메일마다 업체를 가려 각 업체 파일에 나눠 넣을 수 있습니다.");
    L.push("  '업체 불명' 이 많으면 도메인 단위로 잡는 편이 낫습니다.");
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("명세서 발신처 조사", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}
