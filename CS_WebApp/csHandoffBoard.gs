/**
 * CS 커뮤니티 보드 (Handoff Board)
 * ★ 2026-08-25 신규
 *
 * CS 담당자끼리 처리해야 할 건을 카드로 쌓아두고 전달 내용을 누적하는 보드.
 * 저장은 반품관리대장 파일의 `CS_커뮤니티보드` 탭 (CS가 이미 쓰는 파일).
 *
 * 캐시를 쓰지 않는다. 여러 담당자가 동시에 보는 화면이라 몇십 초 지연된 목록이
 * 보이면 "분명 올렸는데 안 보인다"는 혼선이 생긴다. 행 수가 수백 단위라 직독이 빠르다.
 */

var _CS_HB_TAB_NAME_ = "CS_커뮤니티보드";
/** 이전 탭명 — 이름만 바꿔 이어 쓴다 (카드가 이미 쌓여 있으므로 새로 만들면 안 된다) */
var _CS_HB_TAB_LEGACY_ = "CS_전달보드";
var _CS_HB_LOCK_MS_ = 10000;

/** 보드에 쌓아둘 진행 카드 권장 상한 — 넘으면 프런트에서 정리 경고 */
var _CS_HB_SOFT_LIMIT_ = 20;

/** 중요도 — 순서가 곧 정렬 우선순위 */
var _CS_HB_LEVELS_ = ["긴급", "주의", "일반"];

var _CS_HB_STATUS_OPEN_ = "진행";
var _CS_HB_STATUS_DONE_ = "완료";

var _CS_HB_HEADERS_ = [
  "카드ID",      // A
  "등록일시",    // B
  "작성자",      // C
  "중요도",      // D
  "제목",        // E
  "내용",        // F
  "연결",        // G  주문/송장/고객명 — 주문 검색으로 바로 넘기는 키워드
  "전달내역",    // H  [yyMMdd HH:mm 작성자] 내용  (여러 줄)
  "읽음",        // I  담당자명 쉼표 목록
  "상태",        // J  진행 / 완료
  "완료일시",    // K
  "완료자",      // L
  "첨부",        // M  fileId|파일명|mime|yyMMdd HH:mm|올린이  (여러 줄)
  "출처키",      // N  자동 생성 카드의 원본. 반품 문의는 `반품:{탭}:{행}`
];

var _CS_HB_COL_ = {
  id: 0, at: 1, author: 2, level: 3, title: 4, body: 5,
  link: 6, notes: 7, read: 8, status: 9, doneAt: 10, doneBy: 11,
  att: 12, srcKey: 13,
};

/**
 * 출처키 — 협력업체 포털이 만든 카드를 다시 찾기 위한 열.
 *
 * 업체가 같은 반품 건에 두 번 문의하면 카드를 새로 만들지 않고
 * 그 카드의 전달내역에 쌓는다. 안 그러면 진행 카드가 금방 권장 상한(20장)을 넘는다.
 *
 * **`연결`(G열)에 이 키를 넣으면 안 된다.** 그 값은 `hbGoOrder` 가 주문 검색
 * 쿼리로 그대로 쓰므로 키가 섞이면 검색이 깨진다.
 *
 * 쓰는 쪽은 `Partner_WebApp/prpBoard.gs` 다. 그쪽은 위치가 아니라
 * **헤더명으로** 열을 찾으므로 여기 순서를 바꿔도 따라온다. 헤더명 자체를 바꾸면
 * 양쪽을 같이 고쳐야 한다.
 */
var _CS_HB_SRCKEY_HEADER_ = "출처키";

// ─────────────────────────────────────────────────────
//  첨부 설정
// ─────────────────────────────────────────────────────

/** 첨부 파일을 모아두는 Drive 폴더명 */
var _CS_HB_ATT_FOLDER_NAME_ = "CS_커뮤니티보드_첨부";
/** 이전 폴더명 — 남아 있으면 새 이름으로 바꿔 이어 쓴다 */
var _CS_HB_ATT_FOLDER_LEGACY_ = "CS_전달보드_첨부";
/** 폴더 ID를 기억해두는 스크립트 속성 키 */
var _CS_HB_ATT_FOLDER_PROP_ = "CS_HB_ATT_FOLDER_ID";
/** 파일 1개 최대 크기 (디코딩 후) */
var _CS_HB_ATT_MAX_BYTES_ = 8 * 1024 * 1024;
/** 카드 1장당 첨부 최대 개수 */
var _CS_HB_ATT_MAX_PER_CARD_ = 8;

// ─────────────────────────────────────────────────────
//  내부 헬퍼
// ─────────────────────────────────────────────────────

function _cs_hb_now_(fmt) {
  return Utilities.formatDate(new Date(), "Asia/Seoul", fmt || "yyyy-MM-dd HH:mm");
}

/** 전달내역 한 줄 머리 — 반품대장 타임라인과 동일 표기 */
function _cs_hb_stamp_(staff) {
  return "[" + _cs_hb_now_("yyMMdd HH:mm") + " " + (String(staff || "CS").trim() || "CS") + "]";
}

function _cs_hb_normLevel_(v) {
  var s = String(v == null ? "" : v).replace(/\s/g, "");
  for (var i = 0; i < _CS_HB_LEVELS_.length; i++) {
    if (s.indexOf(_CS_HB_LEVELS_[i]) !== -1) return _CS_HB_LEVELS_[i];
  }
  return "일반";
}

function _cs_hb_levelRank_(v) {
  var idx = _CS_HB_LEVELS_.indexOf(_cs_hb_normLevel_(v));
  return idx < 0 ? _CS_HB_LEVELS_.length : idx;
}

function _cs_hb_staff_(v) {
  return String(v == null ? "" : v).trim();
}

/** 보드 탭 — 없으면 헤더까지 만들어 반환. 열이 늘어난 버전이면 헤더만 갱신 */
function _cs_hb_getTab_() {
  var ss = SpreadsheetApp.openById(_CS_RETURN_LEDGER_ID_);
  var tab = ss.getSheetByName(_CS_HB_TAB_NAME_);

  // 이름만 바뀌었을 뿐 데이터는 그대로다. 옛 탭이 있으면 새 이름으로 바꿔 이어 쓴다.
  if (!tab) {
    var legacy = ss.getSheetByName(_CS_HB_TAB_LEGACY_);
    if (legacy) {
      try { legacy.setName(_CS_HB_TAB_NAME_); } catch (eR) {}
      tab = legacy;
    }
  }

  if (tab) {
    // 첨부 열이 나중에 추가됐다 — 기존 탭에 헤더를 채워준다 (데이터는 건드리지 않음)
    if (tab.getMaxColumns() < _CS_HB_HEADERS_.length) {
      tab.insertColumnsAfter(tab.getMaxColumns(), _CS_HB_HEADERS_.length - tab.getMaxColumns());
    }
    var hdr = tab.getRange(1, 1, 1, _CS_HB_HEADERS_.length).getDisplayValues()[0];
    var needFix = false;
    for (var h = 0; h < _CS_HB_HEADERS_.length; h++) {
      if (String(hdr[h] || "").trim() !== _CS_HB_HEADERS_[h]) { needFix = true; break; }
    }
    if (needFix) {
      tab.getRange(1, 1, 1, _CS_HB_HEADERS_.length).setValues([_CS_HB_HEADERS_]);
      tab.getRange(1, 1, 1, _CS_HB_HEADERS_.length)
        .setFontWeight("bold").setBackground("#4a90d9").setFontColor("#ffffff");
    }
    return tab;
  }

  tab = ss.insertSheet(_CS_HB_TAB_NAME_);
  tab.getRange(1, 1, 1, _CS_HB_HEADERS_.length).setValues([_CS_HB_HEADERS_]);
  tab.getRange(1, 1, 1, _CS_HB_HEADERS_.length)
    .setFontWeight("bold")
    .setBackground("#4a90d9")
    .setFontColor("#ffffff");
  tab.setFrozenRows(1);
  tab.setColumnWidth(1, 150); // 카드ID
  tab.setColumnWidth(2, 130); // 등록일시
  tab.setColumnWidth(5, 220); // 제목
  tab.setColumnWidth(6, 320); // 내용
  tab.setColumnWidth(8, 420); // 전달내역
  return tab;
}

function _cs_hb_newId_() {
  return "HB" + _cs_hb_now_("yyMMddHHmmss") +
    "-" + Math.floor(Math.random() * 900 + 100);
}

/** 카드ID로 행 찾기 (1-based sheet row). 없으면 -1 */
function _cs_hb_findRow_(tab, id) {
  id = String(id || "").trim();
  if (!id) return -1;
  var lr = tab.getLastRow();
  if (lr < 2) return -1;
  var ids = tab.getRange(2, _CS_HB_COL_.id + 1, lr - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || "").trim() === id) return i + 2;
  }
  return -1;
}

/** "[머리] 내용" 줄들을 파싱 — 프런트에서 작성자·시각을 따로 보여주기 위함 */
function _cs_hb_parseNotes_(raw) {
  var out = [];
  var lines = String(raw == null ? "" : raw).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var m = line.match(/^\[(\d{6})\s+(\d{1,2}:\d{2})\s+([^\]]+)\]\s*([\s\S]*)$/);
    if (m) {
      out.push({
        at: m[1].substring(0, 2) + "-" + m[1].substring(2, 4) + "-" + m[1].substring(4, 6) + " " + m[2],
        by: m[3].trim(),
        text: m[4].trim(),
        raw: line,
      });
    } else {
      out.push({ at: "", by: "", text: line, raw: line });
    }
  }
  return out;
}

function _cs_hb_appendNoteLine_(raw, line) {
  var cur = String(raw == null ? "" : raw).replace(/\s+$/, "");
  if (!cur) return line;
  return cur + "\n" + line;
}

function _cs_hb_readList_(raw) {
  var out = [];
  var parts = String(raw == null ? "" : raw).split(/[,\n]/);
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  }
  return out;
}

// ─────────────────────────────────────────────────────
//  첨부 — Drive 저장 / 파싱
// ─────────────────────────────────────────────────────

/**
 * 첨부 폴더. 반품관리대장이 있는 폴더 밑에 두어 관련 자료가 한곳에 모이게 한다.
 * 찾은 폴더 ID는 스크립트 속성에 캐시한다 (매번 이름으로 검색하면 느리다).
 */
function _cs_hb_attFolder_() {
  var props = PropertiesService.getScriptProperties();
  var saved = String(props.getProperty(_CS_HB_ATT_FOLDER_PROP_) || "").trim();
  if (saved) {
    try {
      var f = DriveApp.getFolderById(saved);
      if (f && !f.isTrashed()) return f;
    } catch (eF) {}
  }

  // 접속자 권한(USER_ACCESSING)으로 실행되므로 개인 Drive 루트로 흘리면 안 된다.
  // 첨부가 담당자별로 흩어져 서로 못 보게 되기 때문이다.
  //
  // 다만 대장을 파일만 공유받은 계정에서는 getParents() 가 비어 온다. 그 경우
  // 실패시키면 그 담당자는 첨부를 아예 못 하므로, 내 드라이브에 만들고 허용
  // 계정 전원을 편집자로 넣은 뒤 ID 를 속성에 박는다. 폴더가 하나로 유지되는
  // 조건은 그대로 지켜진다.
  var parent = null;
  try {
    var parents = DriveApp.getFileById(_CS_RETURN_LEDGER_ID_).getParents();
    if (parents.hasNext()) parent = parents.next();
  } catch (eP) {}

  var folder = null;
  if (parent) {
    var it = parent.getFoldersByName(_CS_HB_ATT_FOLDER_NAME_);
    if (it.hasNext()) {
      folder = it.next();
    } else {
      // 이름만 바뀐 옛 폴더가 있으면 그것을 이어 쓴다 (파일은 ID로 참조하므로 이동 불필요)
      var old = parent.getFoldersByName(_CS_HB_ATT_FOLDER_LEGACY_);
      if (old.hasNext()) {
        folder = old.next();
        try { folder.setName(_CS_HB_ATT_FOLDER_NAME_); } catch (eN) {}
      } else {
        folder = parent.createFolder(_CS_HB_ATT_FOLDER_NAME_);
      }
    }
  } else {
    var mine = DriveApp.getFoldersByName(_CS_HB_ATT_FOLDER_NAME_);
    folder = mine.hasNext() ? mine.next() : DriveApp.createFolder(_CS_HB_ATT_FOLDER_NAME_);
    if (typeof _cs_attShareFolder_ === "function") _cs_attShareFolder_(folder);
  }

  props.setProperty(_CS_HB_ATT_FOLDER_PROP_, folder.getId());
  return folder;
}

/** 시트에 넣을 때 구분자를 깨뜨리지 않도록 정리 */
function _cs_hb_attSafe_(s) {
  return String(s == null ? "" : s).replace(/[|\r\n]+/g, " ").trim();
}

/** "fileId|name|mime|at|by" 여러 줄 → 객체 배열 */
function _cs_hb_parseAtt_(raw) {
  var out = [];
  var lines = String(raw == null ? "" : raw).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var p = line.split("|");
    var fileId = String(p[0] || "").trim();
    if (!fileId) continue;
    var mime = String(p[2] || "").trim();
    out.push({
      fileId: fileId,
      name: String(p[1] || "첨부").trim(),
      mime: mime,
      at: String(p[3] || "").trim(),
      by: String(p[4] || "").trim(),
      isImage: /^image\//i.test(mime),
      // 썸네일·원본 주소는 파일 ID로 만들 수 있어 시트에 담지 않는다
      thumbUrl: "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w480",
      // 앱 안 확대보기용 큰 이미지. viewUrl 은 Drive 페이지라 <img> 로 못 쓴다
      bigUrl: "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w2048",
      viewUrl: "https://drive.google.com/file/d/" + fileId + "/view",
    });
  }
  return out;
}

function _cs_hb_attToLines_(list) {
  var lines = [];
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    lines.push([
      a.fileId, _cs_hb_attSafe_(a.name), _cs_hb_attSafe_(a.mime),
      _cs_hb_attSafe_(a.at), _cs_hb_attSafe_(a.by),
    ].join("|"));
  }
  return lines.join("\n");
}

/** 첨부 파일들을 휴지통으로. 카드가 사라질 때 고아 파일이 남지 않게 한다 */
function _cs_hb_trashAtt_(list) {
  var n = 0;
  for (var i = 0; i < list.length; i++) {
    try { DriveApp.getFileById(list[i].fileId).setTrashed(true); n++; } catch (eT) {}
  }
  return n;
}

function _cs_hb_rowToCard_(row, sheetRow) {
  var c = _CS_HB_COL_;
  var status = String(row[c.status] || "").trim() || _CS_HB_STATUS_OPEN_;
  var notes = _cs_hb_parseNotes_(row[c.notes]);
  var att = _cs_hb_parseAtt_(row[c.att]);
  return {
    att: att,
    attCount: att.length,
    id: String(row[c.id] || "").trim(),
    row: sheetRow,
    at: String(row[c.at] || "").trim(),
    author: String(row[c.author] || "").trim(),
    level: _cs_hb_normLevel_(row[c.level]),
    title: String(row[c.title] || "").trim(),
    body: String(row[c.body] || "").trim(),
    link: String(row[c.link] || "").trim(),
    notes: notes,
    noteCount: notes.length,
    read: _cs_hb_readList_(row[c.read]),
    status: status,
    done: status === _CS_HB_STATUS_DONE_,
    doneAt: String(row[c.doneAt] || "").trim(),
    doneBy: String(row[c.doneBy] || "").trim(),
    srcKey: String(row[c.srcKey] || "").trim(),
  };
}

/** 쓰기 작업 공통 래퍼 — 락 + 행 조회 + 예외를 한곳에서 처리 */
function _cs_hb_withCard_(id, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(_CS_HB_LOCK_MS_)) {
    return { ok: false, error: "다른 담당자가 보드를 수정 중입니다. 잠시 후 다시 시도하세요." };
  }
  try {
    var tab = _cs_hb_getTab_();
    var sheetRow = _cs_hb_findRow_(tab, id);
    if (sheetRow < 2) return { ok: false, error: "카드를 찾을 수 없습니다. 새로고침 후 다시 시도하세요." };
    var lastCol = Math.min(
      Math.max(tab.getLastColumn(), _CS_HB_HEADERS_.length), tab.getMaxColumns(),
    );
    var row = tab.getRange(sheetRow, 1, 1, lastCol).getDisplayValues()[0];
    return fn(tab, sheetRow, row);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    try { lock.releaseLock(); } catch (eL) {}
  }
}

// ─────────────────────────────────────────────────────
//  프런트 API
// ─────────────────────────────────────────────────────

/**
 * 보드 카드 목록
 * @param {Object} [opts]
 * @param {boolean} [opts.includeDone=false] 완료(보관) 카드까지 포함
 * @param {number} [opts.doneLimit=30] 완료 카드 최대 개수 (최신순)
 */
function csListHandoffCards(opts) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  opts = opts || {};
  try {
    var tab = _cs_hb_getTab_();
    var lr = tab.getLastRow();
    if (lr < 2) {
      return {
        ok: true, rows: [], activeCount: 0, doneCount: 0,
        softLimit: _CS_HB_SOFT_LIMIT_, levels: _CS_HB_LEVELS_,
      };
    }

    var lastCol = Math.min(
      Math.max(tab.getLastColumn(), _CS_HB_HEADERS_.length), tab.getMaxColumns(),
    );
    var data = tab.getRange(2, 1, lr - 1, lastCol).getDisplayValues();

    var active = [];
    var done = [];
    for (var i = 0; i < data.length; i++) {
      var card = _cs_hb_rowToCard_(data[i], i + 2);
      if (!card.id && !card.title && !card.body) continue; // 빈 행
      (card.done ? done : active).push(card);
    }

    // 진행 카드: 중요도 → 최신순. 등록일시는 yyyy-MM-dd HH:mm 이라 문자열 비교로 충분하다.
    active.sort(function (a, b) {
      var d = _cs_hb_levelRank_(a.level) - _cs_hb_levelRank_(b.level);
      if (d !== 0) return d;
      return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0);
    });
    done.sort(function (a, b) {
      var ka = a.doneAt || a.at, kb = b.doneAt || b.at;
      return ka < kb ? 1 : (ka > kb ? -1 : 0);
    });

    var rows = active;
    if (opts.includeDone) {
      var lim = parseInt(opts.doneLimit, 10);
      if (!(lim > 0)) lim = 30;
      rows = active.concat(done.slice(0, lim));
    }

    return {
      ok: true,
      rows: rows,
      activeCount: active.length,
      doneCount: done.length,
      softLimit: _CS_HB_SOFT_LIMIT_,
      levels: _CS_HB_LEVELS_,
      // 카드마다 "아직 안 본 사람"을 표시하려면 전체 담당자 명단이 필요하다
      staff: (function () {
        try { return getStaffList(); } catch (eS) { return []; }
      })(),
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), rows: [] };
  }
}

/**
 * 카드 생성
 * @param {Object} payload {level, title, body, link, staff}
 */
function csCreateHandoffCard(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var title = String(payload.title || "").trim();
  if (!title) return { ok: false, error: "제목을 입력하세요." };
  var staff = _cs_hb_staff_(payload.staff);
  if (!staff) return { ok: false, error: "담당자를 먼저 선택하세요." };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(_CS_HB_LOCK_MS_)) {
    return { ok: false, error: "다른 담당자가 보드를 수정 중입니다. 잠시 후 다시 시도하세요." };
  }
  try {
    var tab = _cs_hb_getTab_();
    var id = _cs_hb_newId_();
    var row = [];
    row[_CS_HB_COL_.id] = id;
    row[_CS_HB_COL_.at] = _cs_hb_now_();
    row[_CS_HB_COL_.author] = staff;
    row[_CS_HB_COL_.level] = _cs_hb_normLevel_(payload.level);
    row[_CS_HB_COL_.title] = title;
    row[_CS_HB_COL_.body] = String(payload.body || "").trim();
    row[_CS_HB_COL_.link] = String(payload.link || "").trim();
    row[_CS_HB_COL_.notes] = "";
    row[_CS_HB_COL_.read] = staff; // 작성자는 읽은 것으로 본다
    row[_CS_HB_COL_.status] = _CS_HB_STATUS_OPEN_;
    row[_CS_HB_COL_.doneAt] = "";
    row[_CS_HB_COL_.doneBy] = "";
    row[_CS_HB_COL_.att] = ""; // 파일은 카드 생성 직후 별도 호출로 올린다
    row[_CS_HB_COL_.srcKey] = String(payload.srcKey || "").trim();
    for (var i = 0; i < _CS_HB_HEADERS_.length; i++) {
      if (row[i] == null) row[i] = "";
    }

    tab.getRange(tab.getLastRow() + 1, 1, 1, _CS_HB_HEADERS_.length).setValues([row]);
    return { ok: true, id: id, message: "카드 등록됨" };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    try { lock.releaseLock(); } catch (eL) {}
  }
}

/**
 * 전달 내용 추가 (카드 안에 쌓이는 CS끼리의 대화)
 * @param {Object} payload {id, text, staff}
 */
function csAddHandoffNote(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var text = String(payload.text || "").trim();
  if (!text) return { ok: false, error: "전달 내용을 입력하세요." };
  var staff = _cs_hb_staff_(payload.staff);
  if (!staff) return { ok: false, error: "담당자를 먼저 선택하세요." };

  return _cs_hb_withCard_(payload.id, function (tab, sheetRow, row) {
    var next = _cs_hb_appendNoteLine_(
      row[_CS_HB_COL_.notes], _cs_hb_stamp_(staff) + " " + text,
    );
    tab.getRange(sheetRow, _CS_HB_COL_.notes + 1).setValue(next);

    // 글을 남긴 사람은 당연히 읽은 것
    var read = _cs_hb_readList_(row[_CS_HB_COL_.read]);
    if (read.indexOf(staff) === -1) {
      read.push(staff);
      tab.getRange(sheetRow, _CS_HB_COL_.read + 1).setValue(read.join(", "));
    }
    return {
      ok: true,
      notes: _cs_hb_parseNotes_(next),
      read: read,
      message: "전달 내용 추가됨",
    };
  });
}

/**
 * 읽음 표시
 * @param {Object} payload {id, staff}
 */
function csMarkHandoffRead(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var staff = _cs_hb_staff_(payload.staff);
  if (!staff) return { ok: false, error: "담당자가 지정되지 않았습니다." };

  return _cs_hb_withCard_(payload.id, function (tab, sheetRow, row) {
    var read = _cs_hb_readList_(row[_CS_HB_COL_.read]);
    if (read.indexOf(staff) !== -1) return { ok: true, read: read, changed: false };
    read.push(staff);
    tab.getRange(sheetRow, _CS_HB_COL_.read + 1).setValue(read.join(", "));
    return { ok: true, read: read, changed: true };
  });
}

/**
 * 완료 처리 — 보드에서 내리고 시트에는 남긴다 (보관)
 * @param {Object} payload {id, staff}
 */
function csCompleteHandoffCard(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var staff = _cs_hb_staff_(payload.staff);
  if (!staff) return { ok: false, error: "담당자를 먼저 선택하세요." };

  return _cs_hb_withCard_(payload.id, function (tab, sheetRow, row) {
    if (String(row[_CS_HB_COL_.status] || "").trim() === _CS_HB_STATUS_DONE_) {
      return { ok: true, already: true, message: "이미 완료된 카드입니다." };
    }
    var stampAt = _cs_hb_now_();
    tab.getRange(sheetRow, _CS_HB_COL_.status + 1).setValue(_CS_HB_STATUS_DONE_);
    tab.getRange(sheetRow, _CS_HB_COL_.doneAt + 1).setValue(stampAt);
    tab.getRange(sheetRow, _CS_HB_COL_.doneBy + 1).setValue(staff);
    tab.getRange(sheetRow, _CS_HB_COL_.notes + 1).setValue(
      _cs_hb_appendNoteLine_(row[_CS_HB_COL_.notes], _cs_hb_stamp_(staff) + " 처리 완료"),
    );
    return { ok: true, doneAt: stampAt, doneBy: staff, message: "완료 처리됨 (보관)" };
  });
}

/**
 * 완료 취소 — 보관에서 다시 보드로
 * @param {Object} payload {id, staff}
 */
function csReopenHandoffCard(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var staff = _cs_hb_staff_(payload.staff);
  if (!staff) return { ok: false, error: "담당자를 먼저 선택하세요." };

  return _cs_hb_withCard_(payload.id, function (tab, sheetRow, row) {
    tab.getRange(sheetRow, _CS_HB_COL_.status + 1).setValue(_CS_HB_STATUS_OPEN_);
    tab.getRange(sheetRow, _CS_HB_COL_.doneAt + 1).setValue("");
    tab.getRange(sheetRow, _CS_HB_COL_.doneBy + 1).setValue("");
    tab.getRange(sheetRow, _CS_HB_COL_.notes + 1).setValue(
      _cs_hb_appendNoteLine_(row[_CS_HB_COL_.notes], _cs_hb_stamp_(staff) + " 보드로 되돌림"),
    );
    return { ok: true, message: "보드로 되돌렸습니다." };
  });
}

/**
 * 카드 영구 삭제 — 이력까지 사라진다. 완료(보관)와 구분해서 쓴다.
 * 첨부 파일도 함께 휴지통으로 보내 Drive에 고아 파일이 쌓이지 않게 한다.
 * @param {Object} payload {id, staff}
 */
function csDeleteHandoffCard(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  return _cs_hb_withCard_(payload.id, function (tab, sheetRow, row) {
    var title = String(row[_CS_HB_COL_.title] || "").trim();
    var trashed = _cs_hb_trashAtt_(_cs_hb_parseAtt_(row[_CS_HB_COL_.att]));
    tab.deleteRow(sheetRow);
    return {
      ok: true, title: title, trashed: trashed,
      message: "카드 삭제됨" + (trashed ? " (첨부 " + trashed + "개 휴지통)" : ""),
    };
  });
}

/**
 * 첨부 1개 업로드. 클라이언트가 파일마다 한 번씩 호출한다.
 * 여러 개를 한 번에 보내면 payload가 커져 느려지고 실패도 잦다.
 *
 * @param {Object} payload {id, staff, name, mimeType, dataB64}
 */
function csAttachHandoffFile(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var staff = _cs_hb_staff_(payload.staff);
  if (!staff) return { ok: false, error: "담당자를 먼저 선택하세요." };
  var b64 = String(payload.dataB64 || "");
  if (!b64) return { ok: false, error: "파일 데이터가 비어 있습니다." };

  var bytes;
  try {
    bytes = Utilities.base64Decode(b64);
  } catch (eD) {
    return { ok: false, error: "파일을 읽을 수 없습니다." };
  }
  if (bytes.length > _CS_HB_ATT_MAX_BYTES_) {
    return {
      ok: false,
      error: "파일이 너무 큽니다 (" + Math.round(bytes.length / 1024 / 1024 * 10) / 10 +
        "MB). " + Math.round(_CS_HB_ATT_MAX_BYTES_ / 1024 / 1024) + "MB 이하로 올려주세요.",
    };
  }

  return _cs_hb_withCard_(payload.id, function (tab, sheetRow, row) {
    var list = _cs_hb_parseAtt_(row[_CS_HB_COL_.att]);
    if (list.length >= _CS_HB_ATT_MAX_PER_CARD_) {
      return { ok: false, error: "첨부는 카드당 " + _CS_HB_ATT_MAX_PER_CARD_ + "개까지입니다." };
    }

    var mime = String(payload.mimeType || "application/octet-stream").trim();
    var name = _cs_hb_attSafe_(payload.name) || ("첨부_" + _cs_hb_now_("yyMMdd_HHmmss"));
    var blob = Utilities.newBlob(bytes, mime, name);

    var file = _cs_hb_attFolder_().createFile(blob);
    // 링크를 아는 사람은 볼 수 있게 — 카드 썸네일이 각자 브라우저에서 바로 뜨도록
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (eS) {}

    var item = {
      fileId: file.getId(), name: name, mime: mime,
      at: _cs_hb_now_("yyMMdd HH:mm"), by: staff,
    };
    list.push(item);
    tab.getRange(sheetRow, _CS_HB_COL_.att + 1).setValue(_cs_hb_attToLines_(list));

    return { ok: true, attachments: _cs_hb_parseAtt_(_cs_hb_attToLines_(list)), message: "첨부됨" };
  });
}

/**
 * 첨부 1개 삭제 (Drive 휴지통 + 시트에서 제거)
 * @param {Object} payload {id, fileId, staff}
 */
function csDeleteHandoffAttachment(payload) {
  var _acg_ = _cs_ac_guard_(); if (_acg_) return _acg_;
  payload = payload || {};
  var fileId = String(payload.fileId || "").trim();
  if (!fileId) return { ok: false, error: "파일을 찾을 수 없습니다." };

  return _cs_hb_withCard_(payload.id, function (tab, sheetRow, row) {
    var list = _cs_hb_parseAtt_(row[_CS_HB_COL_.att]);
    var keep = [];
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].fileId === fileId) hit = list[i];
      else keep.push(list[i]);
    }
    if (!hit) return { ok: false, error: "이미 삭제된 첨부입니다." };

    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (eT) {}
    tab.getRange(sheetRow, _CS_HB_COL_.att + 1).setValue(_cs_hb_attToLines_(keep));
    return {
      ok: true,
      attachments: _cs_hb_parseAtt_(_cs_hb_attToLines_(keep)),
      message: "첨부 삭제됨",
    };
  });
}

/** 보드 연동 점검 — 탭 생성·권한·행 수 확인 */
function csDiagnoseHandoffBoard() {
  var out = { ok: false, tab: _CS_HB_TAB_NAME_, ssId: _CS_RETURN_LEDGER_ID_ };
  try {
    var tab = _cs_hb_getTab_();
    out.ok = true;
    out.ssName = tab.getParent().getName();
    out.lastRow = tab.getLastRow();
    out.lastCol = tab.getLastColumn();
    var list = csListHandoffCards({ includeDone: true });
    out.activeCount = list.activeCount || 0;
    out.doneCount = list.doneCount || 0;
    out.headerOk = out.lastCol >= _CS_HB_HEADERS_.length;
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}
