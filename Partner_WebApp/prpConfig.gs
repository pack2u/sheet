/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 반품 포털 — 설정 상수
 *
 *  이 프로젝트는 CS 웹앱과 별도 배포다. 이유:
 *    CS 웹앱은 executeAs USER_ACCESSING 이라 방문자 본인 권한으로 시트를 읽는다.
 *    협력업체에 같은 방식을 쓰면 반품관리대장을 업체 계정에 공유해야 하고,
 *    그러면 다른 업체 건까지 시트에서 그대로 보인다. 격리가 불가능하다.
 *    그래서 포털은 executeAs USER_DEPLOYING 으로 배포자(운영자) 권한으로 읽고,
 *    서버에서 업체별로 걸러낸 결과만 내려준다.
 *
 *  그 대가로 USER_DEPLOYING 에서는 방문자 이메일을 알 수 없다.
 *  (Session.getActiveUser().getEmail() 이 빈 문자열)
 *  따라서 업체 식별은 URL 토큰이 유일한 수단이고, 토큰이 곧 비밀번호다.
 *  토큰 관리(발급·회전·폐기)는 허브 스크립트 _partnerReturnPortal.gs 에서 한다.
 * ══════════════════════════════════════════════════════════════
 */

/** 반품관리대장 — CS 웹앱과 같은 파일을 본다 (SSOT, 미러 DB 만들지 않는다) */
var PRP_LEDGER_ID = "1aYxijxp_MHTa1ALmJoUM9FmeLRa1jdGepcCccVvepoU";
var PRP_LEDGER_GID = 1972370268;

/** 업체 계정·토큰 관리 탭 (반품관리대장 파일 안에 새로 만든다. 기존 열은 건드리지 않는다) */
var PRP_ACCOUNT_TAB = "협력업체포털_계정";

/** 업체가 올린 사진 첨부 기록 탭 */
var PRP_ATTACH_TAB = "협력업체포털_첨부";

/** 접속 로그 탭 */
var PRP_LOG_TAB = "협력업체포털_로그";

/** Drive 첨부 폴더 ID — 스크립트 속성 PRP_ATT_FOLDER_ID. 없으면 자동 생성 */
var PRP_ATT_FOLDER_PROP = "PRP_ATT_FOLDER_ID";
var PRP_ATT_FOLDER_NAME = "협력업체반품_첨부";

/** 업체 접수 알림 Google Chat webhook — 스크립트 속성. 없으면 알림 생략 */
var PRP_CHAT_WEBHOOK_PROP = "PRP_CHAT_WEBHOOK";

/** 세션 유효시간 (초). 만료되면 클라이언트가 원본 링크로 재발급한다 */
var PRP_SESSION_TTL = 6 * 60 * 60;

/** 업체별 조회 캐시. 카드 스키마·공개 정책을 바꿨으면 올린다 (안 올리면 옛 캐시가 계속 나온다) */
var PRP_CACHE_VER = "p2"; // p2: 타임라인에 consult·photo 공개
var PRP_CACHE_TTL = 300; // 5분

/** 기본 조회 기간 (일) */
var PRP_DEFAULT_DAYS = 90;

/**
 * 업체가 접수할 때 A열에 찍히는 최초 상태.
 * CS 상태 옵션(_CS_RETURN_STATUS_OPTS_)의 첫 값과 같아야 CS앱에서 자연스럽다.
 */
var PRP_INITIAL_STATUS = "접수";

/** 업체 접수 시 C열 접수자 표기 접두 — CS 직원 접수와 구분된다 */
var PRP_STAFF_PREFIX = "업체:";

/**
 * 업체에게 공개할 타임라인 종류.
 *
 * ★ 2026-08-27 정책 변경: 처리과정을 업체와 공유해 문의를 줄이는 쪽으로 열었다.
 *   전에는 상태·접수만 공개해서 업체가 "어디까지 됐나요"를 계속 물어봤다.
 *
 *   access  반품 접수 사실      → 공개
 *   status  상태 변경           → 공개
 *   consult CS 상담·메모        → 공개. 단 PRP_INTERNAL_MARK_ 에 걸린 줄은 숨긴다
 *   photo   사진 첨부           → 공개 (입고·검수 사진이 공유 효과가 가장 크다)
 *   note    형식 없는 옛 메모   → 비공개. 앱 도입 전 자유기재라 무엇이 섞였는지 모른다
 *
 * 업체 본인이 남긴 문의(kind "mine")는 자기가 쓴 것이라 항상 공개다.
 */
var PRP_PUBLIC_TIMELINE_KINDS = ["access", "status", "consult", "photo"];

/**
 * 이 표시가 붙은 비고 줄은 업체에게 보내지 않는다.
 *
 * 기본이 공개이므로 **숨기려면 CS 가 명시해야 한다.** CS앱 상담 입력창의
 * `업체에 숨김` 체크박스가 `[내부]` 를 앞에 붙여 준다.
 * 손으로 쓸 때를 위해 `#내부` · `내부:` 도 같이 받는다.
 */
var PRP_INTERNAL_MARK_ = /^(?:\[내부\]|#내부|내부\s*[:：])\s*/;

/**
 * 접두 → 업체명. 허브 _partnerExclusivePush.gs 의 _PEP_VENDOR_LABELS_ 사본.
 * 반품대장 D열 업체명 표기가 흔들릴 때 별칭 후보로 쓴다.
 * 허브에서 업체가 추가되면 여기도 같이 채워야 한다.
 */
var PRP_VENDOR_LABELS = {
  HR: "뉴파츠",
  NK: "냅킨코리아",
  GW: "그린우드",
  TY: "태양",
  AJ: "아주팩",
  BW: "부원",
  KR: "코라마",
  HU: "후아코리아",
  IW: "인터웍스",
  AP: "올팩",
  JM: "제이엠",
  LG: "로엔그린",
  OC: "부엉이커피",
  GP: "지니팩",
  HP: "하나팩",
  YS: "와이에스",
  JT: "준테크",
  SW: "선우"
};

/** 업체가 접수 시 고를 수 있는 반품 유형 */
var PRP_RETURN_TYPES = ["단순반품", "교환", "불량반품", "오배송", "부분반품"];

/** 업체가 고를 수 있는 수거 택배사 */
var PRP_PICKUP_OPTS = ["CJ대한통운", "롯데택배", "한진택배", "로젠택배", "우체국", "직접반송", "미정"];

/** 화면 표기 버전 */
var PRP_VERSION = "v1.9";

/** 새 접수·카드 첨부 사진 상한 */
var PRP_PHOTO_MAX = 6;

// ── 공통 유틸 ────────────────────────────────────────────────

/** HtmlService include */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function prpNow_() {
  return new Date();
}

function prpStamp_(who) {
  var d = Utilities.formatDate(prpNow_(), "Asia/Seoul", "yyMMdd HH:mm");
  return "[" + d + " " + String(who || "업체").trim() + "]";
}

function prpToday_(fmt) {
  return Utilities.formatDate(prpNow_(), "Asia/Seoul", fmt || "yyMMdd");
}

function prpDaysAgoYmd_(days) {
  var d = prpNow_();
  d.setDate(d.getDate() - (days || 0));
  return Utilities.formatDate(d, "Asia/Seoul", "yyyyMMdd");
}

/**
 * 업체명 정규화 키.
 * 반품대장 D열은 사람이 손으로 넣는 칸이라 "(주)", 공백, 대소문자가 흔들린다.
 * 매칭은 항상 이 키로 한다.
 */
function prpVendorKey_(name) {
  return String(name || "")
    .replace(/\(주\)|\(유\)|주식회사|㈜/g, "")
    .replace(/[\s\-_.·]/g, "")
    .toLowerCase()
    .trim();
}

function prpDigits_(v) {
  return String(v || "").replace(/[^0-9]/g, "");
}

function prpEsc_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 랜덤 토큰 — 링크에 실려 다니므로 URL 안전 문자만 쓴다 */
function prpMakeToken_(len) {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  var n = len || 32;
  var out = "";
  var bytes = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  for (var i = 0; i < n; i++) {
    var seed = bytes.charCodeAt(i % bytes.length) + Math.floor(Math.random() * 256);
    out += chars.charAt(seed % chars.length);
  }
  return out;
}
