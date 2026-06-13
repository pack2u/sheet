/**
 * 전송 공통 유틸
 * - 날짜를 이카운트 규격(yyyyMMdd)으로 정규화
 * - 창고 입력값(코드/별칭)을 이카운트 창고코드로 정규화
 */
function _formatDate(value) {
  if (value === null || value === undefined || value === "") return "";

  if (Object.prototype.toString.call(value) === "[object Date]") {
    if (isNaN(value.getTime())) return "";
    return Utilities.formatDate(value, "Asia/Seoul", "yyyyMMdd");
  }

  var raw = String(value).trim();
  if (!raw) return "";

  // yyyyMMdd
  if (/^\d{8}$/.test(raw)) return raw;

  // yyyy-MM-dd, yyyy/MM/dd, yyyy.MM.dd
  var normalized = raw.replace(/[./]/g, "-");
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
    var parts = normalized.split("-");
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    var dt = new Date(y, m - 1, d);
    if (
      dt.getFullYear() === y &&
      dt.getMonth() === m - 1 &&
      dt.getDate() === d
    ) {
      return Utilities.formatDate(dt, "Asia/Seoul", "yyyyMMdd");
    }
  }

  // 그 외는 Date 파서 최종 시도
  var parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, "Asia/Seoul", "yyyyMMdd");
  }
  return "";
}

function getWarehouseCode(input) {
  var raw = String(input || "").trim();
  if (!raw) return "100";

  var key = raw.toUpperCase();
  var warehouseMap = {
    "100": "100",
    "101": "101",
    "102": "102",
    "200": "200",
    "300": "300",
    "본사": "100",
    "메인": "100",
    "주창고": "100",
    "기본": "100",
    "본창고": "100",
    "SUB": "200",
    "보조": "200",
    "보조창고": "200"
  };

  return warehouseMap[key] || raw;
}

/**
 * 자동화 로그 기록 실패를 표준 포맷으로 남긴다.
 * - 본 작업은 중단하지 않고, Logger + ScriptProperties에 추적 흔적만 저장
 */
function recordAutomationLogFailure_(channel, payload, err) {
  var now = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
  var detail =
    "[" +
    String(channel || "UNKNOWN_CHANNEL") +
    "] payload=" +
    String(payload || "") +
    " err=" +
    String(err && err.message ? err.message : err || "");

  try {
    Logger.log("[AUTOMATION_LOG_FAIL] " + now + " " + detail);
  } catch (_) {}

  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("LAST_AUTOMATION_LOG_FAIL_AT", now);
    props.setProperty("LAST_AUTOMATION_LOG_FAIL_CHANNEL", String(channel || ""));
    props.setProperty("LAST_AUTOMATION_LOG_FAIL_MSG", detail.slice(0, 450));
  } catch (_) {}
}

/**
 * 공통 ScriptLock 획득 유틸
 * - 잠금 실패 시 표준 로그를 남기고 null 반환
 */
function acquireAutomationScriptLock_(jobType, waitMs) {
  var lock = LockService.getScriptLock();
  var wait = parseInt(waitMs, 10);
  if (!wait || wait < 1000) wait = 30000;

  if (lock.tryLock(wait)) return lock;

  var busyMsg =
    "LOCK_BUSY: 다른 자동화 작업 실행 중 (job=" +
    String(jobType || "") +
    ", waitMs=" +
    wait +
    ")";
  if (typeof appendEcountAutomationLog_ === "function") {
    try {
      appendEcountAutomationLog_(String(jobType || "LOCK"), false, busyMsg);
    } catch (_) {}
  }
  if (typeof appendAutomationEventLog_ === "function") {
    try {
      appendAutomationEventLog_({
        jobType: String(jobType || "LOCK"),
        ok: false,
        code: "LOCK_BUSY",
        message: busyMsg,
      });
    } catch (_) {}
  }
  return null;
}

function releaseAutomationScriptLock_(lock) {
  if (!lock) return;
  try {
    lock.releaseLock();
  } catch (_) {}
}

function runWithAutomationScriptLock_(jobType, waitMs, worker) {
  var lock = acquireAutomationScriptLock_(jobType, waitMs);
  if (!lock) return false;
  try {
    worker();
    return true;
  } finally {
    releaseAutomationScriptLock_(lock);
  }
}
