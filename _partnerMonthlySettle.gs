/**
 * [협력업체] 발주 및 송장조회 → 월별 발주 마감 시스템  v4.2
 * 파일: _partnerMonthlySettle.gs
 *
 * ★ 핵심 흐름 ★
 *   각 협력업체 파일의 「발주 및 송장조회」탭을 스캔
 *   → 송장번호가 입력된 행만 이동
 *   → 같은 파일 내 「(YYYY년 M월) 발주 마감」탭으로 이동
 *   → 원본 행 삭제 (A열·L열 spill 수식 보호)
 *
 * ★ 올바른 워크플로우 ★
 *   ① 송장 수집 (partnerFetchInvoices)  ← 반드시 먼저 실행
 *   ② 월별 정산 이동 (이 함수)          ← 송장 수집 후 실행
 *   ※ 이동 후에는 추가 송장 수집이 발주마감 탭에 반영되지 않음
 *
 * ★ 취소·반품 체크박스 열 의미 ★
 *   발주마감 탭의 확장 열(취소 / 반품 / 취소반품사유 / 반품송장번호)은 이동 조건과 무관.
 *   → 배송 완료(송장 있음) 후 소비자 사유로 취소·반품이 발생했을 때
 *      해당 행을 체크 → 사유 입력 → 반품송장번호 기입
 *      체크된 행은 정산 합계에서 자동 제외됨.
 *   → 정산 시 합계 = 취소·반품 체크된 행을 뺀 실발송 건 기준
 *
 * ★ 보호 설정 ★
 *   헤더(1~4행)만 보호, 데이터 영역(5행~)은 편집 가능
 *
 * ⚠ 상품정보시트에 탭을 추가하지 않음
 */

// ── 탭 상수 (독립배포 ARCH_MONTH_* 와 동일)
var _PMS_HEADER_ROW    = 4;   // 헤더 행
var _PMS_DATA_START    = 5;   // 데이터 시작 행
var _PMS_KEY_CELL      = "AZ1";
var _PMS_KEY_PREFIX    = "PARTNER_ARCHIVE_MONTH:";
var _PMS_ORDER_TAB     = "발주 및 송장조회";  // ← 소스 탭 (전용양식 X)
var _PMS_AMT_TOLERANCE = 1; // 원 단위

/** 금액/수량 파싱 (콤마·원·#N/A 대응) */
function _pms_toNumber_(v) {
  if (typeof v === "number" && isFinite(v)) return v;
  if (v instanceof Date) return 0;
  var s = String(v == null ? "" : v)
    .replace(/,/g, "")
    .replace(/원/g, "")
    .replace(/￦/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!s || s.charAt(0) === "#") return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** 발주탭 L열 헤더가 개별단가인지 (마감 시 ×수량 대상) */
function _pms_isUnitPriceHeader_(header) {
  var h = String(header || "").replace(/\s/g, "");
  if (!h) return false;
  if (h === "정산금액") return false; // 구형: 이미 줄합계
  if (h === "단가" || h.indexOf("단가(자동)") !== -1) return true;
  if (h.indexOf("정산단가") !== -1 || h.indexOf("확정단가") !== -1) return true;
  if (h.indexOf("정산금액(자동)") !== -1 || h.indexOf("(자동)") !== -1) return true;
  if (h.indexOf("단가") !== -1 && h.indexOf("조회") === -1) return true;
  return false;
}

/**
 * 마감 정산금액 = 개별단가 × 수량 (중복곱·미곱·미기입 보정)
 * @return {{ amount: number, note: string }}
 */
function _pms_resolveArchiveLineAmount_(rawPrice, qty, priceHeader, lookupUnit) {
  var raw = _pms_toNumber_(rawPrice);
  var q = _pms_toNumber_(qty);
  var lookup = _pms_toNumber_(lookupUnit);
  if (!(q > 0)) q = 1;

  if (!(raw > 0) && lookup > 0) {
    raw = lookup;
  }
  if (!(raw > 0)) {
    return { amount: 0, note: "no_price" };
  }
  if (q === 1) {
    return { amount: Math.round(raw), note: "qty1" };
  }

  // 단가조회 단가로 이미합계/개별단가 판정
  if (lookup > 0) {
    if (Math.abs(raw - lookup * q) <= _PMS_AMT_TOLERANCE) {
      return { amount: Math.round(raw), note: "already_total" };
    }
    if (Math.abs(raw - lookup) <= _PMS_AMT_TOLERANCE) {
      return { amount: Math.round(lookup * q), note: "unit_x_qty" };
    }
  }

  if (_pms_isUnitPriceHeader_(priceHeader)) {
    return { amount: Math.round(raw * q), note: "hdr_unit" };
  }
  // 구형 헤더「정산금액」: 이미 줄합계로 보고 유지
  if (String(priceHeader || "").replace(/\s/g, "") === "정산금액") {
    return { amount: Math.round(raw), note: "hdr_total" };
  }
  // 기본: 개별단가로 보고 곱함 (1개분만 마감되던 사고 방지)
  return { amount: Math.round(raw * q), note: "default_mul" };
}

/**
 * 날짜 셀 값을 받아 "yyyyMMdd" 형식의 8자리 문자열로 다드면서 리턴.
 * 모든 형식이 실패하면 null 리턴.
 * ★ 지원 형식:
 *   - Date 객체 → Utilities.formatDate
 *   - Google Sheets 날짜 시리얼(숫자, 40000~60000 범위) → Date 변환 후 포맷
 *   - "YYYYMMDD" 형식 문자열 → 직접 사용
 *   - 기타 문자열 → 숫자만 추출 후 YYYYMMDD 판별
 * ★ 유효성 검사:
 *   - 연도 2000~2099, 월 1~12 범위를 벗어나면 null
 */
function _pms_parseDateStr_(orderDate) {
  var dateStr = "";

  if (orderDate instanceof Date) {
    // Date 객체 → 정상 포맷
    dateStr = Utilities.formatDate(orderDate, "Asia/Seoul", "yyyyMMdd");

  } else if (typeof orderDate === "number") {
    // Google Sheets 날짜 시리얼 (38000~60000 범위) → Date 변환
    if (orderDate > 20000101 && orderDate <= 21001231) {
      // 이미 YYYYMMDD 숫자로 저장된 경우
      dateStr = String(Math.floor(orderDate));
    } else if (orderDate >= 38000 && orderDate <= 62000) {
      // 시리얼 당일 수 → JS Date (기준: 1900-01-01 = 1)
      var msPerDay = 86400000;
      var baseMs = new Date(1899, 11, 30).getTime(); // 1899-12-30
      var d = new Date(baseMs + orderDate * msPerDay);
      dateStr = Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd");
    } else {
      return null;
    }

  } else {
    // 문자열 전성: 숫자만 추출
    dateStr = String(orderDate).replace(/[^0-9]/g, "");
  }

  if (!dateStr || dateStr.length < 8) return null;
  dateStr = dateStr.substring(0, 8);

  var yyyy = parseInt(dateStr.substring(0, 4), 10);
  var mm   = parseInt(dateStr.substring(4, 6), 10);

  // 유효성 검사: 연도 2000~2099, 월 1~12
  if (yyyy < 2000 || yyyy > 2099) return null;
  if (mm < 1 || mm > 12) return null;

  return dateStr;
}


// ──────────────────────────────────────────────────────
//  공개 함수
// ──────────────────────────────────────────────────────

/** [수동] 발주 및 송장조회 완료건 → 같은 파일 내 월별 마감 탭으로 이동
 *  ★ 2026-07-16: 비차단(non-blocking) 방식.
 *  확인창 → 빠른 초기화(임시기록/큐 저장) → 백그라운드 트리거로 실제 처리.
 *  ★ ScriptLock을 시작 단계에서 잡지 않음 — 백그라운드 배치가 락을 잡는 동안
 *    「다른 작업 진행 중」으로 막히던 문제 해결. */
/**
 * ══════════════════════════════════════════════════════════════
 *  밤에 스스로 시작한다 — 사람이 누르고 기다릴 일이 아니다
 *  2026-09-15
 *
 *  > "그럼 이기능을 어떻게 쓰라는거지?"
 *
 *  17개 파일을 배치로 나눠 도니 끝까지 몇십 분이 걸린다. 사람이 누르고
 *  기다리면 그동안 아무것도 못 하고, 끝났는지도 모른다. 쓸 수가 없다.
 *
 *  ★ 밤 22시 통합마감이 «시작만» 시킨다 ★
 *    큐를 담고 재개 트리거 하나를 걸면 그 뒤는 저절로 이어진다.
 *    22시 작업은 6분 예산이 있으므로 여기서 배치를 돌리지 않는다 —
 *    시작만 하고 바로 빠진다.
 *    아침에 Chat 알림으로 결과만 본다. 사람이 누를 일이 없어진다.
 *
 *  ★ 새 트리거를 만들지 않는다 ★
 *    한 프로젝트에 트리거는 20개까지다. 재개 트리거는 일회용이라
 *    자리를 늘리지 않는다 — 돌고 나면 스스로 지운다.
 * ══════════════════════════════════════════════════════════════
 *
 * @return {string} 무슨 일이 있었는지 한 줄 (밤 작업 로그에 남긴다)
 */
function pmsStartBackground() {
  //  이미 돌고 있으면 건드리지 않는다 — 두 번 돌면 같은 파일을 두 번 옮긴다
  var 남은 = _pms_loadResumeState_();
  if (남은 && 남은.queue && 남은.queue.length > 0) {
    var st = _pms_runState_();
    if (st.돌고있나) return '이미 진행 중 (남은 파일 ' + 남은.queue.length + '개)';
    //  깃발만 남고 멈춰 있다 — 처음부터 다시 건다
    _pms_clearResumeState_();
  }

  var files = _pt_listFiles();
  if (!files || !files.length) return '협력업체 파일 없음';

  var todayNum = parseInt(
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), 10);
  var errMsgs = [], tempCleared = 0, tempKept = 0;
  try {
    var _hubSS_ = SpreadsheetApp.openById(_PT.INFO_SS_ID);
    var _tempTab_ = _po_getNonPartnerTempTab_(_hubSS_);
    if (_tempTab_) {
      var _c_ = _po_clearTempTabInvoicedRowsOnly_(_tempTab_);
      tempCleared = _c_.cleared;
      tempKept = _c_.kept;
    }
  } catch (e) { errMsgs.push("[임시기록초기화] " + e.message); }

  _pms_saveResumeState_({
    queue: files.map(function (f) { return { id: f.id, name: f.name }; }),
    todayNum: todayNum,
    archived: 0, failed: 0, errMsgs: errMsgs,
    tempCleared: tempCleared, tempKept: tempKept
  });
  var ok = _pms_scheduleResume_(5 * 1000);
  if (!ok) {
    _pms_clearResumeState_();
    return '예약 실패 — ' + _pt_triggerFailWhy_(_PMS_LAST_TRIGGER_ERR_).split(String.fromCharCode(10)).join(' / ');
  }
  return '시작함 (' + files.length + '개 파일)';
}

function partnerArchiveToMonthlySettle() {
  var ui = SpreadsheetApp.getUi();

  // ★ 이미 백그라운드 진행 중이면 재시작 여부만 확인 (ScriptLock 불필요)
  var existing = _pms_loadResumeState_();
  if (existing && existing.queue && existing.queue.length > 0) {
    /* ★ 깃발이 아니라 «트리거»를 본다 ★  (2026-09-15)
       > "마감이동을 할수가 없네.. 백그라운드에서 하지도 못하는거 같은데.."

       여태 큐에 남은 파일이 있으면 「진행 중」이라 했다. 그런데 백그라운드는
       재개 트리거가 굴린다 — 트리거가 죽으면 큐만 남고, 시스템이 «없는 일»을
       있다고 말한다. 그러면 사람은 영영 다시 못 돌린다. */
    var 상태 = _pms_runState_();
    var cfBusy;
    if (상태.돌고있나) {
      cfBusy = ui.alert(
        "⏳ 대리판매 마감 진행 중",
        "백그라운드에서 처리 중입니다.\n" +
        "시작: " + 상태.시작 + " (" + _pms_ago_(상태.지난분) + ")\n" +
        "남은 파일: " + existing.queue.length + "개\n\n" +
        "· 예 = 강제 재시작 (현재 진행 취소 후 처음부터)\n" +
        "· 아니오 = 그대로 두기 (완료 시 Chat 알림)",
        ui.ButtonSet.YES_NO
      );
    } else {
      /*  돌고 있지 않다. 「진행 중」이라 하면 사람이 하염없이 기다린다.
          멈췄다고 «그 까닭과 함께» 말하고 바로 이어 준다. */
      cfBusy = ui.alert(
        "⚠ 대리판매 마감이 멈춰 있습니다",
        상태.왜 + "\n\n" +
        "시작: " + 상태.시작 + " (" + _pms_ago_(상태.지난분) + ")\n" +
        "남은 파일: " + existing.queue.length + "개\n\n" +
        "· 예 = 처음부터 다시 시작\n" +
        "· 아니오 = 그대로 두기",
        ui.ButtonSet.YES_NO
      );
    }
    if (cfBusy !== ui.Button.YES) return;
    _pms_clearResumeState_();
  }

  var cf = ui.alert("월별 정산 이동",
    "각 협력업체 파일의 「발주 및 송장조회」탭에서\n" +
    "송장번호가 입력된 행을 월별 마감 탭으로 이동합니다.\n\n" +
    "⚠ 송장 수집을 먼저 실행한 뒤 이 기능을 사용하세요.\n\n" +
    "▶ 확인을 누르면 백그라운드에서 처리되며,\n" +
    "   완료 시 Google Chat 알림이 전송됩니다.\n\n계속할까요?",
    ui.ButtonSet.YES_NO);
  if (cf !== ui.Button.YES) return;

  var scheduled = false;
  try {
    var files = _pt_listFiles();
    if (!files || !files.length) { ui.alert("협력업체 파일 없음"); return; }

    _pms_clearResumeState_();

    var todayNum = parseInt(
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), 10);

    var errMsgs = [], tempCleared = 0, tempKept = 0;
    try {
      var _hubSS_ = SpreadsheetApp.openById(_PT.INFO_SS_ID);
      var _tempTab_ = _po_getNonPartnerTempTab_(_hubSS_);
      if (_tempTab_) {
        var _tempClear_ = _po_clearTempTabInvoicedRowsOnly_(_tempTab_);
        tempCleared = _tempClear_.cleared;
        tempKept = _tempClear_.kept;
        Logger.log("[PMS] 임시기록 초기화: 삭제=" + tempCleared + "건, 유지=" + tempKept + "건");
      }
    } catch (_eTempClear_) {
      errMsgs.push("[임시기록초기화] " + _eTempClear_.message);
    }

    var state = {
      queue: files.map(function(f) { return { id: f.id, name: f.name }; }),
      todayNum: todayNum,
      archived: 0, failed: 0, errMsgs: errMsgs,
      tempCleared: tempCleared, tempKept: tempKept
    };
    _pms_saveResumeState_(state);
    scheduled = _pms_scheduleResume_(5 * 1000);
  } catch (eStart) {
    ui.alert("⚠ 시작 실패: " + (eStart.message || eStart));
    return;
  }

  if (scheduled) {
    ui.alert("✅ 대리판매 마감을 시작했습니다.\n\n" +
      "백그라운드에서 처리되며, 완료되면 Google Chat 알림이 전송됩니다.\n" +
      "이 창은 닫으셔도 됩니다.\n\n" +
      "※ 다시 누르면 '진행 중' 안내가 뜹니다. 완료 Chat을 기다려 주세요.");
  } else {
    ui.alert("⚠ 백그라운드 예약 실패 → 즉시 처리합니다.\n" +
      "(파일이 많으면 6분 한도에 걸려 또 멈출 수 있습니다.)\n\n" +
      _pt_triggerFailWhy_(_PMS_LAST_TRIGGER_ERR_));
    //  ★ 2026-10-10 잠금을 쥔 채 돌지 않는다 — 붙이는 자리(_pms_processOneFile_)가 짧게 잠근다.
    //    다른 길과 같이: 짧게 잠가 «돌고 있다» 깃발만 보고·세우고 바로 푼다.
    var lock2 = LockService.getScriptLock();
    var props2 = PropertiesService.getScriptProperties();
    var 돌던것 = null;
    if (lock2.tryLock(5000)) {
      돌던것 = props2.getProperty("_PMS_BATCH_RUNNING_");
      var 살아있음 = 돌던것 && (Date.now() - Number(돌던것)) < _PMS_RUNNING_WINDOW_MS_;
      if (!살아있음) props2.setProperty("_PMS_BATCH_RUNNING_", String(Date.now()));
      lock2.releaseLock();
      if (살아있음) {
        ui.alert("⚠ 마감이 이미 돌고 있습니다. 완료 Chat 을 기다려 주세요.");
      } else {
        try { _pms_runBatch_(true); }
        finally { try { props2.deleteProperty("_PMS_BATCH_RUNNING_"); } catch (_) {} }
      }
    } else {
      ui.alert("⚠ 다른 자동화가 잠시 실행 중입니다.\n메뉴「🛑 마감 백그라운드 강제 초기화」후 다시 시도하세요.");
    }
  }
}

/**
 * ★ 대리판매/대리공급 마감 백그라운드 작업·재개 트리거 강제 초기화
 *  「다른 작업 진행 중」에 계속 막힐 때 사용.
 */
function partnerForceClearArchiveJobs_() {
  var ui = SpreadsheetApp.getUi();
  var cf = ui.alert(
    "🛑 마감 백그라운드 강제 초기화",
    "진행 중인 대리판매/대리공급 마감의\n" +
    "재개 상태·예약 트리거를 모두 취소합니다.\n\n" +
    "※ 지금 돌고 있는 배치가 있으면 최대 약 5분 후 종료됩니다.\n" +
    "계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (cf !== ui.Button.YES) return;
  try { _pms_clearResumeState_(); } catch (_) {}
  try { _pea_clearResumeState_(); } catch (_) {}
  try { PropertiesService.getScriptProperties().deleteProperty(_PEA_PENDING_KEY_); } catch (_) {}
  try { PropertiesService.getScriptProperties().deleteProperty("_PMS_BATCH_RUNNING_"); } catch (_) {}
  try { PropertiesService.getScriptProperties().deleteProperty("_PEA_BATCH_RUNNING_"); } catch (_) {}
  ui.alert("✅ 마감 백그라운드 작업을 초기화했습니다.\n이제 마감 메뉴를 다시 실행할 수 있습니다.");
}

/** [트리거용] 무음 실행 — ScriptLock을 배치 전체 동안 붙잡지 않음 */
/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 하루에 한 번만 ★  (2026-09-16)
 *
 *  > "중복이네?"
 *  2026-09-16 에 대리판매 마감 완료 카드가 22:20·22:30 두 번 왔다.
 *  첫 번은 이동 110건, 두 번째는 0건이었다. 두 번째가 0건이라 이번엔
 *  무해했지만, 그 사이에 송장이 더 들어왔다면 «두 번 이동»했을 수도 있다.
 *
 *  막는 장치가 둘 있었는데 둘 다 샜다 —
 *    _PMS_BATCH_RUNNING_    6분 창. 22:20 에 끝나며 지워져 22:30 은 통과
 *    _pms_clearResumeState_ 재개 트리거는 지운다. 이 길은 아니었다
 *  즉 22:00 트리거가 실제로 두 번 발화했거나 트리거가 둘이었다.
 *  까닭을 못 짚어도 «두 번 도는 것»은 막을 수 있다.
 *
 *  ★ 손으로 누르는 길은 안 막는다 ★  사람이 일부러 누른 것이다.
 *    (partnerArchiveToMonthly 메뉴는 이 함수를 안 거친다)
 * ══════════════════════════════════════════════════════════════
 */
var _PMS_DONE_DATE_KEY_ = "_PMS_DONE_DATE";

/** 오늘 이미 마감을 끝냈나 (yyyy-MM-dd) */
function _pms_doneToday_() {
  try {
    var d = PropertiesService.getScriptProperties().getProperty(_PMS_DONE_DATE_KEY_);
    if (!d) return false;
    return d === Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
  } catch (e) { return false; }   // 못 읽으면 «모른다» — 막지 않는다
}

/** 오늘 끝냈다고 적어 둔다 */
function _pms_markDoneToday_() {
  try {
    PropertiesService.getScriptProperties().setProperty(
      _PMS_DONE_DATE_KEY_,
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd"));
  } catch (e) {}
}

function partnerArchiveToMonthlySilent_() {
  /*  ★ 오늘 이미 끝냈으면 그냥 돌아간다 ★  조용히 가지 않는다 —
      로그에 남긴다. 「왜 안 돌았지」를 물을 수 있어야 한다.  */
  if (_pms_doneToday_()) {
    Logger.log("[PMS_SILENT] 오늘 이미 마감 완료 → 건너뜀 (중복 발화)");
    return;
  }
  var props = PropertiesService.getScriptProperties();
  var running = props.getProperty("_PMS_BATCH_RUNNING_");
  if (running && (Date.now() - Number(running)) < _PMS_RUNNING_WINDOW_MS_) {
    Logger.log("[PMS_SILENT] 이미 배치 실행 중 → 스킵");
    return;
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log("[PMS_SILENT] Lock 획득 실패 → 1분 후 재시도 예약");
    try { _pms_scheduleResume_(60 * 1000); } catch (_) {}
    try {
      _chat_sendCard_("⚠ 대리판매 마감 Lock 실패",
        Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
        [{ label: "상태", value: "Lock 실패 → 1분 후 재시도" }]);
    } catch (_) {}
    return;
  }
  props.setProperty("_PMS_BATCH_RUNNING_", String(Date.now()));
  lock.releaseLock();
  try { _pms_core_(null, true); }
  catch (e) { try { Logger.log("[PMS_ERR] " + String(e.message || e)); } catch (_) {} }
  finally {
    try { props.deleteProperty("_PMS_BATCH_RUNNING_"); } catch (_) {}
  }
}

/** [Dry-run] 이동 후보 미리보기 */
function partnerDiagnoseMonthlyArchive() {
  var ui    = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일 없음");

  var todayNum = parseInt(
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), 10);

  var total = 0;
  var lines = ["📋 발주 및 송장조회 → 월별 마감 이동 후보 (Dry-run)\n"];

  files.forEach(function(f) {
    try {
      var ss  = SpreadsheetApp.openById(f.id);
      var tab = ss.getSheetByName(_PMS_ORDER_TAB);
      if (!tab || tab.getLastRow() < 2) return;

      var scan = _pms_scanOrderTab_(tab, todayNum);
      if (!scan.candidates.length) return;

      lines.push("■ " + f.name + " (" + scan.candidates.length + "건)");
      var byM = {};
      scan.candidates.forEach(function(c){ byM[c.tabName]=(byM[c.tabName]||0)+1; });
      Object.keys(byM).sort().forEach(function(t){ lines.push("  · "+t+": "+byM[t]+"건"); });
      total += scan.candidates.length;
    } catch(e) {
      lines.push("■ " + f.name + ": 읽기 오류(" + e.message + ")");
    }
  });

  if (!total) lines.push("이동 후보 없음\n(조건: 오늘 포함 이전 날짜 + 송장번호 있음/취소/품절/발송완료)");
  else lines.push("\n총 이동 예정: " + total + "건");

  ui.alert("월별 정산 진단", lines.join("\n"), ui.ButtonSet.OK);
}

// ──────────────────────────────────────────────────────
//  핵심 로직
// ──────────────────────────────────────────────────────
// ★ 2026-07-16: 연속 실행(continuation) 상수 — GAS 6분 한도 회피
var _PMS_RESUME_KEY_ = "_PMS_RESUME_STATE";       // ScriptProperties 상태 저장 키
var _PMS_RESUME_TRIGGER_ = "_pms_continueResume_"; // 재개 트리거 핸들러명
var _PMS_TIME_BUDGET_MS_ = 4.5 * 60 * 1000;        // 배치당 시간 예산(4.5분, 6분 한도 안전마진)
/**
 * ★ 「돌고 있다」 깃발을 믿는 시간 — 31분 ★  (2026-10-10)
 *
 *  > "왜 두 번 복사됐는지 찾아줘"
 *  10/06 밤 22:17 부터 마감이 두 벌 나란히 돌았다. 옛 DB(settle_partner_sales)에 같은 고유ID 가
 *  2초 간격으로 두 번 — 엠케이테크 9 · 올팩 11 · 용기창고 6 · 하나팩 23. 하나팩은 시트에 23줄이 두 번 남았다.
 *
 *  6분으로 믿었다. 그런데 시간 예산은 파일 «사이»에서만 본다 — 큰 파일 하나면 배치가 6분을 넘긴다
 *  (실행 한도는 30분이다). 5.5분 안전망이 늦게 울리면 깃발이 «낡았다»고 보고 두 번째 벌이 시작했고,
 *  큐는 파일이 «끝난 뒤»에야 저장되므로 지금 처리 중인 그 파일부터 같이 옮겼다.
 *  실행은 30분을 못 넘긴다. 31분이 지난 깃발만 죽은 것으로 본다.
 */
var _PMS_RUNNING_WINDOW_MS_ = 31 * 60 * 1000;
/** 마지막 트리거 생성 실패 — 화면에 까닭을 그대로 보여 주려고 담아 둔다 */
var _PMS_LAST_TRIGGER_ERR_ = null;

function _pms_core_(ui, silent) {
  var files = _pt_listFiles();
  if (!files || !files.length) {
    if (!silent && ui) ui.alert("협력업체 파일 없음");
    return;
  }

  if (!silent && ui) {
    var cf = ui.alert("월별 정산 이동",
      "각 협력업체 파일의 「발주 및 송장조회」탭에서\n" +
      "송장번호가 입력된 행을 월별 마감 탭으로 이동합니다.\n\n" +
      "⚠ 송장 수집을 먼저 실행한 뒤 이 기능을 사용하세요.\n" +
      "계속할까요?",
      ui.ButtonSet.YES_NO);
    if (cf !== ui.Button.YES) return;
  }

  // ★ 이전 미완료 상태/재개 트리거 정리 후 새 실행 시작
  _pms_clearResumeState_();

  var todayNum = parseInt(
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd"), 10);

  var errMsgs = [];
  var _tempCleared_ = 0, _tempKept_ = 0;

  // ★ 2026-07-04: 대리공급_임시기록 초기화 (파일 루프 전에 최우선 1회만 실행)
  try {
    var _hubSS_ = SpreadsheetApp.openById(_PT.INFO_SS_ID);
    var _tempTab_ = _po_getNonPartnerTempTab_(_hubSS_);
    if (_tempTab_) {
      var _tempClear_ = _po_clearTempTabInvoicedRowsOnly_(_tempTab_);
      _tempCleared_ = _tempClear_.cleared;
      _tempKept_ = _tempClear_.kept;
      Logger.log("[PMS] 임시기록 초기화: 삭제=" + _tempCleared_ + "건, 유지=" + _tempKept_ + "건");
    }
  } catch (_eTempClear_) {
    errMsgs.push("[임시기록초기화] " + _eTempClear_.message);
    Logger.log("[PMS] 임시기록 초기화 실패: " + _eTempClear_.message);
  }

  // ★ 처리 상태 저장 (파일 큐 + 누적 카운터) → 시간 초과 시 이어서 처리
  var state = {
    queue: files.map(function(f) { return { id: f.id, name: f.name }; }),
    todayNum: todayNum,
    archived: 0,
    failed: 0,
    errMsgs: errMsgs,
    tempCleared: _tempCleared_,
    tempKept: _tempKept_
  };
  _pms_saveResumeState_(state);

  // 첫 배치 실행 (시간 예산 내에서 가능한 만큼 처리)
  var done = _pms_runBatch_(silent);

  if (!silent && ui) {
    if (done) {
      var fin = _pms_loadFinalSummary_();
      ui.alert(fin || "✅ 월별 정산 이동 완료");
    } else {
      ui.alert("⏳ 대리판매 마감 진행 중\n\n" +
        "파일이 많아 나눠서 처리합니다.\n" +
        "나머지는 1분 뒤 백그라운드에서 자동으로 이어집니다.\n" +
        "(완료 시 Google Chat 알림이 전송됩니다.)");
    }
  }
}

/**
 * ★ 한 배치 처리 (시간 예산 내에서 파일 처리)
 * @param {boolean} silent 무음 여부 (완료 시 Chat 알림 발송용)
 * @return {boolean} 전체 완료 여부 (true=완료, false=재개 예약됨)
 */
function _pms_runBatch_(silent) {
  var startTime = new Date();
  var state = _pms_loadResumeState_();
  if (!state || !state.queue) return true; // 상태 없음 = 완료로 간주
  if (state.queue.length === 0) { _pms_clearResumeState_(); return true; }

  // ★ 안전망: 이 실행이 6분 한도로 강제 종료돼도 이어지도록 5.5분 후 재개 예약.
  //   정상 종료 경로(_pms_clearResumeState_ / _pms_scheduleResume_)에서 이 트리거를 제거/교체함.
  _pms_scheduleResume_(5.5 * 60 * 1000);

  var batchArchivedUids = {}; // ★ 이번 배치에서 이동된 UID (배치별 허브 정리)
  var processedThisBatch = 0;

  // ★ 2026-07-17: 허브 날짜맵 배치당 1회만 — 파일마다 openById하면 업체수×수십초
  var hubDateByUid = {};
  try { hubDateByUid = _pt_buildHubOrderDateByUid_() || {}; } catch (_) { hubDateByUid = {}; }
  Logger.log("[PMS] 허브 주문일자 맵: " + Object.keys(hubDateByUid).length + "건");

  while (state.queue.length > 0) {
    // 시간 예산 초과 시 중단 (단, 최소 1개는 처리해 무한루프 방지)
    if (processedThisBatch > 0 && (new Date() - startTime) > _PMS_TIME_BUDGET_MS_) break;

    var fileInfo = state.queue.shift();
    try {
      var ss = SpreadsheetApp.openById(fileInfo.id);
      var res = _pms_processOneFile_(ss, state.todayNum, batchArchivedUids, hubDateByUid);
      state.archived += res.archived;
      if (res.newTabCreated) {
        try {
          var crTab = ss.getSheetByName(_CR_TAB_NAME);
          if (crTab) _cr_applyFormulas_(crTab);
        } catch(_eCr) {}
      }
    } catch(e) {
      if (state.errMsgs.length < 20) state.errMsgs.push("[" + fileInfo.name + "] " + e.message);
      state.failed++;
    }
    processedThisBatch++;
    _pms_saveResumeState_(state); // 진행 상황 저장(중단 대비)
  }

  // ── 이번 배치에서 이동된 행을 허브에서 삭제 ──
  _pms_cleanupHub_(batchArchivedUids, Object.keys(batchArchivedUids).length, state.errMsgs);

  if (state.queue.length === 0) {
    // ── 전체 완료 ──
    var msg = "✅ 월별 정산 이동 완료\n이동: " + state.archived + "건"
      + "\n📋 임시기록 정리: 삭제 " + state.tempCleared + "건, 유지 " + state.tempKept + "건"
      + (state.failed > 0 ? "\n⚠ 파일 오류 " + state.failed + "건:\n" + state.errMsgs.slice(0,5).join("\n") : "");
    Logger.log("[PMS] " + msg.replace(/\n/g," | "));
    _pms_saveFinalSummary_(msg);
    _pms_markDoneToday_();   // ★ 오늘 끝냈다 — 같은 날 또 부르면 건너뛴다
    _pms_clearResumeState_();
    if (silent) {
      try {
        _chat_sendCard_("✅ 대리판매 마감 완료",
          Utilities.formatDate(new Date(), "Asia/Seoul", "HH:mm"),
          [
            { label: "이동", value: state.archived + "건" },
            { label: "📋 임시기록", value: "삭제 " + state.tempCleared + " / 유지 " + state.tempKept },
            { label: "⚠ 파일오류", value: state.failed + "건" }
          ]);
      } catch(_) {}
    }
    return true;
  }

  // ── 미완료 → 재개 트리거 설치 ──
  _pms_saveResumeState_(state);
  _pms_scheduleResume_(5 * 1000); // ★ 60초→5초 (배치 사이 대기만으로도 수십분 소모 방지)
  Logger.log("[PMS] 배치 중단 — 남은 파일 " + state.queue.length + "개, 5초 후 자동 재개");
  return false;
}

/** ★ 재개 트리거 핸들러 — 저장된 상태로 이어서 처리
 *  ScriptLock은 「동시 재개 방지」용으로만 짧게 잡고, 실제 배치 처리 중에는 해제.
 *  → 마감 중에도 다른 메뉴가 「다른 작업 진행 중」에 장시간 막히지 않음. */
function _pms_continueResume_() {
  _pms_deleteResumeTriggers_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log("[PMS_RESUME] Lock 실패 → 재예약");
    _pms_scheduleResume_(60 * 1000);
    return;
  }
  // 동시 재개 방지 플래그(속성) 설정 후 즉시 락 해제
  var props = PropertiesService.getScriptProperties();
  var running = props.getProperty("_PMS_BATCH_RUNNING_");
  if (running && (Date.now() - Number(running)) < _PMS_RUNNING_WINDOW_MS_) {
    lock.releaseLock();
    //  돌던 벌이 끝나면 스스로 다음 재개를 걸거나 트리거를 지운다. 그 벌이 30분에 죽을 때만
    //  이어 줄 누가 없다 — 10분 뒤 한 번 더 들여다본다(그새 끝났으면 그 벌이 이것을 지운다).
    Logger.log("[PMS_RESUME] 이미 배치 실행 중 → 10분 뒤 다시 본다");
    _pms_scheduleResume_(10 * 60 * 1000);
    return;
  }
  props.setProperty("_PMS_BATCH_RUNNING_", String(Date.now()));
  lock.releaseLock();

  try {
    _pms_runBatch_(true);
  } catch (e) {
    try { Logger.log("[PMS_RESUME_ERR] " + String(e.message || e)); } catch (_) {}
  } finally {
    try { props.deleteProperty("_PMS_BATCH_RUNNING_"); } catch (_) {}
  }
}

// ── 연속 실행 상태 관리 헬퍼 ──
function _pms_saveResumeState_(state) {
  try { PropertiesService.getScriptProperties().setProperty(_PMS_RESUME_KEY_, JSON.stringify(state)); }
  catch(e) { Logger.log("[PMS] 상태 저장 실패: " + e.message); }
}
function _pms_loadResumeState_() {
  try {
    var s = PropertiesService.getScriptProperties().getProperty(_PMS_RESUME_KEY_);
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
}
function _pms_clearResumeState_() {
  try { PropertiesService.getScriptProperties().deleteProperty(_PMS_RESUME_KEY_); } catch(e) {}
  _pms_deleteResumeTriggers_();
}
function _pms_saveFinalSummary_(msg) {
  try { PropertiesService.getScriptProperties().setProperty(_PMS_RESUME_KEY_ + "_FINAL", msg); } catch(e) {}
}
function _pms_loadFinalSummary_() {
  try { return PropertiesService.getScriptProperties().getProperty(_PMS_RESUME_KEY_ + "_FINAL"); }
  catch(e) { return null; }
}
/**
 * ★ 「예약 실패」로 끝내지 않는다 ★  (2026-09-15)
 *
 *   > 마감이동을 할수가 없네.. 백그라운드에서 하지도 못하는거 같은데..
 *
 *   트리거 생성이 실패하면 여태 까닭을 Logger 에만 남기고 화면엔
 *   「예약 실패 → 즉시 처리합니다」만 띄웠다. 그러면 즉시 처리가 6분에
 *   걸려 또 죽고, 사람은 무엇이 문제인지 끝내 모른다.
 *
 *   ★ 가장 흔한 까닭은 트리거 20개 한도다 ★
 *     한 스크립트 프로젝트에 트리거는 20개까지다. 다 차 있으면 새 예약이
 *     안 된다. 몇 개가 걸려 있는지 같이 보여 주면 바로 안다.
 *
 * @param {*} e 트리거 생성이 던진 것 (없으면 null)
 * @return {string} 화면에 덧붙일 설명
 */
/**
 * ★ 자리가 없으면 «찌꺼기»를 걷어내고 다시 해 본다 ★  (2026-09-15)
 *
 *   > 10일부터 마감처리가 못되고 있으니
 *
 *   9월 8~12 일에 밤 미러(반품·구매입력·보드)와 이어달리기 트리거가 늘었다.
 *   한 프로젝트에 트리거는 20개까지다. 자리가 차자 대리판매 마감이 재개
 *   트리거를 못 만들었고, 즉시 처리로 떨어져 6분에 걸려 죽었다. 그날부터다.
 *
 *   ★ 일회용 트리거는 돌고 나면 사라져야 한다 ★
 *     아래 것들은 «한 번 쓰고 버리는» 예약이다(after 방식). 일이 중간에
 *     끊기면 지워지지 않고 자리만 먹는다. 그런 찌꺼기부터 걷어낸다.
 *
 *   ★ 매일 도는 정규 트리거는 손대지 않는다 ★
 *     그건 사람이 정한 일정이다. 기계가 지울 것이 아니다.
 */
/*  ★★ 여기에 «매일 도는» 핸들러를 넣으면 밤일이 통째로 죽는다 ★★

    2026-09-15 에 내가 여덟 개를 넣었는데 그중 넷이 정규 트리거였다 —
      _prv_scheduled_ 21:30 반품 미러
      _pbv_scheduled_ 21:40 보드 미러
      _pep_unifiedDailyArchiveScheduled_ 22:00 통합 마감
      _piv_scheduled_ 22:10 구매입력 미러
    지웠으면 밤 미러와 마감이 서고, 거기서 나가는 Chat 알림도 같이 끊긴다.
    사장님이 「오늘부터 알림이 안오네」 하신 그 모양이 된다.

    ★ 넣기 전에 반드시 확인할 것 ★
      그 핸들러가 «.after(…)» 로만 만들어지는가. everyDays 가 한 번이라도
      쓰이면 넣으면 안 된다. _pt_oneshot_test.js 가 소스를 뒤져 이걸 막는다. */
var _PT_ONESHOT_HANDLERS_ = [
  "_pep_collectPriceMapDelayed_",        // after(10분)
  "_pep_patchUnmatchedArchiveScheduled_", // after(15초)
  "_repairScript_continueAuto_"           // after(3분)
];

/**
 * 남아 있는 일회용 트리거를 지운다.
 * @param {string=} 빼고 이 핸들러는 건드리지 않는다 (지금 돌고 있는 일)
 * @return {number} 지운 개수
 */
function _pt_reclaimOneShotTriggers_(빼고) {
  var n = 0;
  try {
    var trs = ScriptApp.getProjectTriggers();
    for (var i = 0; i < trs.length; i++) {
      var h = trs[i].getHandlerFunction();
      if (빼고 && h === 빼고) continue;
      if (_PT_ONESHOT_HANDLERS_.indexOf(h) < 0) continue;
      try { ScriptApp.deleteTrigger(trs[i]); n++; } catch (e2) {}
    }
  } catch (e) {}
  if (n) Logger.log("[PT] 남아 있던 일회용 트리거 " + n + "개를 걷어냈습니다");
  return n;
}

function _pt_triggerFailWhy_(e) {
  var 몇 = -1;
  try { 몇 = ScriptApp.getProjectTriggers().length; } catch (e2) {}
  var msg = e && e.message ? e.message : (e ? String(e) : '');
  var out = [];
  out.push('현재 트리거 ' + (몇 >= 0 ? 몇 + '개' : '(셀 수 없음)') + ' — 한 프로젝트에 20개까지');
  if (msg) out.push('까닭: ' + msg);
  if (몇 >= 20) out.push('→ 20개가 다 찼습니다. 안 쓰는 트리거를 지우면 바로 됩니다.');

  /*  ★ 알림이 죽으면 알림으로 알릴 수 없다 ★  (2026-09-15)
      > "오늘부터 알림이 안오네..확인해줘"
      Chat 전송이 실패하면 _chat_checkSend_ 가 그 사실을 남겨 둔다.
      사람이 창을 보는 이 자리에서 대신 말해 준다 — 새 메뉴 없이. */
  try {
    if (typeof chatLastFailure === 'function') {
      var 실패 = chatLastFailure();
      if (실패) out.push('⚠ Chat 알림이 마지막에 실패했습니다 — ' + 실패);
    }
  } catch (e3) {}
  return out.join('\n');
}

function _pms_scheduleResume_(delayMs) {
  _pms_deleteResumeTriggers_(); // 중복 방지 (안전망 트리거 포함 교체)
  _pms_markStarted_();          // 언제 시작했는지 — 「11시간 전」을 말할 수 있게
  try {
    ScriptApp.newTrigger(_PMS_RESUME_TRIGGER_).timeBased().after(delayMs || 60 * 1000).create();
    return true;
  } catch(e) {
    Logger.log("[PMS] 재개 트리거 생성 실패: " + e.message);
    _PMS_LAST_TRIGGER_ERR_ = e;
    /*  자리가 없어서일 수 있다. 찌꺼기를 걷어내고 «한 번만» 더 해 본다.
        무한히 되풀이하지 않는다 — 안 되면 까닭을 들고 화면에 나간다. */
    if (_pt_reclaimOneShotTriggers_(_PMS_RESUME_TRIGGER_) > 0) {
      try {
        ScriptApp.newTrigger(_PMS_RESUME_TRIGGER_).timeBased()
          .after(delayMs || 60 * 1000).create();
        _PMS_LAST_TRIGGER_ERR_ = null;
        Logger.log("[PMS] 자리를 비우고 재개 트리거를 걸었습니다");
        return true;
      } catch (e3) { _PMS_LAST_TRIGGER_ERR_ = e3; }
    }
    return false;
  }
}
/**
 * ══════════════════════════════════════════════════════════════
 *  ★ 「진행 중」이 정말 진행 중인지 본다 ★  (2026-09-15)
 *
 *  큐에 남은 파일이 있으면 돌고 있는 것으로 쳤다. 그런데 백그라운드는
 *  재개 트리거가 굴린다 — 트리거가 6분을 넘겨 죽거나 오류로 끊기면
 *  큐만 남고, 시스템이 «없는 일»을 있다고 말한다. 사람은 영영 못 돌린다.
 *
 *  재개 트리거가 실제로 걸려 있는가 — 그것만이 믿을 수 있는 사실이다.
 *  (대리공급 마감의 _pea_runState_ 와 같은 생각이다. 같은 병이 두 군데 있었다.)
 * ══════════════════════════════════════════════════════════════
 */
var _PMS_STARTED_KEY_ = _PMS_RESUME_KEY_ + "_STARTED";
/** 이만큼 지났는데 안 끝났으면 죽은 것으로 본다 (재개는 1분마다 잇는다) */
var _PMS_STALE_MIN_ = 30;

/** 재개 트리거가 실제로 걸려 있나 */
function _pms_resumeTriggerAlive_() {
  try {
    var trs = ScriptApp.getProjectTriggers();
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].getHandlerFunction() === _PMS_RESUME_TRIGGER_) return true;
    }
  } catch (e) {}
  return false;
}

function _pms_markStarted_() {
  try {
    PropertiesService.getScriptProperties()
      .setProperty(_PMS_STARTED_KEY_, String(new Date().getTime()));
  } catch (e) {}
}

/** @return {{돌고있나:boolean, 지난분:number, 시작:string, 왜:string}} */
function _pms_runState_() {
  var started = 0;
  try {
    started = parseInt(PropertiesService.getScriptProperties()
      .getProperty(_PMS_STARTED_KEY_), 10) || 0;
  } catch (e) {}
  var 지난분 = started ? Math.floor((new Date().getTime() - started) / 60000) : -1;
  var 살아있음 = _pms_resumeTriggerAlive_();
  var 왜 = "";
  if (!살아있음) {
    왜 = "재개 트리거가 없습니다 — 돌고 있지 않습니다.";
  } else if (지난분 >= _PMS_STALE_MIN_) {
    왜 = "트리거는 있는데 " + 지난분 + "분째 안 끝났습니다 — 멈춘 것으로 봅니다.";
  }
  return {
    돌고있나: 살아있음 && !(지난분 >= _PMS_STALE_MIN_),
    지난분: 지난분,
    시작: started
      ? Utilities.formatDate(new Date(started), "Asia/Seoul", "MM-dd HH:mm")
      : "(모름)",
    왜: 왜
  };
}

/** 「3시간 20분 전」처럼 사람이 읽는 꼴 */
function _pms_ago_(분) {
  if (!(분 >= 0)) return "(언제인지 모름)";
  if (분 < 60) return 분 + "분 전";
  var h = Math.floor(분 / 60), m = 분 % 60;
  return h + "시간" + (m ? " " + m + "분" : "") + " 전";
}

function _pms_deleteResumeTriggers_() {
  try {
    var trs = ScriptApp.getProjectTriggers();
    for (var i = 0; i < trs.length; i++) {
      if (trs[i].getHandlerFunction() === _PMS_RESUME_TRIGGER_) {
        try { ScriptApp.deleteTrigger(trs[i]); } catch(_) {}
      }
    }
  } catch(e) {}
}

/**
 * ★ 단일 파일 처리 (일괄 마감 통합 루프에서 호출 가능)
 * @param {Spreadsheet} ss - 이미 열린 스프레드시트 객체
 * @param {number} todayNum - 오늘 날짜 숫자 (yyyyMMdd)
 * @param {Object} archivedUids - 이동된 고유ID 세트 (외부에서 누적)
 * @returns {{ archived: number }}
 */
function _pms_processOneFile_(ss, todayNum, archivedUids, hubDateByUid) {
  var result = { archived: 0, newTabCreated: false };
  var orderTab = ss.getSheetByName(_PMS_ORDER_TAB);
  if (!orderTab || orderTab.getLastRow() < 2) return result;

  hubDateByUid = hubDateByUid || {};

  // ★ B열 TODAY 수식일 때만 고정값 변환 (이미 값이면 스킵 — 파일마다 전체 재쓰기 금지)
  try {
    var b1f = String(orderTab.getRange("B1").getFormula() || "");
    if (b1f.indexOf("TODAY") !== -1 || b1f.indexOf("ARRAYFORMULA") !== -1 || b1f.indexOf("{") === 0) {
      _pt_freezeOrderDateColumn_(orderTab, hubDateByUid, false);
      SpreadsheetApp.flush();
    }
  } catch (_eFreezeB) {}

  // ARRAYFORMULA 스필로 lastRow가 부풀면 과도한 읽기 → C열 기준 실데이터만
  var lr = orderTab.getLastRow();
  try {
    if (typeof _island_findLastDataRow_ === "function") {
      lr = Math.max(2, _island_findLastDataRow_(orderTab, 3));
    } else {
      var cScan = Math.min(lr, 500);
      if (cScan >= 2) {
        var cCol = orderTab.getRange(2, 3, cScan - 1, 1).getDisplayValues();
        var lastC = 1;
        for (var ci = 0; ci < cCol.length; ci++) {
          if (String(cCol[ci][0] || "").trim()) lastC = ci + 2;
        }
        lr = lastC;
      }
    }
  } catch (_eLr) {}
  if (lr < 2) return result;

  var lc  = Math.min(orderTab.getLastColumn(), 20);
  if (lc < 15) lc = 15;
  var all = orderTab.getRange(1, 1, lr, lc).getValues();
  var headers = all[0];
  var cMap = _pms_buildColMap_(headers);

  if (cMap.date === -1) return result;

  // ★ 품목명/단가 맵 — 빈 품명·단가 미기입·수량미적용 보정용 (단가조회)
  var _codeToNameMap_ = null;
  var _codeToPriceMap_ = null;
  function _pms_ensureViewerMaps_() {
    if (_codeToNameMap_ && _codeToPriceMap_) {
      return { name: _codeToNameMap_, price: _codeToPriceMap_ };
    }
    _codeToNameMap_ = {};
    _codeToPriceMap_ = {};
    try {
      var vt = _pt_findViewerSheet(ss);
      if (vt && vt.getLastRow() >= 3) {
        var vLr = Math.min(vt.getLastRow(), 3500);
        // C:G → code, name, …, 최종단가(G)
        var vData = vt.getRange(3, 3, vLr - 2, 5).getValues();
        for (var vi = 0; vi < vData.length; vi++) {
          var code = String(vData[vi][0] || "").trim();
          if (!code || code.indexOf("#") === 0) continue;
          var name = String(vData[vi][1] || "").trim();
          var price = _pms_toNumber_(vData[vi][4]);
          if (name && !_codeToNameMap_[code]) _codeToNameMap_[code] = name;
          if (price > 0 && !_codeToPriceMap_[code]) _codeToPriceMap_[code] = price;
        }
      }
    } catch (_eMap) {}
    return { name: _codeToNameMap_, price: _codeToPriceMap_ };
  }
  function _pms_ensureCodeNameMap_() {
    return _pms_ensureViewerMaps_().name;
  }

  //  ★ 2026-10-05 새 마감탭 모양 — 원본(O열 도서산간 포함) + 기타정산 (_pms_newLayout_)
  var Lord = _pms_layoutFromOrder_(headers, lc);

  // ★ 고유ID 열 인덱스 — 루프 밖에서 1회만 산출
  var uidColIdx = 12;
  for (var hsi = 0; hsi < headers.length; hsi++) {
    var hh = String(headers[hsi] || "").replace(/\s/g, "").toLowerCase();
    if (hh.indexOf("고유id") !== -1 || hh.indexOf("uniqueid") !== -1) {
      uidColIdx = hsi; break;
    }
  }

  var keepData            = [];
  var archiveDataByMonth  = {};

  for (var r = 1; r < all.length; r++) {
    var rowData = all[r];
    // C열(코드) 없으면 빈 스필행 — 스킵
    if (!String(rowData[2] || "").trim()) continue;

    var archivedUid = String(rowData[uidColIdx] || "").replace(/\s/g, "").trim();
    var orderDate = rowData[cMap.date];

    // ★ 허브 수집일자 우선 (B열 TODAY 오염 시에도 마감 판정 가능, 시트 재쓰기 불필요)
    var dateStr = "";
    if (archivedUid && hubDateByUid[archivedUid]) {
      dateStr = hubDateByUid[archivedUid];
    } else {
      dateStr = _pms_parseDateStr_(orderDate);
    }
    if (!dateStr) { keepData.push(rowData); continue; }

    var dNum   = parseInt(dateStr.substring(0, 8), 10);
    // ★ 2026-08-03: 당일 건 포함 (오늘 날짜도 마감 대상, 미래만 잔류)
    var isPast = dNum <= todayNum;

    if (!isPast) { keepData.push(rowData); continue; }

    var invoiceVal = cMap.invoice !== -1
      ? String(rowData[cMap.invoice] || "").trim() : "";

    if (!invoiceVal) { keepData.push(rowData); continue; }

    var yyyy   = dateStr.substring(0, 4);
    var mm     = parseInt(dateStr.substring(4, 6), 10);
    var tabName = "(" + yyyy + "년 " + mm + "월) 발주 마감";

    if (!archiveDataByMonth[tabName]) archiveDataByMonth[tabName] = [];
    var archiveRow = rowData.slice(0);
    // 마감 보관용 일자는 판정에 쓴 날짜로 고정
    if (cMap.date !== -1) archiveRow[cMap.date] = dateStr;
    var _arItemName_ = String(archiveRow[3] || "").trim();
    if (!_arItemName_ && String(archiveRow[2] || "").trim()) {
      var _lookupName_ = _pms_ensureCodeNameMap_()[String(archiveRow[2]).trim()];
      if (_lookupName_) archiveRow[3] = _lookupName_;
    }
    // ★ 정산금액(마감) = 개별단가 × 수량
    //   - 단가 헤더 미매핑 / 단가 미기입 / 이미 줄합계 / 조회단가 대조 보정
    var priceCol = cMap.price;
    var qtyCol = cMap.qty;
    if (priceCol === -1 || qtyCol === -1) {
      for (var _hci = 0; _hci < headers.length; _hci++) {
        var _hh = String(headers[_hci] || "").replace(/\s/g, "");
        if (priceCol === -1 && (
          _hh.indexOf("정산금액") !== -1 || _hh.indexOf("정산단가") !== -1 ||
          _hh === "단가" || _hh.indexOf("단가(자동)") !== -1 ||
          (_hh.indexOf("단가") !== -1 && _hh.indexOf("조회") === -1)
        )) priceCol = _hci;
        if (qtyCol === -1 && _hh.indexOf("수량") !== -1 &&
            _hh.indexOf("택배") === -1 && _hh.indexOf("박스") === -1) {
          qtyCol = _hci;
        }
      }
    }
    if (priceCol !== -1 && qtyCol !== -1) {
      var priceHeader = String(headers[priceCol] || "");
      var codeForPrice = String(archiveRow[2] || "").trim();
      var lookupUnit = 0;
      if (codeForPrice) {
        lookupUnit = _pms_toNumber_(_pms_ensureViewerMaps_().price[codeForPrice]);
      }
      var resolved = _pms_resolveArchiveLineAmount_(
        archiveRow[priceCol],
        archiveRow[qtyCol],
        priceHeader,
        lookupUnit
      );
      archiveRow[priceCol] = resolved.amount;
    }
    if (archivedUid) archivedUids[archivedUid] = true;
    archiveDataByMonth[tabName].push(archiveRow);
  }

  var hasArchived = false;

  /*  ★ 붙이기는 한 번에 한 벌만 ★  (2026-10-10, _PMS_RUNNING_WINDOW_MS_ 참고)
      두 벌이 같은 파일을 같이 읽으면 둘 다 «아직 없다»고 본다. 읽고-견주고-붙이기를 잠금 안에서 한다.
      못 잡으면 이 파일은 손대지 않고 넘긴다 — 발주탭에 그대로 남아 다음 마감에 옮겨진다.
      (메뉴의 예약 실패 길은 이제 잠금을 쥔 채 여기로 오지 않는다 — partnerArchiveToMonthlySettle) */
  var _붙이기잠금_ = null;
  for (var _t0_ in archiveDataByMonth) {
    if (archiveDataByMonth[_t0_].length) { _붙이기잠금_ = LockService.getScriptLock(); break; }
  }
  if (_붙이기잠금_ && !_붙이기잠금_.tryLock(90 * 1000)) {
    throw new Error("마감탭 붙이기 잠금을 90초 안에 못 잡음 — 이 업체는 다음 마감에 옮긴다");
  }
  try {
  for (var tabName in archiveDataByMonth) {
    var arr = archiveDataByMonth[tabName];
    if (!arr.length) continue;

    hasArchived = true;
    var monthKey = _PMS_KEY_PREFIX + tabName;

    var _새탭_ = false;   //  이 달 탭을 «이번에» 만들었나 (result.newTabCreated 는 파일 전체라 다음 달까지 남는다)
    var archTab = ss.getSheetByName(tabName);
    if (!archTab) {
      var byKey = _pms_findTabByKey_(ss, monthKey);
      if (byKey) {
        archTab = byKey;
      } else {
        archTab = ss.insertSheet(tabName);
        result.newTabCreated = true; // ★ 새 마감탭 생성됨
        _새탭_ = true;
      }
    }

    var isNewBlank = archTab.getLastRow() < 1;

    // ★ 레이아웃/CF는 새 탭만 — 기존 탭마다 CF 누적·maxRows 서식 = 갈수록 더 느려짐
    var Ltab;
    if (isNewBlank || _새탭_) {
      Ltab = Lord;
      _pms_layoutArchiveTab_(archTab, Lord, isNewBlank);
      _pms_setKey_(archTab, monthKey);
      _pms_applyProtection_(archTab);
    } else {
      //  ★ 2026-10-05 있던 탭은 «그 탭의 모양»을 따른다. 옛 모양(취소·반품 칸)이면 먼저 새 모양으로
      //    바꿔 본다 — 취소·반품 기록이 있어 못 바꾸면 옛 모양 그대로 붙인다(_pms_migrateOldLayout_).
      Ltab = _pms_archiveLayout_(archTab, orderTab) || Lord;
      if (Ltab.구형) {
        try { _pms_quickRepairTab_(archTab, Ltab); } catch (eMg) {}
        Ltab = _pms_archiveLayout_(archTab, orderTab) || Lord;
      }
      if (Ltab.구형) _pms_ensureCheckboxes_(archTab, Ltab.구형.cancel, Ltab.구형.ret);
    }

    /*  ★ 이미 마감탭에 있는 고유ID 는 다시 붙이지 않는다 ★  (2026-10-10)
        원인(두 벌)을 막는 것과 별개로 «결과»를 본다 — 어떤 길로 또 겹쳐 돌아도 두 번 들어가지 않게.
        뺀 줄도 «옮긴 것»으로 친다: 이미 마감탭에 있으니 발주탭에서 지워지는 게 맞다.
        고유ID 열을 못 찾으면 «모른다» — 거르지 않고 예전처럼 붙인다(못 읽은 것을 없는 것으로 치지 않는다). */
    var _있던ID_ = _pms_existingUids_(archTab);
    if (_있던ID_) {
      var _뺀_ = 0;
      arr = arr.filter(function(row) {
        var u = String(row[uidColIdx] || "").replace(/\s/g, "");
        if (u && _있던ID_[u]) { _뺀_++; return false; }
        return true;
      });
      archiveDataByMonth[tabName] = arr;   // 아래 DB 기록도 새로 붙인 줄만
      if (_뺀_) {
        Logger.log("[PMS] " + ss.getName() + " / " + tabName + ": 이미 마감탭에 있는 " + _뺀_ + "줄은 다시 안 붙임");
        result.skippedDup = (result.skippedDup || 0) + _뺀_;
      }
      if (!arr.length) continue;
    }

    var padded = arr.map(function(row) {
      return _pms_padRow_(row, Ltab);
    });
    var nextRow = archTab.getLastRow() + 1;
    if (nextRow < _PMS_DATA_START) nextRow = _PMS_DATA_START;

    archTab.getRange(nextRow, 1, padded.length, padded[0].length)
      .setValues(padded)
      .setVerticalAlignment("middle");

    if (Ltab.구형) archTab.getRange(nextRow, Ltab.구형.cancel, padded.length, 2).insertCheckboxes();

    result.archived += padded.length;

    /*  ★ 2026-10-10 붙인 김에 요약 수식과 거래명세서를 머리글 «이름»에 다시 맞춘다 ★
        사람이 칸을 끼우면 시트가 수식을 스스로 옮기지만, 스크립트가 칸을 바꾸거나 요약만 옛 모양으로
        남으면(10/06 올팩·용기창고 B3=0) 아무도 못 고쳤다. 다를 때만 쓴다 — 맞으면 읽기 한 번.  */
    if (!Ltab.구형) {
      try {
        var _요약기대_ = _pms_expectedSummaryFormulas_(Ltab.cMap, Ltab.islandC, Ltab.etcC, Ltab.extHdr);
        var _요약식_ = archTab.getRange(2, 1, 2, 8).getFormulas();
        var _요약다름_ = Object.keys(_요약기대_).some(function (k) {
          var rc = k.split(",");
          return _pms_normF_(_요약식_[+rc[0] - 2][+rc[1] - 1]) !== _pms_normF_(_요약기대_[k]);
        });
        if (_요약다름_) {
          _pms_applyFormulas_(archTab, Ltab.cMap, Ltab.islandC, Ltab.etcC, Ltab.extHdr);
          Logger.log("[PMS] " + ss.getName() + " / " + tabName + ": 요약 수식을 머리글에 맞춰 다시 씀");
        }
      } catch (_eSum) { Logger.log("[PMS] 요약 수식 맞추기 실패(마감은 그대로): " + _eSum.message); }
      if (typeof _pls_ensure_ === "function") _pls_ensure_(ss, tabName);
    }
  }
  } finally {
    if (_붙이기잠금_) { try { _붙이기잠금_.releaseLock(); } catch (_eRl) {} }
  }

  if (hasArchived) {
    // ★ maxRows 전체 clear 금지 → 실데이터 범위만
    var clearRows = Math.max(lr - 1, keepData.length, 1);
    // ★ 2026-07-24: 값+서식 동시 제거 (배경/테두리 잔재로 빈 칸이 지저분해 보이던 문제)
    _pt_clearContentAndFormat_(orderTab.getRange(2, 1, clearRows, lc));

    if (keepData.length > 0) {
      // A열 제외(수식), B~끝까지 한 번에 복원
      var restW = lc - 1;
      // ★ 2026-07-20: 스필 수식 열(D/L/N)은 값 복원 제외 — 수식 파괴(#REF!) 방지
      //   헤더(1행)에 수식이 있는 열만 제외. C/K/M 값으로 스필이 자동 재계산됨.
      //   (B열 기준 인덱스: D=2, L=10, N=12)
      var _skipIdx_ = {};
      try {
        if (String(orderTab.getRange("D1").getFormula() || "")) _skipIdx_[2] = true;
        if (String(orderTab.getRange("L1").getFormula() || "")) _skipIdx_[10] = true;
        if (String(orderTab.getRange("N1").getFormula() || "")) _skipIdx_[12] = true;
      } catch (_) {}
      var restData = keepData.map(function(r) {
        var row = r.slice(1, 1 + restW);
        while (row.length < restW) row.push("");
        for (var si in _skipIdx_) {
          var siN = parseInt(si, 10);
          if (siN < row.length) row[siN] = "";
        }
        return row;
      });
      orderTab.getRange(2, 2, keepData.length, restW).setValues(restData);
    }

    SpreadsheetApp.flush();
    try {
      // 수식 재주입 (B열은 이미 값이면 freeze 스킵) — 내부에서 상태 CF도 재적용
      _pt_injectOrderSpillFormulas(orderTab, null);
    } catch(_eH) {
      // inject 실패 시에도 상태 행색만이라도 복구
      try {
        if (typeof _pt_applyOrderTabDesign === "function") {
          _pt_applyOrderTabDesign(orderTab);
        }
      } catch (_) {}
    }
    try { _pt_clearSearchInputTab_(ss); } catch(_e) {}
  }

  // ★ 2026-07-04: DB 동기화 — 대리판매 월별 마감 상세 + 정산 요약
  try {
    if (result.archived > 0) {
      // 업체명 추출 (설정 탭 B5 또는 시트 이름에서)
      var _vName_ = "";
      try {
        var _setTab_ = ss.getSheetByName("설정");
        if (_setTab_) _vName_ = String(_setTab_.getRange("B5").getValue() || "").trim();
      } catch(_) {}
      if (!_vName_) _vName_ = ss.getName().replace("[협력업체] ", "");

      // 마감 월별로 상세 행을 DB에 저장
      for (var _tab_ in archiveDataByMonth) {
        var _arr_ = archiveDataByMonth[_tab_];
        if (!_arr_ || !_arr_.length) continue;

        // 탭 이름에서 정산월 추출: "(2026년 7월) 발주 마감" → "2026-07"
        var _smMatch_ = _tab_.match(/\((\d{4})년\s*(\d{1,2})월\)/);
        var _sm_ = _smMatch_ ? _smMatch_[1] + "-" + String(_smMatch_[2]).padStart(2, "0") : "";

        if (_sm_) {
          var _dbRows_ = _arr_.map(function(row) {
            return {
              unique_id: String(row[uidColIdx] || "").trim() || null,
              order_date: String(row[cMap.date] || "").trim() || null,
              ecount_code: String(row[2] || "").trim() || null,  // C열
              item_name: String(row[3] || "").trim() || null,    // D열
              qty: parseInt(row[cMap.qty]) || 1,
              recipient: String(row[5] || "").trim() || null,    // F열
              phone: String(row[6] || "").trim() || null,        // G열
              address: String(row[7] || "").trim() || null,      // H열
              message: String(row[8] || "").trim() || null,      // I열
              unit_price: parseFloat(row[cMap.price]) || 0,
              note: String(row[10] || "").trim() || null,        // K열
              invoice_no: cMap.invoice !== -1 ? String(row[cMap.invoice] || "").trim() : null,
              status: "마감완료"
            };
          });
          _sb_syncPartnerSettle_(_vName_, _sm_, _dbRows_);
        }
      }
    }
  } catch (eDb) { Logger.log("[SB] 대리판매 마감 DB 동기화 오류: " + eDb.message); }

  return result;
}


/**
 * 마감탭에 이미 있는 고유ID — { "d1006000157": true, ... }
 * 머리글(4행)에서 「고유ID」 열을 찾는다. 못 찾으면 null(«모른다») — 빈 {} 와 다르다.
 * 새로 만든 빈 탭은 {} (있는 게 없다).
 */
function _pms_existingUids_(archTab) {
  try {
    var lr = archTab.getLastRow();
    if (lr < _PMS_DATA_START) return {};
    var lc = Math.max(archTab.getLastColumn(), 1);
    var hdr = archTab.getRange(_PMS_HEADER_ROW, 1, 1, lc).getValues()[0];
    var col = -1;
    for (var i = 0; i < hdr.length; i++) {
      var h = String(hdr[i] || "").replace(/\s/g, "").toLowerCase();
      if (h.indexOf("고유id") !== -1 || h.indexOf("uniqueid") !== -1) { col = i + 1; break; }
    }
    if (col === -1) return null;
    var vals = archTab.getRange(_PMS_DATA_START, col, lr - _PMS_DATA_START + 1, 1).getValues();
    var set = {};
    for (var r = 0; r < vals.length; r++) {
      var u = String(vals[r][0] || "").replace(/\s/g, "");
      if (u) set[u] = true;
    }
    return set;
  } catch (e) {
    Logger.log("[PMS] 마감탭 고유ID 못 읽음 → 거르지 않음: " + e.message);
    return null;
  }
}

/**
 * ★ 허브에서 이동된 행 삭제 (공통 로직)
 */
function _pms_cleanupHub_(archivedUids, archived, errMsgs) {
  if (archived > 0 && Object.keys(archivedUids).length > 0) {
    try {
      // ★ 2026-07-01: getActiveSpreadsheet() → openById (트리거 실행 시 null 방지)
      var hubSS  = SpreadsheetApp.getActiveSpreadsheet();
      if (!hubSS) hubSS = SpreadsheetApp.openById(_PT.HUB_ID);
      var hubTab = hubSS.getSheetByName("협력업체_발주허브");
      if (hubTab && hubTab.getLastRow() >= 2) {
        var hubLr      = hubTab.getLastRow();
        var hubLc      = hubTab.getLastColumn();
        var HUB_UID_COL = 3;
        var hubData    = hubTab.getRange(2, 1, hubLr - 1, hubLc).getValues();
        var keepHubData = [];
        for (var hr = 0; hr < hubData.length; hr++) {
          var hubUid = String(hubData[hr][HUB_UID_COL - 1] || "").trim();
          if (!(hubUid && archivedUids[hubUid])) {
            keepHubData.push(hubData[hr]);
          }
        }
        // ★ 2026-07-24: 값+서식 동시 제거
        _pt_clearContentAndFormat_(hubTab.getRange(2, 1, hubLr - 1, hubLc));
        if (keepHubData.length > 0) {
          hubTab.getRange(2, 1, keepHubData.length, hubLc).setValues(keepHubData);
        }
        SpreadsheetApp.flush();
      }
    } catch (eHub) {
      errMsgs.push("[허브 정리] " + eHub.message);
    }
  }
}

/**
 * 취소/반품 접수 탭의 VLOOKUP 수식을 최신 마감탭 포함하여 갱신
 * ★ 2026-06-18: 별도 메뉴로 분리 (일괄 마감에서 자동 호출 제거)
 */
function _pms_refreshCancelReturnFormulas_(files) {
  if (!files) files = _pt_listFiles();
  if (!files || !files.length) return;

  for (var fi = 0; fi < files.length; fi++) {
    try {
      var ss = SpreadsheetApp.openById(files[fi].id);
      var crTab = ss.getSheetByName(_CR_TAB_NAME);
      if (!crTab) continue;
      _cr_applyFormulas_(crTab);
    } catch (e) {
      Logger.log("[취소반품 수식 갱신] " + files[fi].name + ": " + e.message);
    }
  }
  Logger.log("[PMS] 취소/반품 수식 갱신 완료 (" + files.length + "개 파일)");
}

/** ★ 2026-06-18: 취소/반품 수식 갱신 — 공개 메뉴 함수 */
function partnerRefreshCancelReturnFormulas() {
  var ui = SpreadsheetApp.getUi();
  var cf = ui.alert("🔄 취소/반품 수식 갱신",
    "모든 협력업체 파일의 '취소/반품 접수' 탭 수식을\n" +
    "최신 마감탭 포함하여 갱신합니다.\n\n" +
    "(월별 마감 이동 후 실행 권장)\n계속할까요?",
    ui.ButtonSet.YES_NO);
  if (cf !== ui.Button.YES) return;

  _pms_refreshCancelReturnFormulas_(null);
  ui.alert("✅ 취소/반품 수식 갱신 완료");
}

// ──────────────────────────────────────────────────────
//  스캔 헬퍼 (Dry-run용)
// ──────────────────────────────────────────────────────
function _pms_scanOrderTab_(tab, todayNum) {
  var candidates = [];
  var lr  = tab.getLastRow();
  if (lr < 2) return { candidates: candidates };

  var lc  = tab.getMaxColumns();
  var all = tab.getRange(1, 1, lr, lc).getValues();
  var cMap = _pms_buildColMap_(all[0]);
  if (cMap.date === -1) return { candidates: candidates };

  for (var r = 1; r < all.length; r++) {
    var rowData   = all[r];
    var orderDate = rowData[cMap.date];
    if (!orderDate) continue;

    var dateStr = _pms_parseDateStr_(orderDate);
    if (!dateStr) continue;

    var dNum = parseInt(dateStr.substring(0, 8), 10);

    // ★ 2026-08-03: 당일 건 포함 (미래만 스킵)
    if (dNum > todayNum) continue;

    // ★ 이동 조건: 송장번호 입력된 행만
    var invoiceVal = cMap.invoice !== -1 ? String(rowData[cMap.invoice]||"" ).trim() : "";
    if (!invoiceVal) continue;

    var yyyy = dateStr.substring(0, 4);
    var mm   = parseInt(dateStr.substring(4, 6), 10);
    candidates.push({ tabName: "(" + yyyy + "년 " + mm + "월) 발주 마감", rowIndex: r });
  }
  return { candidates: candidates };
}

// ──────────────────────────────────────────────────────
//  열 매핑 (발주 및 송장조회 헤더 분석)
//  ★ 2026-06-13 통합: _pt_buildOrderTabColumnMap 위임 래퍼
//  기존 필드(date, invoice, status, qty, price) 하위호환 유지
// ──────────────────────────────────────────────────────
function _pms_buildColMap_(headers) {
  var full = _pt_buildOrderTabColumnMap(headers);
  return {
    date:    full.date,
    invoice: full.invoice,
    // ★ status: 통합 매핑의 status 우선, 없으면 voucherMemo(적요) 폴백
    //   (기존 _pms_buildColMap_는 '적요'도 status로 매핑했으나,
    //    통합 매핑은 적요를 voucherMemo에 별도 매핑함)
    status:  full.status !== -1 ? full.status : full.voucherMemo,
    qty:     full.qty,
    // ★ price: 통합 매핑의 unitPrice 사용
    price:   full.unitPrice
  };
}

// ──────────────────────────────────────────────────────
//  확장 헤더 구성 — ★ 2026-10-05 원본 + 기타정산 (취소·반품 칸은 없앴다 · _pms_newLayout_)
// ──────────────────────────────────────────────────────
function _pms_buildExtHeaders_(headers, lc) {
  var base = [];
  for (var i = 0; i < lc; i++) base.push(i < headers.length ? headers[i] : "");
  return _pms_newLayout_(base).extHdr;
}

/**
 * ★ 2026-10-05 마감탭 새 모양 — 원본 칸 + 「기타정산」 하나
 *
 *  > "월 마감텝에서도 취소 반품 (Q,R열) 삭제해줘. O열 도서산간 배송비만 재대로 붙게해줘..
 *  >  취소 반품은 반품관리대장과 연동되고 처리날짜가 달을 넘어가는 경우가 많아서
 *  >  별도 관리해야되"
 *  > (고르신 것) 반품 관련 전부 — 취소·반품·취소반품사유·반품송장번호·반품배송비를 뺀다
 *
 *  여태: 원본 + 취소·반품·취소반품사유·반품송장번호·반품배송비·도서산간배송비·기타정산
 *        도서산간은 원본 O열 값을 뒤쪽 칸에 «한 번 더» 베껴 그쪽을 합계했다 — 두 벌.
 *  이제: 원본(O열 도서산간배송비 포함) + 기타정산.  도서산간은 O열 하나만 센다.
 *        원본에 도서산간 칸이 없는 옛 파일만 뒤에 「도서산간배송비」를 하나 붙인다.
 *
 *  최종 정산금액 = 정산금액 + 도서산간(O) + 기타정산.  취소·반품은 반품관리대장이 맡는다.
 */
var _PMS_OLD_EXT_ = ["취소", "반품", "취소반품사유", "반품송장번호", "반품배송비", "도서산간배송비", "기타정산"];

function _pms_newLayout_(baseIn) {
  var base = baseIn.slice();
  //  꼬리가 옛 확장 일곱 칸 그대로면 통째로 뗀다
  if (base.length >= _PMS_OLD_EXT_.length) {
    var 꼬리 = base.slice(base.length - _PMS_OLD_EXT_.length).map(function (h) { return String(h == null ? "" : h).replace(/\s/g, ""); });
    if (꼬리.join("|") === _PMS_OLD_EXT_.join("|")) base = base.slice(0, base.length - _PMS_OLD_EXT_.length);
  }
  //  꼬리에 남은 옛 확장 칸은 떼어 낸다 (원본을 다시 읽어 만들 때).
  //  ★ 「도서산간배송비」는 떼지 않는다 — 원본이 O열에서 끝나는 파일(15칸)은 O가 꼬리다.
  //    떼면 O열을 «옛 확장»으로 오해해 도서산간 칸을 하나 더 만든다.
  while (base.length) {
    var t = String(base[base.length - 1] == null ? "" : base[base.length - 1]).replace(/\s/g, "");
    if (t !== "도서산간배송비" && _PMS_OLD_EXT_.indexOf(t) !== -1) base.pop(); else break;
  }
  var islandIdx = -1;
  for (var i = 0; i < base.length; i++) {
    if (String(base[i] == null ? "" : base[i]).replace(/\s/g, "").indexOf("도서산간") !== -1) { islandIdx = i; break; }
  }
  var extHdr = base.slice();
  var addIsland = islandIdx === -1;
  if (addIsland) { extHdr.push("도서산간배송비"); islandIdx = extHdr.length - 1; }
  extHdr.push("기타정산");
  return {
    extHdr: extHdr, extLc: extHdr.length, baseLen: base.length,
    islandC: islandIdx + 1, etcC: extHdr.length, addIsland: addIsland
  };
}

// ──────────────────────────────────────────────────────
//  행 길이 맞춤 — ★ 2026-10-05 새 모양은 _pms_padRow_ 머리 주석
// ──────────────────────────────────────────────────────
function _pms_padRow_(row, L) {
  var padded = [];
  var islandFeeVal = (row.length > 14) ? (Number(row[14]) || 0) : 0;
  for (var i = 0; i < L.baseLen; i++) padded.push(i < row.length ? row[i] : "");
  if (L.구형) {
    padded.push(false, false, "", "", "", islandFeeVal > 0 ? islandFeeVal : "", "");
    return padded;
  }
  if (L.addIsland) padded.push(islandFeeVal > 0 ? islandFeeVal : "");
  padded.push("");
  return padded;
}

// ──────────────────────────────────────────────────────
//  월별 마감 탭 레이아웃 적용
// ──────────────────────────────────────────────────────
function _pms_layoutArchiveTab_(tab, L, isNewBlank) {
  try {
    tab.getRange(1, 1, 1, 10).merge()
      .setValue("📊 월별 마감 요약")
      .setBackground("#1a237e").setFontColor("#ffffff")
      .setFontWeight("bold").setFontSize(12)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    tab.setRowHeight(1, 32);
  } catch(e) {}

  _pms_applyFormulas_(tab, L.cMap, L.islandC, L.etcC, L.extHdr);

  if (tab.getMaxColumns() < L.extLc) {
    tab.insertColumnsAfter(tab.getMaxColumns(), L.extLc - tab.getMaxColumns());
  }
  tab.getRange(_PMS_HEADER_ROW, 1, 1, L.extLc).setValues([L.extHdr])
    .setBackground("#37474f").setFontColor("white")
    .setFontWeight("bold").setHorizontalAlignment("center")
    .setFontSize(10);
  tab.getRange(_PMS_HEADER_ROW, L.islandC).setBackground("#6a1b9a").setFontColor("white");   // 도서산간 (보라)
  tab.getRange(_PMS_HEADER_ROW, L.etcC).setBackground("#2e7d32").setFontColor("white");      // 기타정산 (초록)

  try {
    if (L.cMap.date !== -1)  tab.setColumnWidth(L.cMap.date + 1, 90);
    if (L.cMap.price !== -1) tab.setColumnWidth(L.cMap.price + 1, 85);
    if (L.cMap.qty !== -1)   tab.setColumnWidth(L.cMap.qty + 1, 55);
    tab.setColumnWidth(L.islandC, 100);
    tab.setColumnWidth(L.etcC, 100);
  } catch(e) {}

  var 끝 = tab.getMaxRows() - _PMS_DATA_START + 1;
  try { tab.getRange(_PMS_DATA_START, L.islandC, 끝, 1).setNumberFormat("#,##0"); } catch(e) {}
  try { tab.getRange(_PMS_DATA_START, L.etcC, 끝, 1).setNumberFormat("#,##0"); } catch(e) {}
  if (L.cMap.price !== -1) {
    try { tab.getRange(_PMS_DATA_START, L.cMap.price + 1, 끝, 1).setNumberFormat("#,##0"); } catch(e) {}
  }

  tab.setFrozenRows(_PMS_HEADER_ROW);
  try {
    var freezeCols = (L.cMap.recipient !== undefined && L.cMap.recipient !== -1 && L.cMap.recipient + 1 <= 6)
      ? L.cMap.recipient + 1 : Math.min(3, L.extLc);
    tab.setFrozenColumns(freezeCols);
  } catch(e) {}

  //  취소·반품 줄 칠하기 규칙은 이제 없다 — 남은 것은 걷어 낸다
  try { _pms_removeRowRules_(tab); } catch(e) {}
}

/** 우리가 넣었던 취소·반품 줄 칠하기 규칙을 걷어 낸다. @return {number} 걷은 수 */
function _pms_removeRowRules_(tab) {
  var all = tab.getConditionalFormatRules() || [];
  var keep = all.filter(function(rule) { return !_pms_isOurRowRule_(rule); });
  if (keep.length !== all.length) tab.setConditionalFormatRules(keep);
  return all.length - keep.length;
}



// ──────────────────────────────────────────────────────
/**
 * ★ 요약 수식 — 칸은 머리글 «이름»으로 정하고, 수식은 검증된 꼴(L5:L)로 쓴다 ★  (2026-10-10)
 *
 *  > "마감 시트의 포멧을 바꾸더라도 정산이 맞게 바꿔줘.. 수기입력했을떄도 바로 합계금액이 바뀌게"
 *
 *  두 구멍이 있었다 —
 *    · 일자(B열)가 빈 줄은 안 셌다 — 손으로 한 줄 넣고 일자를 안 쓰면 합계에 안 들어갔다
 *    · 글자로 들어간 금액(「29,200」을 글자로 붙여넣기)은 SUM 이 건너뛰었다
 *  이제는 «품목코드·품목명·금액 중 하나라도 있으면» 한 줄로 세고, 쉼표 섞인 글자도 숫자로 읽어 더한다.
 *
 *  칸이 바뀌어도 맞게 —
 *    · 어느 칸을 셀지는 4행 머리글 «이름»(이카운트코드·품목명·정산금액·도서산간배송비·기타정산)으로 정한다.
 *    · 사람이 칸을 끼우거나 옮기면 시트가 수식의 칸 글자를 스스로 따라 옮긴다(L5:L → M5:M).
 *    · 스크립트가 칸을 바꾼 경우는 밤 마감이 머리글을 다시 읽어 다르면 고쳐 쓴다(_pms_processOneFile_).
 *  ★ MATCH·OFFSET 으로 그 자리에서 찾게 해 보았다가 접었다 ★ — 시트 폭(26칸)을 넘는 범위(…:AZ)는
 *    #NAME? 이 되고, $A$5:$AZ 꼴은 읽지도 못했다(2026-10-10 시험 시트로 확인). 검증된 꼴만 쓴다.
 *
 * @param {Array} hdr  4행 머리글 (없으면 cMap·표준 자리로)
 * @param {string} 끝  범위 끝 행 — 보통 "" (열린 범위 L5:L). 시험만 숫자를 준다.
 * @return {{건수, 정산금액, 도서산간, 기타정산, 최종}}
 */
function _pms_summaryFormulas_(cMap, islandC, etcC, hdr, 끝) {
  function Lc(n) {
    var s = "", c = n;
    while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
    return s;
  }
  function 찾기(앞) {   //  머리글에서 「앞」으로 시작하는 첫 칸 (1부터) — 없으면 0
    if (!hdr) return 0;
    for (var i = 0; i < hdr.length; i++) {
      if (String(hdr[i] == null ? "" : hdr[i]).replace(/\s/g, "").indexOf(앞) === 0) return i + 1;
    }
    return 0;
  }
  var e = 끝 ? String(끝) : "";
  function 범위(col) { return col ? Lc(col) + _PMS_DATA_START + ":" + Lc(col) + e : ""; }
  function 수(col) { return 'IFERROR(VALUE(SUBSTITUTE(TO_TEXT(' + 범위(col) + '),",","")),0)'; }
  function 합(col) { return col ? '=IFERROR(ARRAYFORMULA(SUMPRODUCT(' + 수(col) + ')),0)' : "=0"; }

  var code  = 찾기("이카운트코드") || (hdr ? 0 : 3);
  var name  = 찾기("품목명") || (hdr ? 0 : 4);
  var price = 찾기("정산금액") || (cMap && cMap.price !== -1 ? cMap.price + 1 : 0);
  var 칸들 = [];
  if (code) 칸들.push("LEN(TO_TEXT(" + 범위(code) + "))");
  if (name) 칸들.push("LEN(TO_TEXT(" + 범위(name) + "))");
  if (price) 칸들.push("ABS(" + 수(price) + ")");
  return {
    건수: 칸들.length ? "=IFERROR(ARRAYFORMULA(SUMPRODUCT(SIGN(" + 칸들.join("+") + "))),0)" : "=0",
    정산금액: 합(price),
    도서산간: 합(islandC),
    기타정산: 합(etcC),
    최종: "=IFERROR(D2+F2+H2,0)"
  };
}

function _pms_applyFormulas_(tab, cMap, islandC, etcC, hdr) {
  var f = _pms_summaryFormulas_(cMap, islandC, etcC, hdr, "");

  //  옛 모양의 요약 칸(유효 건수·반품배송비·옛 최종 자리)을 먼저 비운다
  tab.getRange(2, 1, 2, 10).clearContent();

  tab.getRange(2,1).setValue("📦 전체 건수");
  tab.getRange(2,2).setFormula(f.건수).setNumberFormat("#,##0").setFontWeight("bold").setFontSize(11);
  tab.getRange(2,3).setValue("💰 정산금액 합계");
  tab.getRange(2,4).setFormula(f.정산금액).setNumberFormat("#,##0").setFontWeight("bold");
  tab.getRange(2,5).setValue("🏝️ 도서산간배송비");
  tab.getRange(2,6).setFormula(f.도서산간).setNumberFormat("#,##0");
  tab.getRange(2,7).setValue("📋 기타정산");
  tab.getRange(2,8).setFormula(f.기타정산).setNumberFormat("#,##0");

  tab.getRange(3,1).setValue("🏷️ 최종 정산금액").setFontWeight("bold").setFontSize(11);
  tab.getRange(3,2).setFormula(f.최종).setNumberFormat("#,##0")
    .setFontWeight("bold").setFontColor("#c62828").setFontSize(12);
  tab.getRange(3,3).setValue("취소·반품은 반품관리대장에서 따로 관리합니다 · 손으로 고쳐도 바로 반영 · 일자 없는 줄·글자 금액도 셉니다").setFontColor("#757575");

  tab.getRange(2,1,1,8).setBackground("#e3f2fd").setBorder(true,true,true,true,true,true);
  tab.getRange(3,1,1,2).setBackground("#e8f5e9").setBorder(true,true,true,true,true,true);
}


// ──────────────────────────────────────────────────────
//  보호 설정: 헤더(1~4행)만 보호, 데이터 영역(5행~)은 전체 편집 가능
// ──────────────────────────────────────────────────────
function _pms_applyProtection_(tab) {
  // 기존 보호 전부 제거
  try {
    var ps = tab.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var i = 0; i < ps.length; i++) ps[i].remove();
    var pr = tab.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    for (var j = 0; j < pr.length; j++) pr[j].remove();
  } catch(e) {}
  // 헤더 영역(1~4행)만 보호
  try {
    var maxC = Math.max(tab.getMaxColumns(), 1);
    var p = tab.getRange(1, 1, _PMS_HEADER_ROW, maxC).protect()
      .setDescription("월별 마감 헤더 보호 (데이터 편집 가능)");
    p.setWarningOnly(true);
  } catch(e) {}
}

// ──────────────────────────────────────────────────────
//  기존 데이터 행 체크박스 보정
// ──────────────────────────────────────────────────────
/** @return {boolean} 체크박스를 새로 넣었으면 true */
function _pms_ensureCheckboxes_(tab, cancelC, returnC) {
  var lr = tab.getLastRow();
  if (lr < _PMS_DATA_START) return false;
  var rowCount = lr - _PMS_DATA_START + 1;

  // ★ 2026-07-16 성능: 이미 체크박스가 다 있으면 스킵
  // ★ 2026-10-05 «첫 행만» 보던 것을 «모든 행»으로: 첫 행이 멀쩡하면 뒤에 붙은 줄의
  //   빈 체크박스를 영영 안 메웠다(점검: 그린우드 4줄·엠케이테크 2줄·후아코리아 1줄).
  //   읽기 한 번이라 느려지지 않는다.
  try {
    var dvs = tab.getRange(_PMS_DATA_START, cancelC, rowCount, 2).getDataValidations();
    var CBX = SpreadsheetApp.DataValidationCriteria.CHECKBOX;
    var allOk = true;
    for (var di = 0; di < dvs.length && allOk; di++) {
      if (!dvs[di][0] || dvs[di][0].getCriteriaType() !== CBX ||
          !dvs[di][1] || dvs[di][1].getCriteriaType() !== CBX) allOk = false;
    }
    if (allOk) return false;
  } catch(e) {}

  // ★ 2026-07-16 성능: 행별 삽입 대신 전체 범위 1회 처리
  //   기존 체크(true) 값은 보존하기 위해 값 백업 → insertCheckboxes → true만 복원
  try {
    var rng = tab.getRange(_PMS_DATA_START, cancelC, rowCount, 2);
    var vals = rng.getValues();
    rng.insertCheckboxes(); // 전체 unchecked 로 일괄 세팅
    var restore = vals.map(function(r) {
      return [ r[0] === true, r[1] === true ];
    });
    rng.setValues(restore);
    return true;
  } catch(e) {
    Logger.log("[PMS] 체크박스 일괄 보정 실패: " + e.message);
    return false;
  }
}

// ──────────────────────────────────────────────────────
//  유틸
// ──────────────────────────────────────────────────────
// ★ 2026-06-13 통합: 공통 _pt_setTabKey_/_pt_findTabByKey_ 위임 래퍼
function _pms_setKey_(tab, key) {
  _pt_setTabKey_(tab, key, _PMS_KEY_CELL);
}
function _pms_findTabByKey_(ss, key) {
  return _pt_findTabByKey_(ss, key, _PMS_KEY_CELL);
}

// ──────────────────────────────────────────────────────
//  월별 마감 탭 레이아웃 보정 (AS 메뉴용)
//
//  ★ 2026-10-05 업체를 골라서 돌린다 ★
//    > "모든 업체가 작동을 하는데 특정 업체만 선택해서 실행되게 해줘..
//    >  시간초과로 제대로 작동이 안되"
//    전 업체 × 달마다의 마감 탭을 한 번에 돌면 6분 한도를 넘어 중간에 끊겼다.
//    끊기면 어디까지 했는지도 안 남는다. 그래서
//      ① 업체를 고른다 — 번호(쉼표) · 이름 일부 · all
//      ② 4분 30초가 되면 스스로 멈추고, 못 한 업체를 번호와 함께 알려 준다
//         (그 번호를 그대로 넣고 다시 돌리면 된다)
//      ③ 월을 고를 수 있다 — 비우면 모든 달 (같은 날 편집기에서 만든 판의 것을 옮겨 심었다)
//      ④ 한 업체 안에서 끊기면 끝낸 탭을 6시간 기억한다 — 다시 돌리면 이어서 한다.
//         안 그러면 마감 탭이 많은 업체는 매번 첫 탭부터 하다 끊겨 영영 못 끝낸다.
// ──────────────────────────────────────────────────────
var _PMS_REPAIR_LIMIT_MS_ = 270000;

function partnerRepairMonthlySettleTabs() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) return ui.alert("협력업체 파일 없음");

  var selected = _pms_pickVendors_(ui, files,
    "🔧 월별 마감 탭 레이아웃 보정 — 업체 선택",
    "'(YYYY년 M월) 발주 마감' 탭을 새 모양(취소·반품 칸 없음 · 도서산간은 O열)으로 바꾸고 요약·헤더·보호를 맞춥니다. 취소·반품 기록이 있는 탭은 그대로 둡니다.\n" +
    "업체 번호(쉼표로 여럿) · 이름 일부 · all 중 하나를 넣으세요.");
  if (selected === null) return;
  if (!selected.length) return ui.alert("선택된 업체가 없습니다.");

  var mResp = ui.prompt(
    "🔧 월별 마감 탭 레이아웃 보정 — 대상 월",
    "보정할 월을 입력하세요 (예: 2026-09 또는 9).\n비워두면 해당 업체의 모든 월 탭을 보정합니다.",
    ui.ButtonSet.OK_CANCEL
  );
  if (mResp.getSelectedButton() !== ui.Button.OK) return;
  var 월 = _pms_parseMonthPick_(mResp.getResponseText());
  if (월 && 월.err) return ui.alert(월.err);

  var go = ui.alert(
    "🔧 월별 마감 탭 레이아웃 보정",
    selected.length + "개 업체의 마감 탭을 보정합니다.\n\n" +
    _pms_vendorNames_(selected, 15) + "\n" +
    "대상 월: " + _pms_monthLabel_(월) + "\n\n계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (go !== ui.Button.YES) return;

  var r = _pms_repairTabsForFiles_(selected, Date.now(), 월);

  var msg = "보정: " + r.fixed + "개 탭 · " + r.done.length + "개 업체";
  if (r.done.length) msg += "\n" + r.done.join("\n");
  if (r.left.length) {
    msg += "\n\n⏱ 시간이 모자라 못 한 업체 " + r.left.length + "곳 — 아래 번호로 (같은 월로) 다시 돌려 주세요:\n" +
      r.left.map(function(f) { return _pms_vendorNo_(files, f) + ". " + _pms_vendorLabel_(f); }).join("\n") +
      "\n번호: " + r.left.map(function(f) { return _pms_vendorNo_(files, f); }).join(",");
  }
  if (r.errs.length) msg += "\n\n⚠ 오류:\n" + r.errs.join("\n");
  ui.alert((r.left.length ? "⏸ 월별 마감 탭 보정 — 일부만 함" : "✅ 월별 마감 탭 보정 완료") + "\n" + msg);
}

/**
 * 고른 업체들의 마감 탭을 보정한다. 한도 시간이 되면 멈추고 남은 업체를 돌려준다.
 * 탭 하나를 하다 만 업체도 «못 한 업체»로 센다 — 다시 돌려도 같은 결과라 안전하다.
 * 월: _pms_parseMonthPick_ 의 결과 — null 이면 모든 달
 * @return {{fixed:number, done:string[], left:Object[], errs:string[]}}
 */
function _pms_repairTabsForFiles_(selected, 시작, 월) {
  var fixed = 0, done = [], left = [], errs = [];
  var tabPattern = /^\((\d{4})년 (\d{1,2})월\) 발주 마감$/;

  for (var fi = 0; fi < selected.length; fi++) {
    var fileInfo = selected[fi];
    if (Date.now() - 시작 > _PMS_REPAIR_LIMIT_MS_) { left = selected.slice(fi); break; }
    var 탭수 = 0, 건넘 = 0, 끊김 = false, 맞음 = 0, 고친내용 = [];
    var 기억 = _pms_repairMemoGet_(fileInfo.id);
    try {
      var ss       = SpreadsheetApp.openById(fileInfo.id);
      var orderTab = ss.getSheetByName(_PMS_ORDER_TAB);   //  없어도 된다 — 탭 제 배치로 보정한다

      var sheets = ss.getSheets();
      for (var si = 0; si < sheets.length; si++) {
        var sh = sheets[si];
        var tm = String(sh.getName()).match(tabPattern);
        if (!tm) continue;
        if (!_pms_monthMatches_(월, parseInt(tm[1], 10), parseInt(tm[2], 10))) continue;
        if (기억[sh.getName()]) { 건넘++; continue; }
        if (Date.now() - 시작 > _PMS_REPAIR_LIMIT_MS_) { 끊김 = true; break; }

        //  ★ 2026-10-05 칸 배치는 «그 마감 탭 4행»에서 읽는다 (_pms_archiveLayout_ 머리 주석)
        var L = _pms_archiveLayout_(sh, orderTab);
        if (!L) { errs.push("[" + _pms_vendorLabel_(fileInfo) + "] " + sh.getName() + " — 4행에 취소·반품 칸이 없고 발주 탭도 없어 건너뜀"); continue; }
        //  ★ 2026-10-05 빠른 보정 — 틀린 것만 쓴다 (_pms_quickRepairTab_ 머리 주석)
        var 고친것 = _pms_quickRepairTab_(sh, L);
        if (고친것.length) {
          고친내용.push(tm[2] + "월 " + 고친것.join("·"));
          SpreadsheetApp.flush();
        } else {
          맞음++;
        }
        fixed++; 탭수++;
        기억[sh.getName()] = 1;
        _pms_repairMemoPut_(fileInfo.id, 기억);
      }
    } catch(e) {
      errs.push("[" + fileInfo.name + "] " + e.message);
      continue;
    }
    if (끊김) { left = selected.slice(fi); break; }
    _pms_repairMemoClear_(fileInfo.id);
    done.push(_pms_vendorLabel_(fileInfo) + " — " + 탭수 + "개 탭" +
      (맞음 ? " · 이미 맞음 " + 맞음 : "") +
      (고친내용.length ? " · 고침: " + 고친내용.join(" / ") : "") +
      (건넘 ? " (앞서 한 " + 건넘 + "개 건너뜀)" : ""));
  }
  return { fixed: fixed, done: done, left: left, errs: errs };
}

/**
 * 마감 탭의 «제 칸 배치» — 보정과 점검이 함께 쓴다.  ★ 2026-10-05
 *
 *  전에는 보정이 칸 배치를 «지금 발주 탭»(getMaxColumns)에서 만들었다. 그런데
 *  마감 이동(_pms_processOneFile_)은 min(getLastColumn, 20) 폭으로 탭을 만든다.
 *  둘이 다르면(후아코리아: 마감 탭은 16칸 + 취소 Q, 지금 발주 탭은 27칸) 보정이
 *  머리글을 엉뚱한 칸에 덮고 요약 수식이 빈 칸(AB·AC…)을 가리키게 된다.
 *  그래서 기준을 «그 마감 탭 4행»으로 바꾼다 — 「취소」「반품」이 붙어 있는 자리 앞까지가
 *  원래 칸이다. 그 탭을 만들 때의 배치이므로 데이터와 어긋날 수 없다.
 *  4행에서 못 찾을 때만 마감 이동과 같은 폭으로 발주 탭에서 만든다.
 *
 * @return {null | {출처, 메움, cMap, extHdr, extLc, cancelC, returnC, reasonC, retInvC, shipFeeC, islandFeeC, etcFeeC}}
 */
function _pms_archiveLayout_(sh, orderTab) {
  var row4 = sh.getRange(_PMS_HEADER_ROW, 1, 1, Math.max(sh.getMaxColumns(), 1)).getValues()[0];
  var orderHdr = [], orderLast = 0;
  if (orderTab) {
    orderHdr = orderTab.getRange(1, 1, 1, Math.max(orderTab.getMaxColumns(), 1)).getValues()[0];
    orderLast = orderTab.getLastColumn();
  }
  return _pms_archiveLayoutFrom_(row4, orderHdr, orderLast, !!orderTab);
}

/** 순수 — 시험이 직접 부른다 */
function _pms_archiveLayoutFrom_(row4, orderHdr, orderLast, 발주있음) {
  function t(v) { return String(v == null ? "" : v).replace(/\s/g, ""); }
  var base = null, 출처 = "", 구형 = null;
  for (var i = 0; i + 1 < row4.length; i++) {
    if (t(row4[i]) === "취소" && t(row4[i + 1]) === "반품") {
      base = row4.slice(0, i);
      출처 = "탭";
      //  옛 모양: 취소·반품·사유·반품송장·반품배송비·도서산간(뒤)·기타정산
      구형 = { cancel: i + 1, ret: i + 2, reason: i + 3, retInv: i + 4, retFee: i + 5, island: i + 6, etc: i + 7 };
      break;
    }
  }
  if (!base) {
    for (var j = row4.length - 1; j >= 0; j--) {
      if (t(row4[j]) === "기타정산") { base = row4.slice(0, j); 출처 = "탭"; break; }
      if (t(row4[j]) !== "") break;   //  맨 뒤(빈칸 뺀) 칸이 기타정산일 때만 새 모양
    }
  }
  if (!base) {
    if (!발주있음) return null;
    var lc = Math.min(orderLast, 20);           //  마감 이동과 같은 폭
    if (lc < 15) lc = 15;
    base = [];
    for (var k = 0; k < lc; k++) base.push(k < orderHdr.length ? orderHdr[k] : "");
    출처 = "발주";
  }
  var 메움 = [];
  base = base.map(function(h, idx) {
    var s = String(h == null ? "" : h).trim();
    var o = orderHdr[idx] == null ? "" : String(orderHdr[idx]).trim();
    if ((s === "" || s.charAt(0) === "#") && o && o.charAt(0) !== "#") { 메움.push(idx); return o; }
    return h;
  });
  var cMap = _pms_buildColMap_(base);
  if (cMap.price !== -1) {
    var ph = String(base[cMap.price] || "").replace(/\s/g, "");
    if (ph && ph !== "정산금액") base[cMap.price] = "정산금액";
  }
  var N = _pms_newLayout_(base);
  return {
    출처: 출처, 메움: 메움, cMap: cMap, 구형: 구형,
    extHdr: N.extHdr, extLc: N.extLc, baseLen: N.baseLen,
    islandC: N.islandC, etcC: N.etcC, addIsland: N.addIsland
  };
}

/** 발주탭에서 바로 만드는 새 모양 (새 마감탭을 처음 만들 때) */
function _pms_layoutFromOrder_(headers, lc) {
  var base = [];
  for (var i = 0; i < lc; i++) base.push(i < headers.length ? headers[i] : "");
  var cMap = _pms_buildColMap_(base);
  if (cMap.price !== -1) {
    var ph = String(base[cMap.price] || "").replace(/\s/g, "");
    if (ph && ph !== "정산금액") base[cMap.price] = "정산금액";
  }
  var N = _pms_newLayout_(base);
  return { 출처: "발주", 메움: [], cMap: cMap, 구형: null,
    extHdr: N.extHdr, extLc: N.extLc, baseLen: N.baseLen,
    islandC: N.islandC, etcC: N.etcC, addIsland: N.addIsland };
}

/**
 * ★ 2026-10-05 옛 모양 → 새 모양 (취소·반품·사유·반품송장·반품배송비·뒤쪽 도서산간 칸을 지운다)
 *
 *  안 바꾸고 그대로 두는 경우 — 취소·반품 체크가 하나라도 있거나 사유·반품송장·반품배송비가
 *  적혀 있으면. 지우면 그 달의 최종 정산금액이 «바뀐다»(취소한 줄이 다시 들어가고
 *  반품배송비가 빠진다). 이미 정산한 달일 수 있으니 사람이 정한다.
 *
 *  뒤쪽 「도서산간배송비」는 원본 O열을 베낀 것이지만, 최종 합계는 «뒤쪽»을 셌다.
 *  사람이 뒤쪽만 고쳤을 수 있으니, 둘이 다르면 뒤쪽 값을 O열에 옮긴 뒤 지운다.
 *  원본에 도서산간 칸이 없으면 뒤쪽 도서산간 칸은 남긴다(그게 새 모양의 도서산간 칸이다).
 *
 * @return {{바꿈:boolean, 왜:string, 섬맞춤:number, 기록:number}}
 */
function _pms_migrateOldLayout_(sh, L) {
  var g = L.구형, out = { 바꿈: false, 왜: "", 섬맞춤: 0, 기록: 0 };
  if (!g) return out;
  var lr = sh.getLastRow();
  var n = Math.max(0, lr - _PMS_DATA_START + 1);
  if (n) {
    var ext = sh.getRange(_PMS_DATA_START, g.cancel, n, 7).getValues();
    for (var r = 0; r < n; r++) {
      var x = ext[r];
      if (x[0] === true || x[1] === true || String(x[2] || "").trim() || String(x[3] || "").trim() ||
          (Number(x[4]) || 0) !== 0) out.기록++;
    }
    if (out.기록) { out.왜 = "취소·반품 기록 " + out.기록 + "줄 — 지우면 그 달 최종 금액이 바뀌어 그대로 둠"; return out; }
    if (!L.addIsland) {
      var baseIsl = sh.getRange(_PMS_DATA_START, L.islandC, n, 1).getValues();
      var 맞춤 = false;
      for (var k = 0; k < n; k++) {
        var 뒤 = ext[k][5];
        if (뒤 === "" || 뒤 === null) continue;
        if ((Number(뒤) || 0) !== (Number(baseIsl[k][0]) || 0)) { baseIsl[k][0] = 뒤; out.섬맞춤++; 맞춤 = true; }
      }
      if (맞춤) sh.getRange(_PMS_DATA_START, L.islandC, n, 1).setValues(baseIsl);
    }
  }
  //  지울 칸: 취소~반품배송비(5) + (원본에 도서산간이 있으면) 뒤쪽 도서산간(1)
  sh.deleteColumns(g.cancel, L.addIsland ? 5 : 6);
  out.바꿈 = true;
  return out;
}

/**
 * 빠른 보정 — «틀린 것만» 고친다.  ★ 2026-10-05
 *
 *  > "빠르게 만들어줘"
 *  예전 보정은 탭마다 제목·머리글 색·열 너비·숫자 서식·고정·규칙·보호를 «전부 다시»
 *  썼다. 업체 파일은 수식이 많아 쓰기마다 다시 계산하느라 탭 하나에 1분 가까이
 *  걸렸다(4분 30초에 4개 탭). 대부분의 탭은 이미 맞는데도 그랬다.
 *  이제는 먼저 읽어 보고(읽기 몇 번) 다른 것만 쓴다. 맞는 탭은 쓰기 0번.
 *  1행 제목이 없는 탭 — 한 번도 꾸민 적 없는 탭 — 만 예전처럼 전부 칠한다.
 *
 *  보는 것: 1행 제목 · 4행 머리글 · 2~3행 요약 수식 · 취소/반품 칠하기 규칙 2개 ·
 *          체크박스 · 4행 고정 · 머리글 보호.  (열 너비·글자색은 한 번 칠하면 안 바뀐다)
 *
 * @return {string[]} 고친 것들 — 비었으면 이미 맞음
 */
function _pms_quickRepairTab_(sh, L) {
  if (L.구형) {
    var mg = _pms_migrateOldLayout_(sh, L);
    if (!mg.바꿈) return ["⚠ 옛 모양 유지 — " + mg.왜];
    SpreadsheetApp.flush();
    var L2 = _pms_archiveLayout_(sh, null);
    if (!L2) return ["⚠ 새 모양으로 바꾼 뒤 칸 배치를 못 읽음"];
    _pms_layoutArchiveTab_(sh, L2, false);
    _pms_applyProtection_(sh);
    return ["새 모양으로 바꿈(취소·반품 칸 지움" + (mg.섬맞춤 ? " · 도서산간 " + mg.섬맞춤 + "줄 O열로 옮김" : "") + ")"];
  }

  var 고침 = [];
  var maxC = Math.max(sh.getMaxColumns(), L.extLc, 10);
  var 위 = sh.getRange(1, 1, _PMS_HEADER_ROW, maxC);
  var 값 = 위.getValues(), 식 = 위.getFormulas();

  if (String(값[0][0]).trim() !== "📊 월별 마감 요약") {
    _pms_layoutArchiveTab_(sh, L, false);
    _pms_applyProtection_(sh);
    return ["전체 레이아웃(처음 꾸밈)"];
  }

  for (var i = 0; i < L.extLc; i++) {
    var a = String(값[3][i] == null ? "" : 값[3][i]).trim();
    var b = String(L.extHdr[i] == null ? "" : L.extHdr[i]).trim();
    if (a !== b) {
      if (sh.getMaxColumns() < L.extLc) sh.insertColumnsAfter(sh.getMaxColumns(), L.extLc - sh.getMaxColumns());
      sh.getRange(_PMS_HEADER_ROW, 1, 1, L.extLc).setValues([L.extHdr]);
      고침.push("머리글");
      break;
    }
  }

  var 기대 = _pms_expectedSummaryFormulas_(L.cMap, L.islandC, L.etcC, L.extHdr);
  var 수식다름 = Object.keys(기대).some(function(k) {
    var rc = k.split(",");
    var 지금 = (식[+rc[0] - 1] || [])[+rc[1] - 1];
    return _pms_normF_(지금) !== _pms_normF_(기대[k]);
  });
  //  옛 요약 칸(I2·J2 등)에 수식이 남아 있어도 다시 쓴다
  if (!수식다름) {
    for (var cc = 8; cc < 10 && !수식다름; cc++) if (식[1][cc] || 식[2][cc]) 수식다름 = true;
  }
  if (수식다름) {
    _pms_applyFormulas_(sh, L.cMap, L.islandC, L.etcC, L.extHdr);
    고침.push("요약 수식");
  }

  var 걷음 = _pms_removeRowRules_(sh);
  if (걷음) 고침.push("취소·반품 칠하기 규칙 " + 걷음 + "개 걷음");

  if (sh.getFrozenRows() !== _PMS_HEADER_ROW) {
    sh.setFrozenRows(_PMS_HEADER_ROW);
    고침.push("고정 행");
  }

  var rp = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var sp = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (sp.length || rp.length !== 1) {
    _pms_applyProtection_(sh);
    고침.push("보호");
  }
  return 고침;
}

/** 보정 코드(_pms_applyFormulas_)가 넣을 요약 수식을 받아 적는다 — {"행,열": 수식} */
function _pms_expectedSummaryFormulas_(cMap, islandC, etcC, hdr) {
  var rec = {};
  function cell(r, col) {
    var o = {};
    ["setValue", "setNumberFormat", "setFontWeight", "setFontSize", "setFontColor", "setBackground", "setBorder", "clearContent"]
      .forEach(function(fn) { o[fn] = function() { return o; }; });
    o.setFormula = function(f) { rec[r + "," + col] = f; return o; };
    return o;
  }
  _pms_applyFormulas_({ getRange: function(r, col) { return cell(r, col); } }, cMap, islandC, etcC, hdr);
  return rec;
}

/** 수식 견주기 — 띄어쓰기·대소문자는 뜻이 아니다 */
function _pms_normF_(f) {
  return String(f || "").replace(/\s/g, "").toUpperCase();
}

/** 우리가 넣는 취소·반품 줄 칠하기 규칙인가 — =INDIRECT("R[0]C…",FALSE)=TRUE */
function _pms_isOurRowRule_(rule) {
  try {
    var bc = rule.getBooleanCondition();
    if (!bc) return false;
    var f = String(bc.getCriteriaValues()[0] || "").replace(/\s/g, "");
    return f.indexOf('=INDIRECT("R[0]C') === 0 && /",FALSE\)=TRUE$/.test(f);
  } catch (e) { return false; }
}

/** 한 업체 안에서 끝낸 탭 기억 — 6시간(캐시 최대)이 지나면 저절로 잊는다 */
function _pms_repairMemoGet_(fileId) {
  try {
    var v = CacheService.getScriptCache().get("PMS_REPAIR_" + fileId);
    return v ? JSON.parse(v) : {};
  } catch (e) { return {}; }
}
function _pms_repairMemoPut_(fileId, memo) {
  try { CacheService.getScriptCache().put("PMS_REPAIR_" + fileId, JSON.stringify(memo), 21600); } catch (e) {}
}
function _pms_repairMemoClear_(fileId) {
  try { CacheService.getScriptCache().remove("PMS_REPAIR_" + fileId); } catch (e) {}
}

/**
 * 순수 — 월 입력 읽기. 「2026-09」·「2026년 9월」·「202609」·「9」.
 * 비우면 null(모든 달), 못 읽으면 {err}.
 */
function _pms_parseMonthPick_(text) {
  var mText = String(text || "").trim();
  if (mText.slice(-1) === "월") mText = mText.slice(0, -1).trim();   //  「2026년 9월」·「9월」
  if (!mText) return null;
  var wantY = null, wantM = null;
  var mm = mText.match(/^(\d{4})\D+(\d{1,2})$/) || mText.match(/^(\d{4})(\d{2})$/);
  if (mm) { wantY = parseInt(mm[1], 10); wantM = parseInt(mm[2], 10); }
  else if (/^\d{1,2}$/.test(mText)) { wantM = parseInt(mText, 10); }
  else return { err: "월 형식을 알 수 없습니다: " + mText };
  if (!(wantM >= 1 && wantM <= 12)) return { err: "월 형식을 알 수 없습니다: " + mText };
  return { y: wantY, m: wantM };
}

function _pms_monthMatches_(월, y, m) {
  if (!월) return true;
  if (월.m !== m) return false;
  return 월.y === null || 월.y === y;
}

function _pms_monthLabel_(월) {
  if (!월) return "전체";
  return (월.y !== null ? 월.y + "년 " : "") + 월.m + "월";
}

/** 「[협력업체] 」 머리를 뗀 업체 이름 */
function _pms_vendorLabel_(f) {
  return String(f.name || "").replace("[협력업체] ", "");
}

/** 전체 목록에서의 번호(1부터) */
function _pms_vendorNo_(files, f) {
  for (var i = 0; i < files.length; i++) if (files[i].id === f.id) return i + 1;
  return "?";
}

/** 고른 업체 이름 몇 개 + 나머지 개수 */
function _pms_vendorNames_(list, max) {
  var names = list.slice(0, max).map(_pms_vendorLabel_);
  if (list.length > max) names.push("… 외 " + (list.length - max) + "곳");
  return names.join(", ");
}

/**
 * 업체 고르기 — 번호(쉼표·띄어쓰기로 여럿) · 이름 일부 · all/전체.
 * 취소하면 null, 맞는 업체가 없으면 [].
 */
function _pms_pickVendors_(ui, files, title, desc) {
  var names = [];
  for (var i = 0; i < files.length; i++) names.push((i + 1) + ". " + _pms_vendorLabel_(files[i]));
  var listText = names.join("\n");
  if (listText.length > 3500) listText = names.slice(0, 60).join("\n") + "\n… (번호 · 이름 일부 · all)";

  var resp = ui.prompt(title, desc + "\n\n" + listText, ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  return _pms_parseVendorPick_(resp.getResponseText(), files);
}

/** 순수 함수 — 시험이 직접 부른다 */
function _pms_parseVendorPick_(text, files) {
  var input = String(text || "").trim();
  if (!input) return [];
  var low = input.toLowerCase();
  if (low === "all" || low === "전체") return files.slice(0);

  var toks = input.split(",").join(" ").split(" ").filter(function(t) { return t; });
  var picked = [], seen = {};
  function add(idx) {
    if (idx < 0 || idx >= files.length || seen[idx]) return;
    seen[idx] = true;
    picked.push(files[idx]);
  }
  for (var k = 0; k < toks.length; k++) {
    var t = toks[k];
    if (/^[0-9]+$/.test(t)) { add(parseInt(t, 10) - 1); continue; }
    var key = t.toLowerCase();
    for (var i = 0; i < files.length; i++) {
      if (_pms_vendorLabel_(files[i]).toLowerCase().indexOf(key) !== -1) add(i);
    }
  }
  return picked;
}

/**
 * ★ 2026-08-03: 기존 발주 마감탭 정산금액 보정
 * 수량≥2 인데 금액이 단가조회 개별단가(1개분)와 같으면 → 단가×수량 으로 수정
 * 금액 0 이고 단가조회에 단가 있으면 → 단가×수량 채움
 */
function partnerRepairArchiveLineTotals() {
  var ui = SpreadsheetApp.getUi();
  var files = _pt_listFiles();
  if (!files || !files.length) {
    return ui.alert("협력업체 파일 없음");
  }

  var names = [];
  for (var i = 0; i < files.length; i++) {
    names.push((i + 1) + ". " + files[i].name.replace("[협력업체] ", ""));
  }
  var listText = names.join("\n");
  if (listText.length > 3500) {
    listText = names.slice(0, 60).join("\n") + "\n… (번호 또는 all)";
  }
  var vResp = ui.prompt(
    "마감 정산금액 보정 — 업체 선택",
    "수량 미적용(1개분)·단가 미기입 행을 단가조회 기준으로 보정합니다.\n" +
      "업체 번호(쉼표) 또는 all:\n\n" + listText,
    ui.ButtonSet.OK_CANCEL
  );
  if (vResp.getSelectedButton() !== ui.Button.OK) return;
  var input = String(vResp.getResponseText() || "").trim().toLowerCase();
  var selected = [];
  if (input === "all" || input === "전체") {
    selected = files.slice(0);
  } else {
    var nums = input.split(/[,\s]+/);
    var seen = {};
    for (var n = 0; n < nums.length; n++) {
      if (!nums[n]) continue;
      var idx = parseInt(nums[n], 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= files.length || seen[idx]) continue;
      seen[idx] = true;
      selected.push(files[idx]);
    }
  }
  if (!selected.length) {
    return ui.alert("선택된 업체가 없습니다.");
  }

  var ans = ui.alert(
    "마감 정산금액 보정",
    selected.length + "개 업체의 「발주 마감」탭을 스캔해\n" +
      "· 수량≥2 & 금액=개별단가 → 단가×수량\n" +
      "· 금액=0 & 단가 있음 → 단가×수량\n" +
      "으로 수정합니다. 계속할까요?",
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  var tabPat = /^\(\d{4}년\s*\d{1,2}월\)\s*발주\s*마감$/;
  var totalFixed = 0;
  var fileLines = [];
  var fail = 0;

  for (var fi = 0; fi < selected.length; fi++) {
    var fileInfo = selected[fi];
    var vLabel = fileInfo.name.replace("[협력업체] ", "");
    try {
      var ss = SpreadsheetApp.openById(fileInfo.id);
      var priceMap = {};
      try {
        var vt = _pt_findViewerSheet(ss);
        if (vt && vt.getLastRow() >= 3) {
          var vLr = Math.min(vt.getLastRow(), 3500);
          var vData = vt.getRange(3, 3, vLr - 2, 5).getValues();
          for (var vi = 0; vi < vData.length; vi++) {
            var vc = String(vData[vi][0] || "").trim();
            var vp = _pms_toNumber_(vData[vi][4]);
            if (vc && vp > 0 && !priceMap[vc]) priceMap[vc] = vp;
          }
        }
      } catch (eP) {}

      var fileFixed = 0;
      var sheets = ss.getSheets();
      for (var si = 0; si < sheets.length; si++) {
        var sh = sheets[si];
        if (!tabPat.test(String(sh.getName() || ""))) continue;
        var lr = sh.getLastRow();
        var lc = sh.getLastColumn();
        if (lr < _PMS_DATA_START || lc < 3) continue;

        var hdr = sh.getRange(_PMS_HEADER_ROW, 1, 1, lc).getValues()[0];
        var cMap = _pms_buildColMap_(hdr);
        var priceCol = cMap.price;
        var qtyCol = cMap.qty;
        if (priceCol === -1 || qtyCol === -1) {
          for (var hi = 0; hi < hdr.length; hi++) {
            var hh = String(hdr[hi] || "").replace(/\s/g, "");
            if (priceCol === -1 && (
              hh.indexOf("정산금액") !== -1 || hh === "단가" ||
              hh.indexOf("단가") !== -1
            )) priceCol = hi;
            if (qtyCol === -1 && hh.indexOf("수량") !== -1 &&
                hh.indexOf("택배") === -1 && hh.indexOf("박스") === -1) {
              qtyCol = hi;
            }
          }
        }
        if (priceCol === -1 || qtyCol === -1) continue;

        var nRows = lr - _PMS_DATA_START + 1;
        var data = sh.getRange(_PMS_DATA_START, 1, nRows, lc).getValues();
        var priceColVals = sh.getRange(_PMS_DATA_START, priceCol + 1, nRows, 1).getValues();
        var changed = false;

        for (var r = 0; r < data.length; r++) {
          var code = String(data[r][2] || "").trim();
          if (!code) continue;
          var qty = _pms_toNumber_(data[r][qtyCol]);
          var amt = _pms_toNumber_(data[r][priceCol]);
          var unit = _pms_toNumber_(priceMap[code]);
          if (!(qty > 0)) continue;

          var newAmt = null;
          if (unit > 0 && qty >= 2 && Math.abs(amt - unit) <= _PMS_AMT_TOLERANCE) {
            newAmt = Math.round(unit * qty);
          } else if (amt === 0 && unit > 0) {
            newAmt = Math.round(unit * qty);
          }
          if (newAmt != null && newAmt !== Math.round(amt)) {
            priceColVals[r][0] = newAmt;
            fileFixed++;
            changed = true;
          }
        }
        if (changed) {
          sh.getRange(_PMS_DATA_START, priceCol + 1, nRows, 1).setValues(priceColVals);
          // 헤더가 단가면 정산금액으로 표기
          var curH = String(hdr[priceCol] || "").replace(/\s/g, "");
          if (curH && curH !== "정산금액" && curH.indexOf("정산금액") === -1) {
            try {
              sh.getRange(_PMS_HEADER_ROW, priceCol + 1).setValue("정산금액");
            } catch (eH) {}
          }
        }
      }
      totalFixed += fileFixed;
      fileLines.push((fileFixed ? "✅ " : "· ") + vLabel + ": " + fileFixed + "건");
    } catch (e) {
      fail++;
      fileLines.push("❌ " + vLabel + ": " + e.message);
    }
    if (fi % 5 === 4) SpreadsheetApp.flush();
  }

  ui.alert(
    "✅ 마감 정산금액 보정 완료",
    "보정 합계: " + totalFixed + "건 / 실패 파일: " + fail + "\n\n" +
      fileLines.join("\n"),
    ui.ButtonSet.OK
  );
}

// ══════════════════════════════════════════════
//  일일마감용: 발주 마감탭 → 송장맵
//  ★ 2026-08-28: 대리판매 송장이 월마감으로 빠지면 발주탭·허브에 없다.
//    재매칭·고유ID 점검은 `_puv_buildInvoiceMap_` 만 쓰므로 여기를 직접 읽는다.
//    송장원장은 증분이라 이번 회차를 빠뜨릴 수 있다.
// ══════════════════════════════════════════════

/** 발주 마감 헤더 행. 새 탭은 4행, 옛 탭은 1행일 수 있다. */
function _pms_findOrderArchiveHeaderRow_(all) {
  var max = Math.min(all ? all.length : 0, 6);
  for (var i = 0; i < max; i++) {
    var row = all[i] || [];
    for (var j = 0; j < row.length; j++) {
      var h = String(row[j] || "").replace(/\s/g, "");
      if (h === "송장번호" || h === "운송장번호") return i;
    }
  }
  return 0;
}

/** 발주 마감 = 발주 및 송장조회 15열. 헤더로 찾고 못 찾으면 고정 위치. */
function _pms_orderArchiveCols_(hdr) {
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
    addr: find(/주소/, false),
    date: find(/주문일|발주일|^일자/, false),
    note: find(/^적요$/, false),
  };
  if (cols.inv < 0) cols.inv = 10;
  if (cols.uid < 0) cols.uid = 12;
  if (cols.name < 0) cols.name = 5;
  if (cols.phone < 0) cols.phone = 6;
  if (cols.item < 0) cols.item = 3;
  if (cols.addr < 0) cols.addr = 7;
  if (cols.date < 0) cols.date = 1;
  return cols;
}

/**
 * 협력업체 「발주 마감」탭을 throughDate(포함)까지 읽어 invoiceMap에 넣는다.
 * @return {{read:number, files:number, skippedFuture:number, errors:string[]}}
 */
function _pms_ingestOrderArchiveSs_(ss, invoiceMap, throughDateStr, vendor) {
  var out = { read: 0, files: 0, skippedFuture: 0, errors: [] };
  if (!ss || !invoiceMap) return out;

  var throughNum = 0;
  if (typeof _pea_ymdToNum_ === "function") throughNum = _pea_ymdToNum_(throughDateStr);
  else {
    var d = String(throughDateStr || "").replace(/[^0-9]/g, "").substring(0, 8);
    throughNum = d.length === 8 ? parseInt(d, 10) : 0;
  }

  var months = [];
  if (throughNum) {
    var ty = Math.floor(throughNum / 10000);
    var tm = Math.floor((throughNum % 10000) / 100);
    months.push({ yyyy: ty, m: tm });
    var prev = new Date(ty, tm - 2, 1);
    months.push({ yyyy: prev.getFullYear(), m: prev.getMonth() + 1 });
  } else {
    var now = new Date();
    months.push({ yyyy: now.getFullYear(), m: now.getMonth() + 1 });
  }

  vendor = String(vendor || "").trim();
  var vCarrier = "";
  try {
    var stTab = ss.getSheetByName("설정");
    var b5 = stTab ? String(stTab.getRange("B5").getValue() || "").trim() : "";
    if (typeof _pep_carrierForVendor_ === "function") {
      vCarrier = _pep_carrierForVendor_(b5 || vendor);
    }
  } catch (eCr) {}

  var fileRead = 0;
  for (var mi = 0; mi < months.length; mi++) {
    var tabName = "(" + months[mi].yyyy + "년 " + months[mi].m + "월) 발주 마감";
    var tab = ss.getSheetByName(tabName);
    if (!tab || tab.getLastRow() < 2) continue;
    var lc = Math.max(tab.getLastColumn(), 15);
    var all;
    try { all = tab.getRange(1, 1, tab.getLastRow(), lc).getDisplayValues(); }
    catch (eRead) { out.errors.push(vendor + "/" + tabName + ": " + eRead.message); continue; }
    var hi = _pms_findOrderArchiveHeaderRow_(all);
    var cols = _pms_orderArchiveCols_(all[hi]);
    var start = hi + 1;
    if (hi >= 3) start = Math.max(start, _PMS_DATA_START - 1);
    for (var ri = start; ri < all.length; ri++) {
      var row = all[ri];
      var inv = cols.inv >= 0 ? row[cols.inv] : "";
      if (typeof _pep_normInvoiceNo_ === "function") {
        if (!_pep_normInvoiceNo_(inv) && !_pep_splitInvNos_(inv).length) continue;
      } else if (!String(inv || "").trim()) continue;

      var dateNum = 0;
      if (cols.date >= 0) {
        if (typeof _pea_parseDateNum_ === "function") dateNum = _pea_parseDateNum_(row[cols.date]);
        else {
          var ds = _pms_parseDateStr_(row[cols.date]);
          dateNum = ds ? parseInt(ds, 10) : 0;
        }
      }
      if (throughNum && dateNum && dateNum > throughNum) {
        out.skippedFuture++;
        continue;
      }

      var uid = cols.uid >= 0 ? String(row[cols.uid] || "").trim() : "";
      if (uid && typeof _pep_uidFromOrdererCell_ === "function") {
        uid = _pep_uidFromOrdererCell_(uid) || uid;
      }
      if (uid && !(invoiceMap[uid] && invoiceMap[uid].source === "롯데")) {
        _pep_addInvoiceMap_(invoiceMap, uid, inv, "대리판매", vCarrier);
      }
      var note = cols.note >= 0 ? String(row[cols.note] || "").trim() : "";
      if (note && typeof _pep_uidFromOrdererCell_ === "function") {
        note = _pep_uidFromOrdererCell_(note);
      }
      if (note && note !== uid && typeof _pep_isRealUid_ === "function" && _pep_isRealUid_(note) &&
          !(invoiceMap[note] && invoiceMap[note].source === "롯데")) {
        _pep_addInvoiceMap_(invoiceMap, note, inv, "대리판매", vCarrier);
      }
      if (typeof _pep_addNamePhoneInvoiceKeys_ === "function") {
        _pep_addNamePhoneInvoiceKeys_(
          invoiceMap,
          cols.name >= 0 ? row[cols.name] : "",
          cols.phone >= 0 ? row[cols.phone] : "",
          inv,
          "대리판매",
          {
            skipName: true,
            addr: cols.addr >= 0 ? row[cols.addr] : "",
            item: cols.item >= 0 ? row[cols.item] : "",
            carrier: vCarrier,
            stat: typeof _pep_keyStat_ === "function" ? _pep_keyStat_("발주마감") : null,
          }
        );
      }
      out.read++;
      fileRead++;
    }
  }
  if (fileRead) out.files = 1;
  return out;
}

function _pms_addOrderArchiveToInvoiceMap_(invoiceMap, throughDateStr) {
  var out = { read: 0, files: 0, skippedFuture: 0, errors: [] };
  if (!invoiceMap) return out;

  var files = [];
  try { files = _pt_listFiles() || []; }
  catch (eList) { out.errors.push("파일 목록: " + eList.message); return out; }

  for (var fi = 0; fi < files.length; fi++) {
    var vendor = String(files[fi].name || "").replace("[협력업체] ", "").trim();
    var ss;
    try { ss = SpreadsheetApp.openById(files[fi].id); }
    catch (eOpen) { out.errors.push(vendor + " 열기 실패: " + eOpen.message); continue; }
    var one = _pms_ingestOrderArchiveSs_(ss, invoiceMap, throughDateStr, vendor);
    out.read += one.read;
    out.files += one.files;
    out.skippedFuture += one.skippedFuture;
    if (one.errors && one.errors.length) out.errors = out.errors.concat(one.errors);
  }
  Logger.log("[UNIFIED] 발주 마감탭 송장맵: " + out.read + "건 / " +
    out.files + "파일" +
    (throughDateStr ? " (~" + throughDateStr + ")" : "") +
    (out.skippedFuture ? " 미래제외=" + out.skippedFuture : "") +
    (out.errors.length ? " 오류=" + out.errors.length : ""));
  return out;
}
