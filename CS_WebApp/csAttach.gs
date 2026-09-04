/**
 * ══════════════════════════════════════════════════════════════
 *  CS앱 — 반품 사진 첨부
 *
 *  반품대장 열 구조는 건드리지 않는다는 원칙 때문에 첨부는 두 곳에 남긴다.
 *    1. 별도 탭(반품첨부)  — 운영자가 표로 훑어볼 수 있게
 *    2. 해당 행 N열 이력   — 반품 카드 타임라인에 사진 카드로 보인다
 *
 *  협력업체 포털(prpAttach.gs)도 같은 문구로 N열에 링크를 남긴다.
 *  덕분에 업체가 올린 사진과 CS가 올린 사진이 한 타임라인에 같이 보인다.
 *
 *  ★ 이 웹앱은 executeAs=USER_ACCESSING 이다. DriveApp 이 접속자 권한으로
 *    돌기 때문에 개인 Drive 루트에 폴더를 만들면 담당자마다 폴더가 따로
 *    생겨 서로 못 본다. 커뮤니티 보드 첨부와 같은 방식으로 반품관리대장이
 *    들어 있는 폴더 밑에 두어 대장의 공유 권한을 그대로 물려받게 한다.
 * ══════════════════════════════════════════════════════════════
 */

var _CS_ATT_FOLDER_NAME_ = "반품사진_첨부";
var _CS_ATT_FOLDER_PROP_ = "CS_RET_ATT_FOLDER_ID";
var _CS_ATT_TAB_ = "반품첨부";
var _CS_ATT_HEADER_ = ["등록시각", "담당자", "탭", "행", "수취인", "파일명", "링크"];

/** 한 번에 올릴 수 있는 장수 · 총 용량(디코드 후 기준) */
var _CS_ATT_MAX_FILES_ = 6;
var _CS_ATT_MAX_BYTES_ = 12 * 1024 * 1024;

/**
 * 첨부 폴더.
 *
 * 담당자마다 폴더가 따로 생기면 서로 사진을 못 보므로 폴더는 하나여야 한다.
 * 폴더 ID 를 스크립트 속성에 박아두고 전원이 그것을 쓴다.
 *
 * 처음 한 번은 만들어야 하는데, 접속자 권한(USER_ACCESSING)이라 자리를 두 단계로 찾는다.
 *   1) 반품관리대장이 들어 있는 폴더 — 대장 소유자로 접속했을 때만 보인다.
 *      대장을 파일만 공유받은 계정에서는 getParents() 가 비어 온다.
 *   2) 안 보이면 접속자 내 드라이브에 만들고 허용 계정 전원을 편집자로 넣는다.
 * 어느 쪽이든 ID 를 속성에 저장하므로 다음부터는 전원이 같은 폴더에 쓴다.
 */
function _cs_attFolder_() {
  var props = PropertiesService.getScriptProperties();
  var saved = String(props.getProperty(_CS_ATT_FOLDER_PROP_) || "").trim();
  if (saved) {
    try {
      var f = DriveApp.getFolderById(saved);
      if (f && !f.isTrashed()) return f;
    } catch (eF) {
      throw new Error(
        "지정된 첨부 폴더를 열 수 없습니다. 관리자에게 csSetupReturnAttachFolder() 실행을 요청하세요."
      );
    }
  }

  var folder = _cs_attCreateFolder_();
  props.setProperty(_CS_ATT_FOLDER_PROP_, folder.getId());
  return folder;
}

/** 첨부 폴더를 새로 확보한다 (대장 폴더 우선, 안 되면 내 드라이브 + 공유) */
function _cs_attCreateFolder_() {
  var parent = null;
  try {
    var parents = DriveApp.getFileById(_CS_RETURN_LEDGER_ID_).getParents();
    if (parents.hasNext()) parent = parents.next();
  } catch (eP) {}

  if (parent) {
    var itP = parent.getFoldersByName(_CS_ATT_FOLDER_NAME_);
    return itP.hasNext() ? itP.next() : parent.createFolder(_CS_ATT_FOLDER_NAME_);
  }

  // 대장 상위 폴더가 안 보이는 계정 — 내 드라이브에 만들고 담당자 전원에게 편집 권한을 준다
  var itR = DriveApp.getFoldersByName(_CS_ATT_FOLDER_NAME_);
  var folder = itR.hasNext() ? itR.next() : DriveApp.createFolder(_CS_ATT_FOLDER_NAME_);
  _cs_attShareFolder_(folder);
  return folder;
}

/** 허용 계정 전원을 첨부 폴더 편집자로 넣는다 */
function _cs_attShareFolder_(folder) {
  var emails = _cs_ac_allowed_();
  var added = [];
  for (var i = 0; i < emails.length; i++) {
    try {
      folder.addEditor(emails[i]);
      added.push(emails[i]);
    } catch (e) {
      // 소유자 자신이거나 이미 편집자면 실패한다 — 넘어간다
    }
  }
  return added;
}

function _cs_ensureAttTab_() {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var tab = ss.getSheetByName(_CS_ATT_TAB_);
  if (tab) return tab;
  tab = ss.insertSheet(_CS_ATT_TAB_);
  tab.getRange(1, 1, 1, _CS_ATT_HEADER_.length).setValues([_CS_ATT_HEADER_])
    .setFontWeight("bold").setBackground("#f1f3f4");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 150);
  tab.setColumnWidth(6, 240);
  tab.setColumnWidth(7, 320);
  return tab;
}

function _cs_attExt_(mime, fileName) {
  var m = String(mime || "").toLowerCase();
  if (m.indexOf("png") >= 0) return "png";
  if (m.indexOf("webp") >= 0) return "webp";
  if (m.indexOf("heic") >= 0 || m.indexOf("heif") >= 0) return "heic";
  var fromName = String(fileName || "").match(/\.([a-z0-9]{2,5})$/i);
  return fromName ? fromName[1].toLowerCase() : "jpg";
}

/** 파일명에 쓸 수 없는 글자를 걷어낸다 */
function _cs_attSafeName_(s) {
  return String(s || "")
    .replace(/[\\/:*?"<>|\[\]]/g, "_")
    .replace(/\s+/g, "")
    .substring(0, 20);
}

/**
 * 반품 건에 사진 첨부.
 * @param {Object} payload {tab, row, staff, name, photos:[{dataB64, mimeType, name}]}
 * @return {{ok:boolean, files:Array, message:string}}
 */
function csAttachReturnPhotos(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};

  var tabName = String(payload.tab || "").trim();
  var rowNum = parseInt(payload.row, 10);
  var staff = String(payload.staff || "").trim() || "CS";
  var photos = payload.photos || [];

  if (!tabName || !(rowNum > 0)) return { ok: false, error: "탭·행이 필요합니다." };
  if (!photos.length) return { ok: false, error: "첨부할 사진이 없습니다." };
  if (photos.length > _CS_ATT_MAX_FILES_) {
    return { ok: false, error: "한 번에 " + _CS_ATT_MAX_FILES_ + "장까지 올릴 수 있습니다." };
  }

  try {
    var blobs = [];
    var totalBytes = 0;
    for (var v = 0; v < photos.length; v++) {
      var p = photos[v] || {};
      var b64 = String(p.dataB64 || "");
      if (!b64) continue;
      var bytes;
      try {
        bytes = Utilities.base64Decode(b64);
      } catch (eD) {
        return { ok: false, error: "사진을 읽을 수 없습니다 (" + (p.name || v + 1) + ")" };
      }
      totalBytes += bytes.length;
      blobs.push({ bytes: bytes, mime: String(p.mimeType || "image/jpeg"), name: p.name });
    }
    if (!blobs.length) return { ok: false, error: "사진 데이터가 비어 있습니다." };
    if (totalBytes > _CS_ATT_MAX_BYTES_) {
      return {
        ok: false,
        error: "사진 용량이 너무 큽니다 (" + Math.round(totalBytes / 1024 / 1024 * 10) / 10 +
          "MB). 장수를 줄여 다시 시도하세요."
      };
    }

    var ctx = _cs_openReturnLedgerRow_(tabName, rowNum);
    var folder = _cs_attFolder_();
    var stampName = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss");
    var who = _cs_attSafeName_(payload.name ||
      (ctx.col.name >= 0 ? ctx.row[ctx.col.name] : "")) || "반품";

    var saved = [];
    for (var i = 0; i < blobs.length; i++) {
      var one = blobs[i];
      var fname = who + "_" + tabName + "_" + rowNum + "_" + stampName +
        (blobs.length > 1 ? "_" + (i + 1) : "") + "." + _cs_attExt_(one.mime, one.name);
      var file = folder.createFile(Utilities.newBlob(one.bytes, one.mime, fname));
      // 링크를 아는 사람은 볼 수 있게 — 각자 브라우저에서 썸네일이 바로 뜨도록
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (eS) {
        Logger.log("[CS_ATTACH] 공유 설정 실패: " + eS.message);
      }
      saved.push({ fileId: file.getId(), fileName: fname, url: file.getUrl() });
    }

    var nowText = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    var logRows = [];
    for (var s = 0; s < saved.length; s++) {
      logRows.push([nowText, staff, tabName, rowNum, who, saved[s].fileName, saved[s].url]);
    }
    try {
      var logTab = _cs_ensureAttTab_();
      logTab.getRange(logTab.getLastRow() + 1, 1, logRows.length, _CS_ATT_HEADER_.length)
        .setValues(logRows);
    } catch (eLog) {
      Logger.log("[CS_ATTACH] 로그 탭 기록 실패: " + eLog.message);
    }

    // 타임라인에 사진 카드로 보이게 N열에 한 줄로 남긴다
    var notice = ctx.col.notice >= 0 ? String(ctx.row[ctx.col.notice] || "").trim() : "";
    if (ctx.col.notice >= 0) {
      var urls = [];
      for (var u = 0; u < saved.length; u++) urls.push(saved[u].url);
      notice = _cs_appendNoticeLine_(
        notice,
        _cs_ledgerStamp_(staff) + " 사진 첨부 " + saved.length + "장. " + urls.join(" ")
      );
      ctx.tab.getRange(rowNum, ctx.col.notice + 1).setValue(notice);
    }

    csInvalidateReturnLedgerCache_();
    return {
      ok: true,
      files: saved,
      notice: notice,
      message: saved.length + "장 첨부했습니다."
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** 이 건에 달린 첨부 목록 (반품첨부 탭 기준) */
function csListReturnPhotos(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};

  try {
    var tab = _cs_ensureAttTab_();
    var lastRow = tab.getLastRow();
    if (lastRow < 2) return { ok: true, files: [] };

    var values = tab.getRange(2, 1, lastRow - 1, _CS_ATT_HEADER_.length).getDisplayValues();
    var wantTab = String(payload.tab || "").trim();
    var wantRow = String(parseInt(payload.row, 10) || "");
    var out = [];

    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      if (wantTab && String(r[2]).trim() !== wantTab) continue;
      if (wantRow && String(r[3]).trim() !== wantRow) continue;
      out.push({ at: r[0], staff: r[1], fileName: r[5], url: r[6] });
    }
    out.reverse();
    return { ok: true, files: out };
  } catch (e) {
    return { ok: false, error: e.message || String(e), files: [] };
  }
}

/**
 * 첨부 폴더 준비 / 재공유. 편집기에서 실행한다.
 * 담당자가 늘어난 뒤 다시 실행하면 새 계정에 편집 권한을 준다.
 *
 * @param {boolean=} recreate true 면 지정된 폴더를 버리고 자리를 다시 찾는다.
 *   기존 사진은 파일 ID 로 참조되므로 링크는 그대로 열린다.
 */
function csSetupReturnAttachFolder(recreate) {
  var props = PropertiesService.getScriptProperties();
  if (recreate) props.deleteProperty(_CS_ATT_FOLDER_PROP_);

  var out = [];
  out.push("═══ 반품 사진 첨부 폴더 설정 ═══");
  out.push("실행 계정: " + (function () {
    try { return Session.getEffectiveUser().getEmail() || "(불명)"; } catch (e) { return "(오류)"; }
  })());

  var folder;
  try {
    folder = _cs_attFolder_();
  } catch (e) {
    out.push("⛔ 폴더 확보 실패: " + e.message);
    var failText = out.join("\n");
    Logger.log(failText);
    return failText;
  }

  var added = _cs_attShareFolder_(folder);
  out.push("");
  out.push("폴더명: " + folder.getName());
  out.push("ID    : " + folder.getId());
  out.push("URL   : " + folder.getUrl());
  out.push("속성   : " + _CS_ATT_FOLDER_PROP_ + " 저장 완료");
  out.push("");
  out.push("편집 권한 부여 " + added.length + "건:");
  if (added.length) {
    added.forEach(function (a) { out.push("  · " + a); });
  } else {
    out.push("  (이미 전원 편집자이거나 소유자입니다)");
  }

  var text = out.join("\n");
  Logger.log(text);
  return text;
}

/** 첨부 저장 경로·권한 점검 (사진이 안 올라갈 때) */
function csDiagnoseReturnAttach() {
  var out = [];
  out.push("═══ 반품 사진 첨부 점검 ═══");
  out.push("실행 계정: " + (function () {
    try { return Session.getEffectiveUser().getEmail() || "(불명)"; } catch (e) { return "(오류)"; }
  })());

  var pinned = "";
  try {
    pinned = String(PropertiesService.getScriptProperties()
      .getProperty(_CS_ATT_FOLDER_PROP_) || "").trim();
  } catch (eProp) {}
  out.push("지정된 폴더 ID: " + (pinned || "(없음 — 첫 업로드 때 만들어집니다)"));

  var ledgerParent = "(안 보임 — 대장을 파일만 공유받은 계정입니다)";
  try {
    var parents = DriveApp.getFileById(_CS_RETURN_LEDGER_ID_).getParents();
    if (parents.hasNext()) ledgerParent = parents.next().getName();
  } catch (eP) {
    ledgerParent = "(대장 파일 접근 실패: " + eP.message + ")";
  }
  out.push("반품관리대장 상위 폴더: " + ledgerParent);
  out.push("");

  try {
    var folder = _cs_attFolder_();
    out.push("✅ 첨부 폴더: " + folder.getName());
    out.push("   ID : " + folder.getId());
    out.push("   URL: " + folder.getUrl());
    var owner = "(불명/공유드라이브)";
    try {
      var ow = folder.getOwner();
      if (ow && ow.getEmail) owner = ow.getEmail();
    } catch (eO) {}
    out.push("   소유자: " + owner);

    var editors = [];
    try {
      var eds = folder.getEditors();
      for (var i = 0; i < eds.length; i++) editors.push(eds[i].getEmail());
    } catch (eE) {}
    out.push("   편집자: " + (editors.length ? editors.join(", ") : "(없음)"));

    var missing = [];
    var allowed = _cs_ac_allowed_();
    for (var a = 0; a < allowed.length; a++) {
      if (allowed[a] !== String(owner).toLowerCase() && editors.indexOf(allowed[a]) === -1) {
        missing.push(allowed[a]);
      }
    }
    if (missing.length) {
      out.push("   ⚠ 편집 권한 없는 담당자 " + missing.length + "명: " + missing.join(", "));
      out.push("   → csSetupReturnAttachFolder() 를 실행하면 권한을 줍니다.");
    }
  } catch (eF) {
    out.push("⛔ 첨부 폴더 실패: " + eF.message);
    out.push("   → csSetupReturnAttachFolder() 또는 csSetupReturnAttachFolder(true) 실행");
  }

  out.push("");
  try {
    var tab = _cs_ensureAttTab_();
    out.push("✅ 로그 탭: " + tab.getName() + " (" + Math.max(0, tab.getLastRow() - 1) + "건)");
  } catch (eT) {
    out.push("⛔ 로그 탭 실패: " + eT.message);
  }

  var text = out.join("\n");
  Logger.log(text);
  return text;
}
