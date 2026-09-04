/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 사진 첨부
 *
 *  반품대장에 열을 새로 만들지 않는다는 원칙 때문에 첨부는 두 곳에 남긴다.
 *    1. 별도 탭(협력업체포털_첨부)  — 운영자가 표로 훑어볼 수 있게
 *    2. 해당 행 N열 이력           — CS앱 반품 카드 타임라인에 링크가 그대로 보인다
 *
 *  2번이 중요하다. CS앱을 고치지 않고도 CS 담당자가 업체 사진을 열어볼 수 있다.
 * ══════════════════════════════════════════════════════════════
 */

var PRP_ATT_HEADER = ["등록시각", "업체명", "탭", "행", "파일명", "링크"];
var PRP_ATT_MAX_BYTES = 8 * 1024 * 1024;

function prpEnsureAttachTab_() {
  var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
  var tab = ss.getSheetByName(PRP_ATTACH_TAB);
  if (tab) return tab;
  tab = ss.insertSheet(PRP_ATTACH_TAB);
  tab.getRange(1, 1, 1, PRP_ATT_HEADER.length).setValues([PRP_ATT_HEADER])
    .setFontWeight("bold").setBackground("#f1f3f4");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 150);
  tab.setColumnWidth(5, 240);
  tab.setColumnWidth(6, 320);
  return tab;
}

/** 첨부 폴더 확보 — 스크립트 속성에 ID 를 캐시한다 */
function prpAttachFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PRP_ATT_FOLDER_PROP);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var it = DriveApp.getFoldersByName(PRP_ATT_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(PRP_ATT_FOLDER_NAME);
  props.setProperty(PRP_ATT_FOLDER_PROP, folder.getId());
  return folder;
}

/**
 * 업체가 올린 사진 저장.
 * @param {string} sid 세션
 * @param {Object} payload {tab, row, base64, mimeType, fileName}
 */
function prpAttachPhoto(sid, payload) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  payload = payload || {};

  var b64 = String(payload.base64 || "");
  if (!b64) return { ok: false, error: "사진 데이터가 비어 있습니다." };
  // base64 는 원본의 약 4/3 크기다
  if (b64.length * 0.75 > PRP_ATT_MAX_BYTES) {
    return { ok: false, error: "사진이 너무 큽니다. 다시 촬영해 주세요." };
  }

  try {
    var ctx = prpOpenOwnedRow_(g.sess, payload.tab, payload.row);

    var mime = String(payload.mimeType || "image/jpeg");
    var ext = mime.indexOf("png") >= 0 ? "png" : "jpg";
    var safeVendor = String(g.sess.vendor).replace(/[\\/:*?"<>|]/g, "_");
    var fname = safeVendor + "_" + payload.tab + "_" + ctx.rowNum + "_" +
      prpToday_("yyyyMMdd_HHmmss") + "." + ext;

    var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, fname);
    var file = prpAttachFolder_().createFile(blob);
    // 링크를 아는 사람만 열람 — 폴더 전체를 공개하지 않는다
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (eShare) {
      Logger.log("[PRP] 첨부 공유 설정 실패: " + eShare.message);
    }
    var url = file.getUrl();

    prpEnsureAttachTab_().appendRow([
      prpToday_("yyyy-MM-dd HH:mm:ss"), g.sess.vendor,
      payload.tab, ctx.rowNum, fname, url
    ]);

    // CS앱 타임라인에서 바로 열 수 있도록 N열에도 링크를 남긴다
    if (ctx.col.notice >= 0) {
      var notice = prpAppendNoticeLine_(
        String(ctx.row[ctx.col.notice] || "").trim(),
        prpStamp_(PRP_STAFF_PREFIX + g.sess.vendor) + " 사진 첨부. " + url
      );
      ctx.tab.getRange(ctx.rowNum, ctx.col.notice + 1).setValue(notice);
    }

    prpInvalidateVendorCache_(g.sess.key);
    prpLog_(g.sess.vendor, "첨부", payload.tab + " " + ctx.rowNum + "행 · " + fname);
    prpNotifyChat_("업체 사진 첨부", g.sess.vendor, payload.tab + " " + ctx.rowNum + "행\n" + url);

    return { ok: true, url: url, fileName: fname, message: "사진이 첨부되었습니다." };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * 새 접수에서 고른 사진을 한 번에 올린다.
 * 한 장씩 왕복하면 접수가 너무 길어서, 행을 연 뒤 여기서 묶는다.
 */
function prpAttachPhotos(sid, payload) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  payload = payload || {};

  var list = payload.photos;
  if (!list || !list.length) return { ok: false, error: "올릴 사진이 없습니다." };
  var cap = typeof PRP_PHOTO_MAX === "number" ? PRP_PHOTO_MAX : 6;
  if (list.length > cap) list = list.slice(0, cap);

  try {
    var ctx = prpOpenOwnedRow_(g.sess, payload.tab, payload.row);
    var folder = prpAttachFolder_();
    var attTab = prpEnsureAttachTab_();
    var urls = [];
    var safeVendor = String(g.sess.vendor).replace(/[\\/:*?"<>|]/g, "_");

    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var b64 = String(p.base64 || p.dataB64 || "");
      if (!b64) continue;
      if (b64.length * 0.75 > PRP_ATT_MAX_BYTES) continue;
      var mime = String(p.mimeType || "image/jpeg");
      var ext = mime.indexOf("png") >= 0 ? "png" : "jpg";
      var fname = safeVendor + "_" + payload.tab + "_" + ctx.rowNum + "_" +
        prpToday_("yyyyMMdd_HHmmss") + "_" + (i + 1) + "." + ext;
      var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, fname);
      var file = folder.createFile(blob);
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (eShare) {}
      var url = file.getUrl();
      urls.push(url);
      attTab.appendRow([
        prpToday_("yyyy-MM-dd HH:mm:ss"), g.sess.vendor,
        payload.tab, ctx.rowNum, fname, url
      ]);
    }

    if (!urls.length) return { ok: false, error: "사진을 저장하지 못했습니다." };

    if (ctx.col.notice >= 0) {
      var notice = String(ctx.row[ctx.col.notice] || "").trim();
      for (var u = 0; u < urls.length; u++) {
        notice = prpAppendNoticeLine_(notice,
          prpStamp_(PRP_STAFF_PREFIX + g.sess.vendor) + " 사진 첨부. " + urls[u]);
      }
      ctx.tab.getRange(ctx.rowNum, ctx.col.notice + 1).setValue(notice);
    }

    prpInvalidateVendorCache_(g.sess.key);
    prpLog_(g.sess.vendor, "첨부", payload.tab + " " + ctx.rowNum + "행 · " + urls.length + "장");
    prpNotifyChat_("업체 사진 첨부", g.sess.vendor,
      payload.tab + " " + ctx.rowNum + "행 · " + urls.length + "장\n" + urls[0]);

    return { ok: true, count: urls.length, urls: urls, message: "사진 " + urls.length + "장이 첨부되었습니다." };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** 이 건에 달린 첨부 목록 (본인 업체 것만) */
function prpListAttachments(sid, payload) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;
  payload = payload || {};

  try {
    var tab = prpEnsureAttachTab_();
    var lastRow = tab.getLastRow();
    if (lastRow < 2) return { ok: true, files: [] };

    var values = tab.getRange(2, 1, lastRow - 1, PRP_ATT_HEADER.length).getDisplayValues();
    var wantTab = String(payload.tab || "").trim();
    var wantRow = String(parseInt(payload.row, 10) || "");
    var out = [];

    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      if (prpVendorKey_(r[1]) !== g.sess.key) continue;
      if (wantTab && String(r[2]).trim() !== wantTab) continue;
      if (wantRow && String(r[3]).trim() !== wantRow) continue;
      out.push({ at: r[0], fileName: r[4], url: r[5] });
    }
    out.reverse();
    return { ok: true, files: out };
  } catch (e) {
    return { ok: false, error: e.message || String(e), files: [] };
  }
}
