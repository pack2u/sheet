/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 고유ID 로 그 업체 시트 조회
 *
 *  보는 곳 — 그 업체 배포파일 하나뿐
 *    1. 「(YYYY년 M월) 발주 마감」 최근 몇 달
 *    2. 「발주 및 송장조회」 — 아직 마감 안 된 건
 *
 *    3. 「(YYYY년 M월) 전용발주 마감」·「전용양식」 — 전용발주 업체. 송장으로만 찾는다 (2026-10-28, prpMapExclusiveCols_)
 *       (전에는 «대리공급 양식이라» 안 봤다 — 그래서 냅킨코리아 전용발주 송장이 조회에서 안 나왔다)
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
var PRP_EXCLUSIVE_ARCHIVE_SUFFIX_ = "전용발주 마감";   // 「(2026년 10월) 전용발주 마감」 (2026-10-28)
var PRP_EXCLUSIVE_TAB_NAME_ = "전용양식";
/*  ★ 6 → 12 ★  (2026-09-20)
    > "12개월로 늘린다"
    조회에서 안 나오면 업체는 손으로 적는다. 손으로 적은 건이 곧 「출처 미확인」이
    되므로, 조회 범위를 넓히는 것이 미확인 건을 줄이는 가장 싼 길이다.
    탭을 더 여느라 느려지지만 — 데이터만 맞으면 로딩 시간은 문제가 아니다. */
var PRP_LOOKUP_MONTHS_ = 12;

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
    note: find(/^적요$/, false),
    /*  목록으로 볼 때는 「언제 것인가」가 있어야 훑을 수 있다.
        못 찾으면 -1 로 두고 화면에서 그 줄만 비운다 — 자리를 지어내지 않는다. */
    date: find(/^발주일$|^주문일$|^일자$|^등록일$|^접수일$/, false)
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

/**
 * ══ 전용양식 · (YYYY년 M월) 전용발주 마감 ══   (2026-10-28)
 * > 사장님: "냅킨코리아 전용발주 송장은 A열이야"
 *
 * 전용 탭은 그 업체 택배사 양식이라 「발주 및 송장조회」와 칸 배치가 다르다. 세 업체(냅킨코리아·제이엠·태양)를 열어 보니 —
 *   전용양식            A 송장번호 · B 이슈 · …            (머리글 「송장번호」가 있다)
 *   전용발주 마감(달마다) A 마감 시각 · B 송장 · C 이슈 · …  (A·B 머리글이 비어 있다 — 마감이 앞에 시각 칸을 붙인다)
 *   → 송장은 「송장번호」 머리글, 없으면 «「이슈」 바로 왼쪽». 자리(A·B)로 박지 않는다 — 양식이 한 칸 밀려도 따라간다.
 *   v2 일일마감과 맞대 확인: 냅킨코리아 10월 마감 B열 260000391615 = 일일마감 그 송장(중앙즉석닭발).
 * 받는 분·전화·품목 머리글은 업체마다 다르다(받는사람/수화주명/고객명 · 상품명/품명/품목명). 못 찾으면 비워 둔다 — 지어내지 않는다.
 * 고유ID 칸이 없다 — 고유ID 로는 안 걸리고(uid·note = -1) 송장으로만 찾는다.
 */
function prpFindExclusiveHeaderRow_(all) {
  var max = Math.min(all ? all.length : 0, 6);
  for (var i = 0; i < max; i++) {
    var row = all[i] || [];
    for (var j = 0; j < row.length; j++) if (String(row[j] || "").replace(/\s/g, "") === "이슈") return i;
  }
  return -1;
}

function prpMapExclusiveCols_(hdr) {
  function find(re) {
    for (var j = 0; j < (hdr || []).length; j++) if (re.test(String(hdr[j] || "").replace(/\s/g, ""))) return j;
    return -1;
  }
  var inv = find(/^송장번호$|^운송장번호$/);
  var issue = find(/^이슈$/);
  if (inv < 0 && issue > 0) inv = issue - 1;
  //  마감 탭은 송장 왼쪽이 마감 시각이다 — 머리글이 빈 칸일 때만 날짜로 본다
  var date = inv > 0 && !String((hdr || [])[inv - 1] || "").trim() ? inv - 1 : -1;
  return {
    inv: inv,
    uid: -1,
    note: -1,
    name: find(/^받는사람$|^수화주명$|^고객명$|^수취인$|^받는분$/),
    phone: find(/^전화번호$|^수하인번호$|^수화주전화1?$|^수취인전화(번호)?$/),
    item: find(/^상품명$|^품명$|^품목명$/),
    qty: find(/^수량$|^박스수량$/),
    date: date
  };
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
    date: cols.date >= 0 ? String(row[cols.date] || "").trim() : "",
    source: source || ""
  };
}

/**
 * 탭 하나를 훑는다. 무엇으로 고를지는 `맞나(row, cols)` 가 정한다.
 * 고유ID 로 찾을 때와 송장으로 찾을 때가 «같은 길»을 쓰게 하려고 갈라 뒀다.
 */
function prpScanTab_(tab, source, out, 맞나) {
  if (!tab || tab.getLastRow() < 2) return;
  var lc = Math.max(Math.min(tab.getLastColumn(), 20), 15);
  var all;
  try { all = tab.getRange(1, 1, tab.getLastRow(), lc).getDisplayValues(); }
  catch (e) { return; }
  //  전용양식·전용발주 마감은 칸 배치가 다르다 — 이름에 「전용」이 있고 「이슈」 머리글이 있을 때만 그 배치로 (2026-10-28)
  var ex = /전용/.test(String(tab.getName() || "")) ? prpFindExclusiveHeaderRow_(all) : -1;
  if (ex >= 0) {
    var exCols = prpMapExclusiveCols_(all[ex]);
    for (var k = ex + 1; k < all.length; k++) {
      if (!맞나(all[k], exCols)) continue;
      out.push(prpRowToMatch_(all[k], exCols, source));
    }
    return;
  }
  var hi = prpFindOrderHeaderRow_(all);
  var cols = prpMapOrderCols_(all[hi]);
  var start = hi + 1;
  if (hi >= 3) start = Math.max(start, 4);
  for (var i = start; i < all.length; i++) {
    if (!맞나(all[i], cols)) continue;
    out.push(prpRowToMatch_(all[i], cols, source));
  }
}

function prpScanTabForUid_(tab, want, source, out) {
  prpScanTab_(tab, source, out, function (row, cols) {
    return prpRowMatchesUid_(row, cols, want);
  });
}

/** 송장번호로 고른다 — 숫자만 견준다 (하이픈·공백이 제각각이다) */
function prpScanTabForInvoice_(tab, wantDigits, source, out) {
  prpScanTab_(tab, source, out, function (row, cols) {
    if (cols.inv < 0) return false;
    var d = prpDigits_(row[cols.inv]);
    return !!(d && wantDigits && d === wantDigits);
  });
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
  /*  ★ 2026-10-27 v2 업체 화면은 파일을 안다 ★  (prpV2.gs)
      v2 vendors.legacy_sheet_id 가 그 업체 파일이다 — 이름으로 찾다 못 찾는 업체(제이엠·태양 등)가 있었다.
      v2 문으로 들어온 세션에만 있다. 옛 포털 링크 세션은 아래 이름 찾기 그대로.  */
  if (sess.fileId) return String(sess.fileId);
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
 * 그 업체 배포파일의 「발주 마감」 최근 N달 + 「발주 및 송장조회」를 훑는다.
 * 고유ID·송장 두 갈래가 같은 길을 쓰게 하려고 하나로 모았다 —
 * 갈라 두면 한쪽만 고치게 되고, 그게 곧 두 화면이 다른 답을 주는 길이다.
 *
 * @return {{ok:boolean, matches:Array, error?:string}}
 */
function prpScanVendorBook_(sess, 훑기) {
  var fileId = prpFindVendorFileId_(sess);
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
    if (arch) 훑기(arch, monthNames[m], matches);
  }

  var live = ss.getSheetByName(PRP_ORDER_TAB_NAME_);
  if (live) 훑기(live, PRP_ORDER_TAB_NAME_, matches);

  //  전용발주 업체(냅킨코리아·제이엠·태양 …) — 「전용발주 마감」 달 탭 + 아직 마감 안 된 「전용양식」 (2026-10-28)
  //  칸 배치는 prpScanTab_ 가 탭 이름·「이슈」 머리글로 알아본다. 없는 업체는 getSheetByName 이 null 이라 지나간다.
  for (var e = 0; e < monthNames.length; e++) {
    var exName = monthNames[e].replace(PRP_ARCHIVE_TAB_SUFFIX_, PRP_EXCLUSIVE_ARCHIVE_SUFFIX_);
    var exArch = ss.getSheetByName(exName);
    if (exArch) 훑기(exArch, exName, matches);
  }
  var exLive = ss.getSheetByName(PRP_EXCLUSIVE_TAB_NAME_);
  if (exLive) 훑기(exLive, PRP_EXCLUSIVE_TAB_NAME_, matches);

  var seen = {};
  var uniq = [];
  for (var u = 0; u < matches.length; u++) {
    var r = matches[u];
    var k = [prpUidNorm_(r.uid), r.name, r.item, prpDigits_(r.invoice)].join("|");
    if (seen[k]) continue;
    seen[k] = true;
    uniq.push(r);
  }
  return { ok: true, matches: uniq };
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
    var res = prpScanVendorBook_(g.sess, function (tab, src, out) {
      prpScanTabForUid_(tab, uid, src, out);
    });
    if (!res.ok) return res;
    if (!res.matches.length) {
      return {
        ok: false,
        error: "최근 " + PRP_LOOKUP_MONTHS_ + "개월 발주 마감에서 이 고유아이디를 찾지 못했습니다.",
        matches: []
      };
    }
    return { ok: true, uid: uid, matches: res.matches };
  } catch (e) {
    return { ok: false, error: e.message || String(e), matches: [] };
  }
}

/**
 * ★ 송장번호로도 찾는다 ★  (2026-09-20)
 *
 * 고유ID 를 모르는 건이 적지 않다. 그때 업체는 손으로 적고, 손으로 적은 건이
 * 곧 「출처 미확인」이 된다. 업체 손에 «늘» 있는 것은 송장번호다.
 */
function prpLookupByInvoice(sid, invRaw) {
  var g = prpGuard_(sid);
  if (g._deny) return g._deny;

  var digits = prpDigits_(invRaw);
  if (digits.length < 8) {
    return { ok: false, error: "송장번호를 숫자 8자리 이상 입력해 주세요.", matches: [] };
  }

  try {
    var res = prpScanVendorBook_(g.sess, function (tab, src, out) {
      prpScanTabForInvoice_(tab, digits, src, out);
    });
    if (!res.ok) return res;
    if (!res.matches.length) {
      return {
        ok: false,
        error: "최근 " + PRP_LOOKUP_MONTHS_ + "개월 발주 마감에서 이 송장번호를 찾지 못했습니다.",
        matches: []
      };
    }
    return { ok: true, invoice: prpFormatInvoice_(invRaw), matches: res.matches };
  } catch (e) {
    return { ok: false, error: e.message || String(e), matches: [] };
  }
}

/* ══════════════════════════════════════════════════════════════
   ★ 출처 확인 ★  (2026-09-20)

   > "오류로 다른 업체 물건이 삽입될수도 있으니 이부분 기획해줘"

   접수하는 순간 서버가 «다시» 훑는다. 화면이 「조회해서 찾았어요」라고
   보내는 말은 믿지 않는다 — 조회한 뒤 품목칸을 고쳐 적을 수도 있고,
   조회를 아예 안 하고 보낼 수도 있다. 한 값의 주인은 하나여야 한다.

   그 업체 «배포파일»만 연다. 그러니 거기서 찾혔다는 것은 곧
   「이 업체 물건이 맞다」는 뜻이다.
   ══════════════════════════════════════════════════════════════ */

var PRP_ORIGIN_OK_ = "확인됨";
var PRP_ORIGIN_UNKNOWN_ = "미확인";
var PRP_ORIGIN_MISMATCH_ = "어긋남";

/**
 * @return {{level:string, why:string, hit:(Object|null)}}
 *   확인됨 — 고유ID 나 송장으로 이 업체 장부에서 찾았고, 품목도 그 줄과 맞는다
 *   어긋남 — 줄은 찾았는데 적어 보낸 품목이 그 줄과 다르다
 *   미확인 — 장부에서 못 찾았다 (12개월 밖 · 고유ID·송장 둘 다 없음 등)
 */
function prpVerifyOrigin_(sess, data) {
  var uid = prpUidFromCell_(data && data.uid);
  var invDigits = prpDigits_(data && data.invoice);
  var item = String((data && data.item) || "").replace(/\s+/g, "").toLowerCase();

  if (!uid && invDigits.length < 8) {
    return { level: PRP_ORIGIN_UNKNOWN_, why: "고유ID·송장번호가 없습니다", hit: null };
  }

  var found = [];
  try {
    if (uid) {
      var a = prpScanVendorBook_(sess, function (tab, src, out) {
        prpScanTabForUid_(tab, uid, src, out);
      });
      if (!a.ok) return { level: PRP_ORIGIN_UNKNOWN_, why: a.error, hit: null };
      found = a.matches;
    }
    if (!found.length && invDigits.length >= 8) {
      var b = prpScanVendorBook_(sess, function (tab, src, out) {
        prpScanTabForInvoice_(tab, invDigits, src, out);
      });
      if (b.ok) found = b.matches;
    }
  } catch (e) {
    /*  장부를 못 읽은 것과 「없는 것」은 다르다. 접수를 막지는 않되
        까닭을 그대로 적어 둔다 — CS 가 보고 판단한다.  */
    return { level: PRP_ORIGIN_UNKNOWN_, why: "장부를 읽지 못했습니다(" + e.message + ")", hit: null };
  }

  if (!found.length) {
    return {
      level: PRP_ORIGIN_UNKNOWN_,
      why: "최근 " + PRP_LOOKUP_MONTHS_ + "개월 장부에 없습니다",
      hit: null
    };
  }

  /*  품목까지 맞는 줄이 하나라도 있으면 확인됨.
      업체가 품목명을 줄여 적는 일이 잦아 «들어 있으면» 맞다고 본다. */
  for (var i = 0; i < found.length; i++) {
    var f = String(found[i].item || "").replace(/\s+/g, "").toLowerCase();
    if (!item || !f) continue;
    if (f === item || f.indexOf(item) >= 0 || item.indexOf(f) >= 0) {
      return { level: PRP_ORIGIN_OK_, why: found[i].source || "", hit: found[i] };
    }
  }

  return {
    level: PRP_ORIGIN_MISMATCH_,
    why: "장부에는 「" + String(found[0].item || "").substring(0, 40) + "」로 되어 있습니다",
    hit: found[0]
  };
}
