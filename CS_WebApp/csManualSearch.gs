/**
 * Pack2U CS 매뉴얼 · 처리사례 키워드 검색
 * - CS 매뉴얼 DB (geminiChat.gs 와 동일 SSOT)
 * - AppSheet CS목록 (과거 처리 이력)
 */

var _CS_MANUAL_SS_ID_ = "1LlNX-spTs-2WgWD8HEha90PYU0m7s8MqFh84vy_Fi_Q";
var _CS_MANUAL_CACHE_VER_ = "v4";
var _CS_MANUAL_CACHE_TTL_ = 21600;
var _CS_MANUAL_SEARCH_LIMIT_ = 60;
var _CS_LIST_MAX_ROWS_ = 2000;
var _CS_MANUAL_MAX_ROWS_PER_TAB_ = 800;

/** 매뉴얼·CS목록 탭 구조 점검 */
function csDiagnoseCSManual() {
  var out = { ok: true, manual: { tabs: [] }, csList: {}, error: "" };
  try {
    var mss = SpreadsheetApp.openById(_CS_MANUAL_SS_ID_);
    out.manual.ssName = mss.getName();
    out.manual.id = _CS_MANUAL_SS_ID_;
    var sheets = mss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      var lc = Math.max(sh.getLastColumn(), 1);
      var lr = sh.getLastRow();
      var hdr = lr >= 1
        ? sh.getRange(1, 1, 1, Math.min(lc, 14)).getDisplayValues()[0]
        : [];
      out.manual.tabs.push({
        name: sh.getName(),
        rows: Math.max(0, lr - 1),
        headers: hdr
      });
    }
  } catch (eM) {
    return { ok: false, error: "매뉴얼 시트: " + eM.message };
  }
  try {
    var cssId = _cs_getCSSheetId_();
    var css = SpreadsheetApp.openById(cssId);
    var tab = css.getSheetByName("CS목록");
    out.csList.id = cssId;
    out.csList.ssName = css.getName();
    if (!tab) {
      out.csList.error = "CS목록 탭 없음";
    } else {
      out.csList.rows = Math.max(0, tab.getLastRow() - 1);
      out.csList.headers = tab.getLastRow() >= 1
        ? tab.getRange(1, 1, 1, Math.min(tab.getLastColumn(), 18)).getDisplayValues()[0]
        : [];
    }
  } catch (eC) {
    out.csList.error = eC.message;
  }
  return out;
}

/** 인덱스 워밍 (홈 진입 시) — rows 포함해 클라이언트 즉시 검색 */
function csWarmManualIndex(refresh) {
  var idx = _cs_loadManualIndex_(!!refresh);
  var slim = _cs_slimManualRows_(idx.rows);
  return {
    ok: true,
    rows: slim,
    rowCount: slim.length,
    manualCount: idx.manualCount,
    caseCount: idx.caseCount,
    guideCount: idx.guideCount || 0,
    fromCache: idx.fromCache,
    cacheNote: idx.cacheNote || ""
  };
}

/**
 * 키워드 검색 (2글자 이상, 공백으로 AND)
 */
function csSearchManual(query, opts) {
  opts = opts || {};
  var q = String(query || "").trim();
  if (q.length < 2) {
    return { ok: false, error: "2글자 이상 입력하세요", results: [] };
  }
  var idx = _cs_loadManualIndex_(!!opts.refresh);
  var results = _cs_filterManualRows_(idx.rows, q);
  return {
    ok: true,
    results: results,
    meta: {
      total: idx.rows.length,
      manualCount: idx.manualCount,
      caseCount: idx.caseCount,
      guideCount: idx.guideCount || 0,
      fromCache: idx.fromCache,
      cacheNote: idx.cacheNote || ""
    },
    truncated: results.length >= _CS_MANUAL_SEARCH_LIMIT_
  };
}

function _cs_loadManualIndex_(refresh) {
  var cache = CacheService.getScriptCache();
  var key = _CS_MANUAL_CACHE_VER_ + "_manual_idx";
  if (!refresh) {
    try {
      var hit = cache.get(key);
      if (hit) {
        var parsed = JSON.parse(hit);
        return {
          rows: parsed.rows || [],
          manualCount: parsed.manualCount || 0,
          caseCount: parsed.caseCount || 0,
          guideCount: parsed.guideCount || 0,
          fromCache: true,
          cacheNote: ""
        };
      }
    } catch (eC) {}
  }

  var rows = [];
  var manualCount = 0;
  var caseCount = 0;
  var guideCount = 0;
  var cacheNote = "";

  try {
    var guides = csLoadPlaybookRecords_();
    for (var gi = 0; gi < guides.length; gi++) {
      rows.push(guides[gi]);
      guideCount++;
    }
  } catch (eG) {
    Logger.log("[CS_MANUAL] 플레이북 로드 오류: " + eG.message);
  }

  try {
    var mss = SpreadsheetApp.openById(_CS_MANUAL_SS_ID_);
    var sheets = mss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      var tabName = sheet.getName();
      if (/^(_|설정$|config$)/i.test(tabName)) continue;
      var lr = sheet.getLastRow();
      var lc = Math.max(sheet.getLastColumn(), 1);
      if (lr < 1 || lc < 1) continue;
      var data = sheet.getRange(1, 1, lr, lc).getDisplayValues();
      var headerIdx = _cs_guessHeaderRow_(data);
      var startRow = headerIdx >= 0 ? headerIdx + 1 : 0;
      var endRow = data.length;
      if (endRow - startRow > _CS_MANUAL_MAX_ROWS_PER_TAB_) {
        startRow = endRow - _CS_MANUAL_MAX_ROWS_PER_TAB_;
      }
      var header = headerIdx >= 0 ? data[headerIdx] : null;
      for (var ri = startRow; ri < endRow; ri++) {
        var rec = _cs_manualRowToRecord_(tabName, data[ri], header);
        if (rec) {
          rows.push(rec);
          manualCount++;
        }
      }
    }
  } catch (eM) {
    Logger.log("[CS_MANUAL] 매뉴얼 로드 오류: " + eM.message);
    cacheNote = "매뉴얼 일부 로드 실패";
  }

  try {
    var cssId = _cs_getCSSheetId_();
    var css = SpreadsheetApp.openById(cssId);
    var tab = css.getSheetByName("CS목록");
    if (tab && tab.getLastRow() >= 2) {
      var lr2 = tab.getLastRow();
      var lc2 = Math.max(tab.getLastColumn(), 18);
      var start2 = Math.max(2, lr2 - _CS_LIST_MAX_ROWS_ + 1);
      var data2 = tab.getRange(start2, 1, lr2 - start2 + 1, lc2).getDisplayValues();
      for (var ci = 0; ci < data2.length; ci++) {
        var crec = _cs_csListRowToRecord_(data2[ci], start2 + ci);
        if (crec) {
          rows.push(crec);
          caseCount++;
        }
      }
    }
  } catch (eL) {
    Logger.log("[CS_MANUAL] CS목록 로드 오류: " + eL.message);
    cacheNote = (cacheNote ? cacheNote + " · " : "") + "CS목록 일부 로드 실패";
  }

  try {
    var slim = _cs_slimManualRows_(rows);
    cache.put(key, JSON.stringify({
      rows: slim,
      manualCount: manualCount,
      caseCount: caseCount,
      guideCount: guideCount
    }), _CS_MANUAL_CACHE_TTL_);
  } catch (ePut) {
    cacheNote = (cacheNote ? cacheNote + " · " : "") + "캐시 저장 생략(용량)";
    Logger.log("[CS_MANUAL] cache skip: " + ePut.message);
  }

  return {
    rows: rows,
    manualCount: manualCount,
    caseCount: caseCount,
    guideCount: guideCount,
    fromCache: false,
    cacheNote: cacheNote
  };
}

function _cs_slimManualRows_(rows) {
  var slim = [];
  for (var si = 0; si < rows.length; si++) {
    var r = rows[si];
    slim.push({
      id: r.id,
      source: r.source,
      category: r.category,
      title: r.title,
      body: String(r.body || "").substring(0, 1200),
      trigger: r.trigger || "",
      statusFlow: r.statusFlow || "",
      steps: r.steps || [],
      checklist: r.checklist || [],
      caution: r.caution || "",
      tools: r.tools || "",
      keywords: r.keywords || "",
      date: r.date,
      status: r.status,
      ts: r.ts || 0,
      seq: r.seq || 0,
      priority: r.priority || 0
    });
  }
  return slim;
}

function _cs_parseDateTs_(dateStr) {
  var d = String(dateStr || "").trim();
  if (!d) return 0;
  var m = d.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  var t = Date.parse(d);
  return isNaN(t) ? 0 : t;
}

function _cs_guessHeaderRow_(data) {
  var best = -1;
  var bestScore = 0;
  var n = Math.min(data.length, 5);
  for (var i = 0; i < n; i++) {
    var score = 0;
    for (var c = 0; c < data[i].length; c++) {
      var h = String(data[i][c] || "").replace(/\s/g, "");
      if (!h) continue;
      if (/제목|키워드|질문|문의|유형|구분|카테고리|처리|답변|내용/.test(h)) score += 2;
      if (/^\d+$/.test(h)) score -= 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 2 ? best : 0;
}

function _cs_manualRowToRecord_(tabName, row, header) {
  var parts = [];
  var title = "";
  for (var i = 0; i < row.length; i++) {
    var v = String(row[i] || "").trim();
    if (!v) continue;
    if (!title) title = v.length > 90 ? v.substring(0, 90) + "…" : v;
    if (header && String(header[i] || "").trim()) {
      parts.push(String(header[i]).trim() + ": " + v);
    } else {
      parts.push(v);
    }
  }
  var body = parts.join(" · ");
  if (!body || body.replace(/[\s|·]/g, "").length < 4) return null;
  if (/^[-=─_]+$/.test(body)) return null;
  return {
    id: tabName + "|" + title.substring(0, 36),
    source: "매뉴얼",
    category: tabName,
    title: title,
    body: body,
    date: "",
    status: "",
    ts: 0,
    seq: 0
  };
}

function _cs_csListRowToRecord_(row, seq) {
  var csNo = String(row[0] || "").trim();
  var name = String(row[2] || "").trim();
  var date = String(row[5] || "").trim();
  var vendor = String(row[8] || "").trim();
  var content = String(row[9] || "").trim();
  var method = String(row[10] || "").trim();
  var status = String(row[11] || "").trim();
  var memo = String(row[12] || "").trim();

  if (!content && !method && !memo) return null;

  var title = content || method || memo;
  if (title.length > 100) title = title.substring(0, 100) + "…";

  var bodyParts = [];
  if (name) bodyParts.push("고객: " + name);
  if (vendor) bodyParts.push("판매처: " + vendor);
  if (content) bodyParts.push("CS내용: " + content);
  if (method) bodyParts.push("처리: " + method);
  if (status) bodyParts.push("상태: " + status);
  if (memo) bodyParts.push("비고: " + memo);
  if (csNo) bodyParts.push("CS번호: " + csNo);

  return {
    id: csNo || ("case|" + date + "|" + name),
    source: "CS사례",
    category: vendor || "CS목록",
    title: title,
    body: bodyParts.join(" · "),
    date: date,
    status: status,
    ts: _cs_parseDateTs_(date),
    seq: seq || 0
  };
}

function _cs_filterManualRows_(rows, query) {
  var keywords = String(query || "").toLowerCase().split(/\s+/).filter(function (k) {
    return k.length >= 2;
  });
  if (!keywords.length) {
    keywords = [String(query || "").toLowerCase()];
  }
  var scored = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var hay = (r.title + " " + r.body + " " + r.category + " " + r.source + " " +
      (r.keywords || "") + " " + (r.trigger || "")).toLowerCase();
    var score = 0;
    var why = [];
    for (var k = 0; k < keywords.length; k++) {
      var kw = keywords[k];
      if (hay.indexOf(kw) === -1) continue;
      score += 35;
      why.push(kw);
      if ((r.title || "").toLowerCase().indexOf(kw) !== -1) score += 25;
      if ((r.category || "").toLowerCase().indexOf(kw) !== -1) score += 15;
      if (String(r.keywords || "").toLowerCase().indexOf(kw) !== -1) score += 20;
    }
    if (score <= 0) continue;
    if (r.source === "처리가이드") score += 40;
    else if (r.source === "매뉴얼") score += 5;
    scored.push({ score: score, why: why, row: r });
  }

  scored.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    var bt = (b.row.ts || _cs_parseDateTs_(b.row.date) || b.row.seq || 0);
    var at = (a.row.ts || _cs_parseDateTs_(a.row.date) || a.row.seq || 0);
    return bt - at;
  });

  var out = [];
  for (var s = 0; s < scored.length && out.length < _CS_MANUAL_SEARCH_LIMIT_; s++) {
    var row = scored[s].row;
    out.push({
      id: row.id,
      source: row.source,
      category: row.category,
      title: row.title,
      body: row.body,
      trigger: row.trigger || "",
      statusFlow: row.statusFlow || "",
      steps: row.steps || [],
      checklist: row.checklist || [],
      caution: row.caution || "",
      tools: row.tools || "",
      date: row.date,
      status: row.status,
      match: scored[s].why.join(" · ")
    });
  }
  return out;
}
