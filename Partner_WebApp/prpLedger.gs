/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 포털 — 반품관리대장 읽기·쓰기
 *
 *  CS 웹앱 csOrderSearch.gs 의 열 매핑 규칙을 그대로 복제했다.
 *  두 프로젝트가 분리되어 있어 코드를 공유할 수 없다.
 *  ★ 반품대장 헤더나 열 규칙이 바뀌면 이 파일도 같이 고쳐야 한다.
 *
 *  표준 레이아웃
 *    A 처리상태(헤더 무관, 강제)  B 반품접수날짜  C 접수자  D 업체명
 *    E 반품신청자                 F 연락처       G 수거입력처
 *    H 상품명                     I 수량         J 원송장번호
 *    K 교환/반품 구분             M 반품비       N 고객요청·비고(이력)
 * ══════════════════════════════════════════════════════════════
 */

// ── 헤더·열 매핑 (CS 웹앱과 동일 규칙) ─────────────────────────

function prpFindHeaderRow_(values) {
  var n = Math.min(values.length, 40);
  for (var i = 0; i < n; i++) {
    var row = values[i] || [];
    var joined = "";
    var hits = 0;
    for (var c = 0; c < row.length; c++) {
      var cell = String(row[c] || "").replace(/\s/g, "");
      if (!cell) continue;
      joined += cell + "|";
      if (/반품접수날짜|접수날짜|접수일자/.test(cell)) hits++;
      if (cell === "접수자") hits++;
      if (/원송장번호|원송장/.test(cell)) hits++;
      if (/상품명|품목명/.test(cell) && !/코드/.test(cell)) hits++;
    }
    if (hits >= 2) return i;
    if (/반품접수날짜|접수날짜/.test(joined)) return i;
  }
  return -1;
}

function prpMapCols_(header) {
  var col = {
    date: -1, staff: -1, vendor: -1, name: -1, phone: -1,
    pickup: -1, item: -1, qty: -1, invoice: -1, type: -1, fee: -1, status: -1, notice: -1,
    returnInvoice: -1
  };
  for (var i = 0; i < header.length; i++) {
    var h = String(header[i] || "").replace(/\s/g, "");
    if (!h) continue;
    if (col.date < 0 && /반품접수날짜|접수날짜|접수일자/.test(h)) col.date = i;
    else if (col.staff < 0 && h === "접수자") col.staff = i;
    else if (col.vendor < 0 && /업체명|판매처|발주업체/.test(h)) col.vendor = i;
    else if (col.name < 0 && /반품신청자|수취인명|수취인|받는분/.test(h) && !/전화|주소/.test(h)) col.name = i;
    else if (col.phone < 0 && /연락처|전화|휴대폰/.test(h) && !/주소/.test(h)) col.phone = i;
    else if (col.pickup < 0 && /수거입력처/.test(h)) col.pickup = i;
    else if (col.item < 0 && /상품명|품목명/.test(h) && !/코드/.test(h)) col.item = i;
    else if (col.qty < 0 && (h === "수량" || h.indexOf("수량") === 0)) col.qty = i;
    else if (col.invoice < 0 && /원송장|송장번호/.test(h) && !/회수|재발송|반품송장/.test(h)) col.invoice = i;
    else if (col.returnInvoice < 0 && /반품송장|회수송장/.test(h)) col.returnInvoice = i;
    else if (col.type < 0 && /교환.?반품|반품구분/.test(h)) col.type = i;
    else if (col.fee < 0 && /반품비|반품운임|반품배송비/.test(h)) col.fee = i;
    else if (col.notice < 0 && /고객요청|유의사항|비고/.test(h)) col.notice = i;
  }
  col.status = 0;             // A열 = 처리상태
  if (col.fee < 0) col.fee = 12; // M열 = 반품비
  return col;
}

// ── 값 포맷 (CS 웹앱과 동일) ──────────────────────────────────

function prpFormatFee_(v) {
  if (v === null || v === undefined || v === "") return "";
  var s = String(v).trim();
  if (!s || s === "-") return "";
  if (/원/.test(s)) return s;
  if (!/^-?[\d,]+(\.\d+)?$/.test(s)) return s;
  var n = parseFloat(s.replace(/,/g, ""));
  if (isNaN(n)) return s;
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
}

function prpFeeNumber_(v) {
  var s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function prpFormatPhone_(raw) {
  var d = prpDigits_(raw);
  if (d.length === 11) return d.substring(0, 3) + "-" + d.substring(3, 7) + "-" + d.substring(7);
  if (d.length === 10) return d.substring(0, 3) + "-" + d.substring(3, 6) + "-" + d.substring(6);
  return String(raw || "").trim();
}

function prpFormatInvoice_(raw) {
  var s = String(raw || "").trim();
  var parts = s.match(/\d{10,14}/g);
  if (parts && parts.length) {
    var d = parts[0];
    if (d.length === 12) return d.substring(0, 4) + "-" + d.substring(4, 8) + "-" + d.substring(8);
    return d;
  }
  var dAll = prpDigits_(s);
  if (dAll.length === 12) return dAll.substring(0, 4) + "-" + dAll.substring(4, 8) + "-" + dAll.substring(8);
  return s || dAll;
}

function prpYmdFromCell_(raw) {
  var s = String(raw || "").trim();
  var m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return "20" + m[1] + m[2] + m[3];
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return m[1] + ("0" + m[2]).slice(-2) + ("0" + m[3]).slice(-2);
  return "";
}

function prpParseReturnInvFromNotice_(text) {
  var s = String(text || "");
  var m = s.match(/반품송장\s*[:：]\s*([0-9\-]+)/i);
  if (m) return String(m[1] || "").trim();
  m = s.match(/회수송장\s*[:：]\s*([0-9\-]+)/i);
  if (m) return String(m[1] || "").trim();
  return "";
}

function prpIsDoneMark_(v) {
  var raw = String(v == null ? "" : v).trim();
  if (!raw) return false;
  var s = raw.replace(/\s/g, "");
  if (s === "완료" || s.indexOf("완료") === 0) return true;
  if (/이카운트\s*ok/i.test(raw)) return true;
  return false;
}

function prpRowHasData_(row, col) {
  if (!row) return false;
  var keys = [col.date, col.name, col.item, col.phone, col.invoice, col.status];
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] < 0) continue;
    var v = String(row[keys[i]] || "").trim();
    if (v && v !== "-") return true;
  }
  return false;
}

// ── 월별 탭 ───────────────────────────────────────────────────

function prpIsMonthName_(name) {
  return /^\d{6}$/.test(String(name || "").trim());
}

function prpMonthsToScan_(days) {
  days = days || PRP_DEFAULT_DAYS;
  var months = Math.max(2, Math.ceil(days / 28) + 1);
  var out = [];
  var d = prpNow_();
  for (var i = 0; i < months; i++) {
    var mk = Utilities.formatDate(d, "Asia/Seoul", "yyyyMM");
    if (out.indexOf(mk) < 0) out.push(mk);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/**
 * 접수용 당월 탭.
 * 업체 접수가 그 달 첫 기록일 수 있으므로 탭 생성 로직도 CS 와 동일하게 갖춘다.
 */
function prpGetWriteTab_(ss) {
  var monthKey = Utilities.formatDate(prpNow_(), "Asia/Seoul", "yyyyMM");
  var tab = ss.getSheetByName(monthKey);
  if (tab) return tab;

  var sheets = ss.getSheets();
  var monthTabs = [];
  for (var i = 0; i < sheets.length; i++) {
    if (prpIsMonthName_(sheets[i].getName())) monthTabs.push({ name: sheets[i].getName(), tab: sheets[i] });
  }
  monthTabs.sort(function (a, b) { return b.name.localeCompare(a.name); });

  var template = null;
  for (var j = 0; j < monthTabs.length; j++) {
    if (monthTabs[j].name < monthKey) { template = monthTabs[j].tab; break; }
  }
  if (!template && monthTabs.length) template = monthTabs[0].tab;
  if (!template) {
    for (var g = 0; g < sheets.length; g++) {
      if (sheets[g].getSheetId() === PRP_LEDGER_GID) { template = sheets[g]; break; }
    }
  }
  if (!template) return null;

  tab = template.copyTo(ss);
  tab.setName(monthKey);
  try { ss.setActiveSheet(tab); ss.moveActiveSheet(0); } catch (e) {}

  // 복사본의 데이터 행만 비운다 (열 구조·서식 유지)
  var lastCol = Math.max(tab.getLastColumn(), 15);
  var scan = Math.max(tab.getLastRow(), 40);
  var values = tab.getRange(1, 1, scan, lastCol).getDisplayValues();
  var headerIdx = prpFindHeaderRow_(values);
  if (headerIdx >= 0) {
    var dataStart = headerIdx + 2;
    var lr = tab.getLastRow();
    if (lr >= dataStart) tab.getRange(dataStart, 1, lr - dataStart + 1, lastCol).clearContent();
  }
  return tab;
}

// ── 공개 타임라인 ─────────────────────────────────────────────

/**
 * N열 비고를 업체에게 보여줄 이력으로 가공한다.
 *
 * 공개 기준은 PRP_PUBLIC_TIMELINE_KINDS 와 PRP_INTERNAL_MARK_ 두 개다.
 * 기본이 공개이고, 숨기려면 CS 가 `[내부]` 를 붙인다 (prpConfig.gs 참고).
 *
 * 사진은 CS 가 올린 것도 공개한다 — 본문에 URL 이 들어 있어 그대로 링크가 된다.
 * 업체 본인이 남긴 문의는 작성자 태그("업체:{업체명}")로 구분해 "우리 문의"로 낸다.
 *
 * 담당자 실명은 어떤 경우에도 내보내지 않는다. `who` 는 항상 역할 이름이다.
 */
function prpPublicTimeline_(notice, status, staff, date, type, vendorName) {
  var events = [];
  var lines = String(notice || "").split(/\n/);
  var mineTag = PRP_STAFF_PREFIX + String(vendorName || "").trim();
  var allow = PRP_PUBLIC_TIMELINE_KINDS || [];

  for (var i = 0; i < lines.length; i++) {
    var ln = String(lines[i] || "").trim();
    if (!ln) continue;
    if (/^반품송장\s*[:：]|^회수송장\s*[:：]/.test(ln)) continue; // meta — 별도 필드로 이미 나간다

    var m = ln.match(/^\[(\d{6})\s+(\d{1,2}:\d{2})\s+([^\]]+)\]\s*(.*)$/);
    if (!m) continue; // 형식 없는 옛 메모 — 무엇이 섞였는지 몰라 공개하지 않는다

    var who = String(m[3] || "").trim();
    var body = String(m[4] || "").trim();
    var isMine = (who === mineTag);

    // 업체 본인 글에는 내부 표시가 적용되지 않는다 (자기가 쓴 것이다)
    if (!isMine && PRP_INTERNAL_MARK_.test(body)) continue;

    if (/^상태→/.test(body)) {
      if (allow.indexOf("status") < 0) continue;
      events.push({
        kind: "status",
        date: m[1], time: m[2],
        who: "CS팀",
        text: body.replace(/^상태→/, "").trim(),
        sortKey: prpSortKey_(m[1], m[2])
      });
      continue;
    }

    if (isMine) {
      events.push({
        kind: "mine",
        date: m[1], time: m[2],
        who: "우리 문의",
        text: body,
        sortKey: prpSortKey_(m[1], m[2])
      });
      continue;
    }

    // 사진 첨부 — CS앱(csAttach)과 포털(prpAttach)이 같은 문구로 남긴다
    var isPhoto = /^사진\s*첨부/.test(body) && /https?:\/\//.test(body);
    var kind = isPhoto ? "photo" : "consult";
    if (allow.indexOf(kind) < 0) continue;

    events.push({
      kind: kind,
      date: m[1], time: m[2],
      who: isPhoto ? "CS팀 사진" : "CS팀",
      text: body,
      sortKey: prpSortKey_(m[1], m[2])
    });
  }

  if (date && PRP_PUBLIC_TIMELINE_KINDS.indexOf("access") >= 0) {
    var openedBy = String(staff || "").indexOf(PRP_STAFF_PREFIX) === 0 ? "우리 접수" : "CS팀 접수";
    events.push({
      kind: "access",
      date: date, time: "",
      who: openedBy,
      text: "반품 접수" + (type ? " · " + type : ""),
      sortKey: prpSortKeyFromYmd_(date)
    });
  }

  events.sort(function (a, b) {
    return String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
  });
  return events;
}

function prpSortKey_(yymmdd, hm) {
  var ymd = prpYmdFromCell_(yymmdd);
  if (!ymd) return "000000000000";
  var t = String(hm || "00:00").replace(/[^0-9]/g, "");
  while (t.length < 4) t += "0";
  return ymd + t.substring(0, 4);
}

function prpSortKeyFromYmd_(yymmdd) {
  var ymd = prpYmdFromCell_(yymmdd);
  return ymd ? (ymd + "0000") : "000000000000";
}

// ── 업체별 조회 ───────────────────────────────────────────────

/** 이 행이 요청한 업체 것인지 — 정규화 키 + 별칭으로 판정 */
function prpRowBelongsTo_(vendorCell, sess) {
  var k = prpVendorKey_(vendorCell);
  if (!k) return false;
  if (k === sess.key) return true;
  var al = sess.aliases || [];
  for (var i = 0; i < al.length; i++) {
    if (k === al[i]) return true;
  }
  return false;
}

/**
 * 탭 하나에서 이 업체 건만 카드로 만든다.
 * 마스킹은 여기서 끝낸다 — 이 함수를 통과한 객체만 클라이언트로 나간다.
 */
function prpReadTabCases_(tab, tabName, cutoffYmd, sess) {
  if (!tab) return [];
  var lastCol = Math.max(tab.getLastColumn(), 15);
  var lastRow = tab.getLastRow();
  if (lastRow < 5) return [];

  var values = tab.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headerIdx = prpFindHeaderRow_(values);
  if (headerIdx < 0) return [];

  var col = prpMapCols_(values[headerIdx]);
  if (col.vendor < 0) return []; // 업체 열이 없으면 격리 불가 — 아무것도 내보내지 않는다

  var out = [];
  for (var ri = headerIdx + 1; ri < values.length; ri++) {
    var row = values[ri];
    if (!prpRowHasData_(row, col)) continue;
    if (!prpRowBelongsTo_(row[col.vendor], sess)) continue;

    var dateYmd = prpYmdFromCell_(col.date >= 0 ? row[col.date] : "");
    if (cutoffYmd && dateYmd && dateYmd < cutoffYmd) continue;

    var status = String(row[0] || "").trim();
    var notice = col.notice >= 0 ? String(row[col.notice] || "").trim() : "";
    var staffVal = col.staff >= 0 ? String(row[col.staff] || "").trim() : "";
    var dateVal = col.date >= 0 ? String(row[col.date] || "").trim() : "";
    var typeVal = col.type >= 0 ? String(row[col.type] || "").trim() : "";
    var invRaw = col.invoice >= 0 ? String(row[col.invoice] || "").trim() : "";

    out.push({
      tab: tabName,
      row: ri + 1,
      date: dateVal,
      dateYmd: dateYmd,
      // 접수자 실명은 내보내지 않는다. 누가 접수했는지만 구분되면 충분하다.
      openedBy: staffVal.indexOf(PRP_STAFF_PREFIX) === 0 ? "우리" : "CS팀",
      name: col.name >= 0 ? String(row[col.name] || "").trim() : "",
      phone: col.phone >= 0 ? prpFormatPhone_(row[col.phone]) : "",
      item: col.item >= 0 ? String(row[col.item] || "").trim() : "",
      qty: col.qty >= 0 ? String(row[col.qty] || "").trim() : "",
      invoice: invRaw,
      invDigits: prpDigits_(invRaw),
      // 전용 열 우선, 없으면 과거 방식(N열 비고)에서 읽는다
      returnInvoice: (col.returnInvoice >= 0 ? String(row[col.returnInvoice] || "").trim() : "") ||
        prpParseReturnInvFromNotice_(notice),
      type: typeVal,
      status: status || "접수",
      pickup: col.pickup >= 0 ? String(row[col.pickup] || "").trim() : "",
      fee: col.fee >= 0 ? prpFormatFee_(row[col.fee]) : "",
      feeNum: col.fee >= 0 ? prpFeeNumber_(row[col.fee]) : 0,
      done: prpIsDoneMark_(status),
      timeline: prpPublicTimeline_(notice, status, staffVal, dateVal, typeVal, sess.vendor),
      sortKey: (dateYmd || "00000000") + "_" + String(100000 - ri)
    });
  }
  return out;
}

/** 업체별 캐시 — 다른 업체 데이터가 같은 키에 섞이지 않게 업체키를 반드시 넣는다 */
function prpLoadVendorCases_(sess, days, refresh) {
  days = days || PRP_DEFAULT_DAYS;
  var cache = CacheService.getScriptCache();
  var ck = PRP_CACHE_VER + "_v_" + sess.key + "_" + days;

  if (!refresh) {
    try {
      var hit = cache.get(ck);
      if (hit) return JSON.parse(hit) || [];
    } catch (e) {}
  }

  var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
  var monthKeys = prpMonthsToScan_(days);
  var cutoffYmd = prpDaysAgoYmd_(days);
  var all = [];

  for (var mi = 0; mi < monthKeys.length; mi++) {
    var tab = ss.getSheetByName(monthKeys[mi]);
    if (!tab) continue;
    var chunk = prpReadTabCases_(tab, monthKeys[mi], cutoffYmd, sess);
    for (var ci = 0; ci < chunk.length; ci++) all.push(chunk[ci]);
  }

  all.sort(function (a, b) {
    return String(b.sortKey || "").localeCompare(String(a.sortKey || ""));
  });

  try { cache.put(ck, JSON.stringify(all), PRP_CACHE_TTL); } catch (e) {}
  return all;
}

function prpInvalidateVendorCache_(vendorKey) {
  var cache = CacheService.getScriptCache();
  var spans = [30, 90, 180, 365, PRP_DEFAULT_DAYS];
  for (var i = 0; i < spans.length; i++) {
    try { cache.remove(PRP_CACHE_VER + "_v_" + vendorKey + "_" + spans[i]); } catch (e) {}
  }
}

// ── 행 접근 (쓰기 전 소유 검증) ───────────────────────────────

/**
 * 업체가 특정 행을 건드리려 할 때, 그 행이 정말 그 업체 것인지 확인한다.
 * 클라이언트가 tab/row 를 임의로 바꿔 보낼 수 있으므로 반드시 서버에서 검증한다.
 */
function prpOpenOwnedRow_(sess, tabName, rowNum) {
  var ss = SpreadsheetApp.openById(PRP_LEDGER_ID);
  var tab = ss.getSheetByName(String(tabName || "").trim());
  if (!tab) throw new Error("탭을 찾을 수 없습니다.");
  rowNum = parseInt(rowNum, 10);
  if (!(rowNum > 0)) throw new Error("행 번호가 잘못되었습니다.");

  var lastCol = Math.max(tab.getLastColumn(), 15);
  var headerScan = tab.getRange(1, 1, Math.min(Math.max(tab.getLastRow(), rowNum), 40), lastCol).getDisplayValues();
  var headerIdx = prpFindHeaderRow_(headerScan);
  if (headerIdx < 0) throw new Error("반품대장 헤더를 찾지 못했습니다.");

  var col = prpMapCols_(headerScan[headerIdx]);
  if (col.vendor < 0) throw new Error("업체명 열을 찾지 못했습니다.");

  var row = tab.getRange(rowNum, 1, 1, lastCol).getDisplayValues()[0];
  if (!prpRowBelongsTo_(row[col.vendor], sess)) {
    prpLog_(sess.vendor, "거부", "타 업체 행 접근 시도 " + tabName + " " + rowNum + "행");
    throw new Error("이 건에 대한 권한이 없습니다.");
  }
  return { tab: tab, col: col, rowNum: rowNum, row: row, lastCol: lastCol };
}

function prpAppendNoticeLine_(existing, line) {
  var s = String(existing || "").trim();
  return s ? (s + "\n" + line) : line;
}
