/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 고유ID 로 그 업체 시트 조회
 *
 *  보는 곳 — 그 업체 배포파일 하나뿐
 *    1. 「(YYYY년 M월) 발주 마감」 최근 몇 달
 *    2. 「발주 및 송장조회」 — 아직 마감 안 된 건
 *
 *  전용양식·전용발주 마감은 대리공급 양식이라 여기서 보지 않는다.
 *  배포파일을 전부 열어 B5 를 대조하지 않는다 — 파일명으로 고른다.
 *
 *  열 매핑은 허브 `_pms_orderArchiveCols_` 와 같다.
 *  헤더가 4행인 마감탭이 있어 1행만 보면 고유ID 열을 놓친다.
 * ══════════════════════════════════════════════════════════════
 */

var PRP_VENDOR_FOLDER_IDS_ = [
  "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl",
  "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v"
];
var PRP_VENDOR_FILE_PREFIX_ = "[협력업체]";
var PRP_ORDER_TAB_NAME_ = "발주 및 송장조회";
var PRP_ARCHIVE_TAB_SUFFIX_ = "발주 마감";
var PRP_LOOKUP_MONTHS_ = 6;

/**
 * 마지막 `/` 뒤가 고유ID. `#n` · `|코드` · `_S숫자` 접미는 뺀다.
 * 허브 `_pep_uidFromOrdererCell_` / `_pep_normalizeMatchUid_` 와 같다.
 */
function prpUidFromCell_(raw) {
  var s = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var slash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("／"));
  if (slash >= 0) s = s.substring(slash + 1).replace(/^\s+|\s+$/g, "");
  s = s.replace(/\s/g, "");
  s = s.replace(/#\d+$/, "");
  var pipe = s.indexOf("|");
  if (pipe > 0) s = s.substring(0, pipe);
  s = s.replace(/_S\d+$/i, "");
  return s;
}

function prpUidNorm_(raw) {
  return prpUidFromCell_(raw).toLowerCase().replace(/-/g, "");
}

function prpUidEquals_(a, b) {
  var x = prpUidNorm_(a);
  var y = prpUidNorm_(b);
  return !!(x && y && x === y);
}

/** 마감탭 헤더 행. 새 탭은 4행, 옛 탭은 1행. 허브 `_pms_findOrderArchiveHeaderRow_` 복제. */
function prpFindOrderHeaderRow_(all) {
  var max = Math.min(all ? all.length : 0, 6);
  for (var i = 0; i < max; i++) {
    var row = all[i] || [];
    for (var j = 0; j < row.length; j++) {
      var h = String(row[j] || "").replace(/\s/g, "");
      if (h === "송장번호" || h === "운송장번호" || /고유ID|고유아이디/.test(h)) return i;
    }
  }
  return 0;
}

/**
 * 발주 및 송장조회 / 발주 마감 열.
 * 헤더로 찾고 못 찾으면 표준 15열 위치 (허브 `_pms_orderArchiveCols_`).
 */
function prpMapOrderCols_(hdr) {
  function find(re, fromRight) {
    if (!hdr) return -1;
    if (fromRight) {
      for (var i = hdr.length - 1; i >= 0; i--) {
        if (re.test(String(hdr[i] || "").replace(/\s/g, ""))) return i;
      }
      return -1;
    }
    for (var j = 0; j < hdr.length; j++) {
      if (re.test(String(hdr[j] || "").replace(/\s/g, ""))) return j;
    }
    return -1;
  }
  var cols = {
    inv: find(/^송장번호$|^운송장번호$/, false),
    uid: find(/고유ID|고유아이디/, true),
    name: find(/^수취인$|수령인|받는분성명/, false),
    phone: find(/수취인전화|전화번호|연락처/, false),
    item: find(/품목명|상품명/, false),
    qty: find(/^수량$/, false),
    note: find(/^적요$/, false)
  };
  if (cols.inv < 0) cols.inv = 10;
  if (cols.uid < 0) cols.uid = 12;
  if (cols.name < 0) cols.name = 5;
  if (cols.phone < 0) cols.phone = 6;
  if (cols.item < 0) cols.item = 3;
  if (cols.qty < 0) cols.qty = 4;
  if (cols.note < 0) cols.note = 9;
  return cols;
}

function prpRowMatchesUid_(row, cols, want) {
  var key = prpUidNorm_(want);
  if (!key || !row || !cols) return false;
  var cands = [];
  if (cols.uid >= 0) cands.push(row[cols.uid]);
  if (cols.note >= 0) cands.push(row[cols.note]);
  for (var i = 0; i < cands.length; i++) {
    if (prpUidNorm_(cands[i]) === key) return true;
  }
  return false;
}

function prpRowToMatch_(row, cols, source) {
  var uid = "";
  if (cols.uid >= 0) uid = prpUidFromCell_(row[cols.uid]);
  if (!uid && cols.note >= 0) uid = prpUidFromCell_(row[cols.note]);
  return {
    name: cols.name >= 0 ? String(row[cols.name] || "").trim() : "",
    phone: cols.phone >= 0 ? prpFormatPhone_(row[cols.phone]) : "",
    item: cols.item >= 0 ? String(row[cols.item] || "").trim() : "",
    qty: cols.qty >= 0 ? String(row[cols.qty] || "").trim() : "",
    invoice: cols.inv >= 0 ? prpFormatInvoice_(row[cols.inv]) : "",
    uid: uid,
    source: source || ""
  };
}

function prpScanTabForUid_(tab, want, source, out) {
  if (!tab || tab.getLastRow() < 2) return;
  var lc = Math.max(Math.min(tab.getLastColumn(), 20), 15);
  var all;
  try { all = tab.getRange(1, 1, tab.getLastRow(), lc).getDisplayValues(); }
  catch (e) { return; }
  var hi = prpFindOrderHeaderRow_(all);
  var cols = prpMapOrderCols_(all[hi]);
  var start = hi + 1;
  if (hi >= 3) start = Math.max(start, 4);
  for (var i = start; i < all.length; i++) {
    if (!prpRowMatchesUid_(all[i], cols, want)) continue;
    out.push(prpRowToMatch_(all[i], cols, source));
  }
}

function prpArchiveTabName_(yyyy, m) {
  return "(" + yyyy + "년 " + m + "월) " + PRP_ARCHIVE_TAB_SUFFIX_;
}

function prpRecentArchiveTabNames_(now, months) {
  var n = months || PRP_LOOKUP_MONTHS_;
  var d = now ? new Date(now.getTime()) : new Date();
  d.setDate(1);
  var names = [];
  for (var i = 0; i < n; i++) {
    names.push(prpArchiveTabName_(d.getFullYear(), d.getMonth() + 1));
    d.setMonth(d.getMonth() - 1);
  }
  return names;
}

function prpVendorNameFromFileName_(rawName) {
  return String(rawName || "")
    .replace(/^\s*\[협력업체\]\s*_?\s*/, "")
    .replace(/\(\s*소비자용\s*\)/g, "")
    .replace(/\d+(\.\d+)?\s*%\s*DC/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function prpFileLooksConsumer_(name) {
  return /\(\s*소비자용\s*\)/i.test(String(name || "")) ||
    /\d+(\.\d+)?\s*%\s*DC/i.test(String(name || ""));
}

function prpFileBelongsTo_(sess, b5, fileName) {
  var keys = [sess.key].concat(sess.aliases || []);
  var cands = [prpVendorKey_(b5), prpVendorKey_(prpVendorNameFromFileName_(fileName))];
  for (var i = 0; i < cands.length; i++) {
    if (!cands[i]) continue;
    for (var k = 0; k < keys.length; k++) {
      if (keys[k] && keys[k] === cands[i]) return true;
    }
  }
  return false;
}

function prpVendorSearchLabels_(sess) {
  var out = [];
  function add(v) {
    var s = String(v || "").trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  add(sess.vendor);
  if (sess.prefix && PRP_VENDOR_LABELS[sess.prefix]) add(PRP_VENDOR_LABELS[sess.prefix]);
  return out;
}

/**
 * 그 업체 배포파일 ID.
 * 파일명으로만 고른다. 폴더를 다 열거나 설정 B5 를 전수 대조하지 않는다.
 */
function prpFindVendorFileId_(sess) {
  var ck = PRP_CACHE_VER + "_vf2_" + sess.key;
  try {
    var hit = CacheService.getScriptCache().get(ck);
    if (hit) return hit;
  } catch (e) {}

  var labels = prpVendorSearchLabels_(sess);
  var found = [];
  var seen = {};

  function consider(file) {
    if (!file) return;
    var id = file.getId();
    if (seen[id]) return;
    var nm = file.getName();
    if (nm.indexOf(PRP_VENDOR_FILE_PREFIX_) < 0) return;
    if (prpFileLooksConsumer_(nm)) return;
    if (!prpFileBelongsTo_(sess, "", nm)) return;
    seen[id] = true;
    found.push({ id: id, name: nm });
  }

  for (var i = 0; i < labels.length; i++) {
    var exact = [PRP_VENDOR_FILE_PREFIX_ + " " + labels[i], PRP_VENDOR_FILE_PREFIX_ + "_" + labels[i]];
    for (var e = 0; e < exact.length; e++) {
      try {
        var it = DriveApp.getFilesByName(exact[e]);
        while (it.hasNext()) consider(it.next());
      } catch (eName) {}
    }
  }

  if (!found.length) {
    var listed = prpListVendorFiles_();
    for (var f = 0; f < listed.length; f++) {
      if (prpFileLooksConsumer_(listed[f].name)) continue;
      if (prpFileBelongsTo_(sess, "", listed[f].name)) {
        if (!seen[listed[f].id]) {
          seen[listed[f].id] = true;
          found.push(listed[f]);
        }
      }
    }
  }

  if (!found.length) return "";
  found.sort(function (a, b) { return a.name.length - b.name.length; });
  var pick = found[0].id;
  try { CacheService.getScriptCache().put(ck, pick, 3600); } catch (ePut) {}
  return pick;
}

function prpListVendorFiles_() {
  var cache = CacheService.getScriptCache();
  var ck = PRP_CACHE_VER + "_vfiles";
  try {
    var hit = cache.get(ck);
    if (hit) {
      var parsed = JSON.parse(hit);
      if (parsed && parsed.length) return parsed;
    }
  } catch (e) {}

  var seen = {};
  var out = [];
  for (var i = 0; i < PRP_VENDOR_FOLDER_IDS_.length; i++) {
    var fid = String(PRP_VENDOR_FOLDER_IDS_[i] || "").trim();
    if (!fid || seen["F:" + fid]) continue;
    seen["F:" + fid] = true;
    try {
      var folder = DriveApp.getFolderById(fid);
      var files = folder.getFiles();
      while (files.hasNext()) {
        var f = files.next();
        var nm = f.getName();
        if (nm.indexOf(PRP_VENDOR_FILE_PREFIX_) < 0) continue;
        var id = f.getId();
        if (seen[id]) continue;
        seen[id] = true;
        out.push({ id: id, name: nm });
      }
    } catch (eList) {
      Logger.log("[PRP] 배포폴더 읽기 실패: " + eList.message);
    }
  }
  if (out.length) {
    try { cache.put(ck, JSON.stringify(out), 300); } catch (eC) {}
  }
  return out;
}

/**
 * 고유ID 로 이 업체 「발주 마감」·「발주 및 송장조회」에서 주문을 찾는다.
 */
function prpLookupByUid(sid, uidRaw) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;

  var uid = prpUidFromCell_(uidRaw);
  if (!uid) return { ok: false, error: "고유아이디를 입력해 주세요.", matches: [] };

  try {
    var fileId = prpFindVendorFileId_(g.sess);
    if (!fileId) {
      return {
        ok: false,
        error: "이 업체의 배포파일을 찾지 못했습니다. 운영자에게 알려 주세요.",
        matches: []
      };
    }

    var ss = SpreadsheetApp.openById(fileId);
    var matches = [];

    var monthNames = prpRecentArchiveTabNames_(prpNow_(), PRP_LOOKUP_MONTHS_);
    for (var m = 0; m < monthNames.length; m++) {
      var arch = ss.getSheetByName(monthNames[m]);
      if (arch) prpScanTabForUid_(arch, uid, monthNames[m], matches);
    }

    var live = ss.getSheetByName(PRP_ORDER_TAB_NAME_);
    if (live) prpScanTabForUid_(live, uid, PRP_ORDER_TAB_NAME_, matches);

    var seen = {};
    var uniq = [];
    for (var u = 0; u < matches.length; u++) {
      var r = matches[u];
      var k = [prpUidNorm_(r.uid), r.name, r.item, prpDigits_(r.invoice)].join("|");
      if (seen[k]) continue;
      seen[k] = true;
      uniq.push(r);
    }

    if (!uniq.length) {
      return { ok: false, error: "발주 마감에서 이 고유아이디를 찾지 못했습니다.", matches: [] };
    }
    return { ok: true, uid: uid, matches: uniq };
  } catch (e) {
    return { ok: false, error: e.message || String(e), matches: [] };
  }
}
