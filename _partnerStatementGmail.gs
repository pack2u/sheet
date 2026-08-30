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

  tab.getRange(startRow, 1, startRow + block.length - 1, lc).setValues(block);

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
