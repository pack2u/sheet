/**
 * csLogen.gs 로컬 검증 — 파싱·정규화 로직만 본다.
 *
 * ★ 지금은 «문서 예시»로 돈다 — 이것만 믿으면 안 된다 ★
 *   _cslotte_test.js 는 운영 게이트웨이를 실제로 불러 받은 응답으로 검증한다.
 *   그게 옳은 방식이다. 가짜 샘플은 틀린 구현을 통과시킨다
 *   (_csbarcode_test.js 때 실제로 그랬다).
 *
 *   그런데 로젠은 **아직 인증키가 없어서** 실호출을 할 수가 없다.
 *   그래서 아래 응답은 로젠 API Docs 에 실린 «예시 값»을 옮긴 것이다.
 *   문서 예시는 실데이터와 다를 수 있다 — 롯데에서 겪었다
 *   (표에 없는 코드가 왔고, 시각이 "------" 로 오는 이벤트가 있었다).
 *
 *   ⚠ 키를 받으면 **개발계를 실제로 불러 응답을 받아 아래 FIXTURE 를 교체하고**
 *     _cslotte_test.js 처럼 실호출 방식으로 바꿀 것. 그 전까지 이 테스트는
 *     "문서대로면 맞게 판다" 까지만 보증한다.
 *
 * 실행: node _cslogen_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");
const vm = require("vm");

// ── GAS 전역 흉내 ────────────────────────────────────────
let FETCH_QUEUE = [];   // 다음 호출들이 돌려줄 응답
let FETCH_LOG = [];     // 무엇을 어떻게 불렀는지
let CACHE = {};         // { key: {value, ttl} }
let PROPS = {};
let WARNS = [];

function resetEnv() {
  FETCH_QUEUE = []; FETCH_LOG = []; CACHE = {}; PROPS = {}; WARNS = [];
}

function reply(obj, code) {
  return { code: code == null ? 200 : code, text: JSON.stringify(obj) };
}

const sandbox = {
  console: { warn: m => WARNS.push(String(m)), log: () => {} },

  UrlFetchApp: {
    fetch(url, opt) {
      FETCH_LOG.push({ url: url, opt: opt, body: JSON.parse(opt.payload || "{}") });
      const r = FETCH_QUEUE.shift();
      if (!r) throw new Error("테스트: 준비된 응답이 없습니다 — " + url);
      if (r.throw) throw new Error(r.throw);
      return {
        getResponseCode: () => r.code,
        getContentText: () => r.text
      };
    }
  },

  CacheService: {
    getScriptCache: () => ({
      get: k => (CACHE[k] ? CACHE[k].value : null),
      put: (k, v, ttl) => { CACHE[k] = { value: v, ttl: ttl }; }
    })
  },

  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in PROPS ? PROPS[k] : null),
      setProperty: (k, v) => { PROPS[k] = String(v); },
      deleteProperty: k => { delete PROPS[k]; },
      getProperties: () => Object.assign({}, PROPS)
    })
  },

  Utilities: {
    formatDate: () => "20260915"
  },

  // _secrets.gs 대신 — 실제 키는 쓰지 않는다
  LOGEN_SECRET_KEY_DEV: "TEST-KEY",
  LOGEN_SECRET_KEY_PROD: "",
  LOGEN_USER_ID: "30556066",
  LOGEN_CUST_CD: "30556066",
  LOGEN_PROXY_URL: "",
  LOGEN_PROXY_TOKEN: ""
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("csLogen.gs", "utf8"), sandbox, { filename: "csLogen.gs" });

// ── 응답 예시 (로젠 API Docs 기준) ────────────────────────
/** 화물추적 조회 — 문서 예시 그대로 */
const FIXTURE_TRACK = {
  sttsCd: "SUCCESS",
  sttsMsg: "총1건 - 처리결과 : 1건 처리 중 1건 성공",
  data: [{
    slipNo: "38010101111",
    resultCd: "TRUE",
    resultMsg: null,
    data1: [{
      scanDt: "20240501", scanTm: "113536", statNm: "배송완료",
      branCd: "226", branNm: "동동강남",
      salesCd: "22610304", salesNm: "홍길동/대치동",
      acptorTyNm: "현관/문앞"
    }]
  }]
};

/** 최종 화물추적 — 영업소 전화번호가 여기에만 있다 */
const FIXTURE_LAST = {
  sttsCd: "SUCCESS",
  sttsMsg: "총1건 - 처리결과 : 1건 처리 중 1건 성공",
  data: [{
    slipNo: "38010101111", resultCd: "TRUE", resultMsg: null,
    scanDt: "20240501", scanTm: "122727", statNm: "배송완료",
    branCd: "226", branNm: "동동강남",
    salesCd: "22610304", salesNm: "홍길동/대치동",
    salesCellNo: "010-1234-5678"
  }]
};

// ── 테스트 틀 ────────────────────────────────────────────
let pass = 0, fail = 0;
function t(name, fn) {
  resetEnv();
  try {
    fn();
    console.log("  OK  " + name);
    pass++;
  } catch (e) {
    console.log("  NG  " + name + "\n        " + e.message);
    fail++;
  }
}
function eq(got, want, what) {
  if (got !== want) {
    throw new Error((what || "값") + " : 기대 " + JSON.stringify(want) +
                    " / 실제 " + JSON.stringify(got));
  }
}
function ok(cond, what) { if (!cond) throw new Error(what || "참이어야 합니다"); }

console.log("\ncsLogen.gs 검증 (문서 예시 기준)\n");

// ── 1. 성공 판정 — 값 체계가 API마다 다르다 ────────────────
t("resultCd 는 TRUE 와 SUCCESS 를 모두 성공으로 본다", () => {
  ok(sandbox._logen_ok_("TRUE"), "TRUE");
  ok(sandbox._logen_ok_("SUCCESS"), "SUCCESS");
  ok(sandbox._logen_ok_("true"), "소문자 true");
  ok(!sandbox._logen_ok_("FALSE"), "FALSE 는 실패");
  ok(!sandbox._logen_ok_("FAIL"), "FAIL 은 실패");
  ok(!sandbox._logen_ok_(""), "빈값은 실패");
  ok(!sandbox._logen_ok_(null), "null 은 실패");
});

t("resultMsg 는 null 과 \"\" 를 모두 빈값으로 본다", () => {
  ok(sandbox._logen_blank_(null), "null");
  ok(sandbox._logen_blank_(""), "빈 문자열");
  ok(sandbox._logen_blank_("   "), "공백만");
  ok(!sandbox._logen_blank_("유효한 주문번호가 없습니다."), "메시지는 빈값 아님");
});

// ── 2. 배열 정규화 ───────────────────────────────────────
t("data1 이 단일 객체로 와도 배열로 받는다", () => {
  eq(sandbox._logen_arr_(null).length, 0, "null");
  eq(sandbox._logen_arr_({ a: 1 }).length, 1, "객체 1개");
  eq(sandbox._logen_arr_([1, 2, 3]).length, 3, "배열");
});

// ── 3. 시각 표기 ─────────────────────────────────────────
t("scanDt+scanTm 을 MM-dd HH:mm 으로 만든다", () => {
  eq(sandbox._logen_when_("20240501", "113536"), "05-01 11:35", "정상");
  eq(sandbox._logen_when_("20240501", ""), "05-01", "시각 없음");
  eq(sandbox._logen_when_("", "113536"), "", "일자 없음");
  eq(sandbox._logen_when_("20240501", "------"), "05-01", "시각이 기호로 올 때");
});

// ── 4. 배달 완료 판정 ────────────────────────────────────
t("배송완료 문자열을 완료로 본다", () => {
  ok(sandbox._logen_isDone_("배송완료"), "배송완료");
  ok(sandbox._logen_isDone_("배달완료"), "배달완료");
  ok(!sandbox._logen_isDone_("배송중"), "배송중은 아직");
  ok(!sandbox._logen_isDone_("집하완료"), "집하완료는 아직");
  ok(!sandbox._logen_isDone_(""), "빈값은 아직");
});

// ── 5. 단건 조회 ─────────────────────────────────────────
t("단건 조회가 csLotteTrack 과 같은 형태로 나온다", () => {
  FETCH_QUEUE = [reply(FIXTURE_TRACK), reply(FIXTURE_LAST)];
  const r = sandbox.csLogenTrack("38010101111", {});

  eq(r.ok, true, "ok");
  eq(r.carrier, "로젠", "carrier");
  eq(r.invoice, "38010101111", "invoice");
  eq(r.statusName, "배송완료", "statusName");
  eq(r.statusCode, "", "statusCode 는 비어 있다 (로젠은 코드가 없다)");
  eq(r.delivered, true, "delivered");
  eq(r.lastAt, "05-01 11:35", "lastAt");
  eq(r.branch, "동동강남", "branch");
  eq(r.empNm, "홍길동/대치동", "empNm ← salesNm");
  eq(r.lastMsg, "현관/문앞", "lastMsg ← acptorTyNm");
  eq(r.history.length, 1, "history 길이");

  // 화면(_trkRender_)이 기대하는 키가 다 있는지
  ["ok", "invoice", "statusName", "delivered", "lastAt", "lastMsg",
   "branch", "branchTel", "empNm", "empTel", "history", "error"]
    .forEach(k => ok(k in r, "응답에 " + k + " 가 있어야 한다"));
});

t("영업소 전화번호를 최종조회에서 채운다", () => {
  FETCH_QUEUE = [reply(FIXTURE_TRACK), reply(FIXTURE_LAST)];
  const r = sandbox.csLogenTrack("38010101111", {});
  eq(r.branchTel, "010-1234-5678", "branchTel ← salesCellNo");
  eq(r.empTel, "010-1234-5678", "empTel");
  eq(FETCH_LOG.length, 2, "두 번 부른다");
  ok(/inquiryCargoTrackingMulti$/.test(FETCH_LOG[0].url), "첫 호출은 이력");
  ok(/inquiryCargoTrackingMultiLast$/.test(FETCH_LOG[1].url), "두 번째는 최종");
});

t("최종조회가 실패해도 배송조회는 산다", () => {
  FETCH_QUEUE = [reply(FIXTURE_TRACK), reply({ sttsCd: "FAIL" }, 500)];
  const r = sandbox.csLogenTrack("38010101111", {});
  eq(r.ok, true, "본 조회는 성공");
  eq(r.statusName, "배송완료", "상태는 나온다");
  eq(r.branchTel, "", "전화번호만 빈다");
});

// ── 6. 이력 정렬 · 대표 상태 ──────────────────────────────
t("이력을 시간순으로 세운다 (응답 순서를 믿지 않는다)", () => {
  FETCH_QUEUE = [reply({
    sttsCd: "SUCCESS",
    data: [{
      slipNo: "38010101111", resultCd: "TRUE",
      data1: [
        { scanDt: "20240501", scanTm: "180000", statNm: "배송출발", branNm: "강남" },
        { scanDt: "20240430", scanTm: "090000", statNm: "집하", branNm: "수지" },
        { scanDt: "20240501", scanTm: "093000", statNm: "간선도착", branNm: "강남" }
      ]
    }]
  })];
  const r = sandbox.csLogenTrack("38010101111", {});
  eq(r.history[0].name, "집하", "첫 이벤트");
  eq(r.history[1].name, "간선도착", "두 번째");
  eq(r.history[2].name, "배송출발", "세 번째");
  eq(r.delivered, false, "아직 완료 아님");
  eq(r.statusName, "배송출발", "대표는 마지막 이벤트");
});

t("완료 뒤에 후속 이벤트가 와도 «배송완료»를 대표로 쓴다", () => {
  FETCH_QUEUE = [reply({
    sttsCd: "SUCCESS",
    data: [{
      slipNo: "38010101111", resultCd: "TRUE",
      data1: [
        { scanDt: "20240501", scanTm: "113536", statNm: "배송완료", branNm: "강남",
          acptorTyNm: "현관/문앞" },
        { scanDt: "20240501", scanTm: "120000", statNm: "인수자등록", branNm: "강남" }
      ]
    }]
  })];
  const r = sandbox.csLogenTrack("38010101111", {});
  eq(r.delivered, true, "완료로 본다");
  eq(r.statusName, "배송완료", "대표 상태");
  eq(r.lastMsg, "현관/문앞", "인수자 정보도 완료 이벤트에서 가져온다");
});

// ── 7. 부분 실패 ─────────────────────────────────────────
t("건별 resultCd 가 FALSE 면 실패로 본다 (sttsCd 만 보지 않는다)", () => {
  FETCH_QUEUE = [reply({
    sttsCd: "PARTIAL SUCCESS",
    sttsMsg: "총2건 - 처리결과 : 2건 처리 중 1건 성공",
    data: [{ slipNo: "38010101111", resultCd: "FALSE",
             resultMsg: "유효한 운송장번호가 없습니다." }]
  })];
  const r = sandbox.csLogenTrack("38010101111", {});
  eq(r.ok, false, "실패로 본다");
  eq(r.error, "유효한 운송장번호가 없습니다.", "사유를 그대로 전한다");
});

// ── 8. 배치 조회 ─────────────────────────────────────────
t("여러 건을 한 번에 부른다 (건별 루프가 아니다)", () => {
  FETCH_QUEUE = [reply({
    sttsCd: "SUCCESS",
    data: [
      { slipNo: "38010101111", resultCd: "TRUE",
        data1: [{ scanDt: "20240501", scanTm: "113536", statNm: "배송완료" }] },
      { slipNo: "38010102222", resultCd: "TRUE",
        data1: [{ scanDt: "20240501", scanTm: "090000", statNm: "배송중" }] }
    ]
  })];
  const r = sandbox.csLogenTrackMany(["38010101111", "38010102222"]);
  eq(FETCH_LOG.length, 1, "호출은 한 번");
  eq(FETCH_LOG[0].body.data.length, 2, "본문에 두 건이 실린다");
  eq(r["38010101111"].delivered, true, "1번 완료");
  eq(r["38010102222"].delivered, false, "2번 진행중");
});

t("응답에 안 실려 온 송장도 결과를 남긴다 (조용히 빠지지 않는다)", () => {
  FETCH_QUEUE = [reply({
    sttsCd: "PARTIAL SUCCESS", sttsMsg: "1건 누락",
    data: [{ slipNo: "38010101111", resultCd: "TRUE",
             data1: [{ scanDt: "20240501", scanTm: "113536", statNm: "배송완료" }] }]
  })];
  const r = sandbox.csLogenTrackMany(["38010101111", "38010109999"]);
  ok(r["38010109999"], "누락 송장도 키가 있어야 한다");
  eq(r["38010109999"].ok, false, "실패로 표시");
  ok(/응답에 없습니다/.test(r["38010109999"].error), "사유 안내");
});

t("중복 송장은 한 번만 묻는다", () => {
  FETCH_QUEUE = [reply({
    sttsCd: "SUCCESS",
    data: [{ slipNo: "38010101111", resultCd: "TRUE",
             data1: [{ scanDt: "20240501", scanTm: "113536", statNm: "배송완료" }] }]
  })];
  sandbox.csLogenTrackMany(["38010101111", "3801-0101111", "38010101111"]);
  eq(FETCH_LOG[0].body.data.length, 1, "한 건만 싣는다");
});

// ── 9. 캐시 ──────────────────────────────────────────────
t("완료 건은 길게, 진행 건은 짧게 캐시한다", () => {
  FETCH_QUEUE = [reply(FIXTURE_TRACK), reply(FIXTURE_LAST)];
  sandbox.csLogenTrack("38010101111", {});
  const done = Object.keys(CACHE).map(k => CACHE[k].ttl)[0];
  eq(done, 21600, "완료 건 TTL (CacheService 최대)");

  resetEnv();
  FETCH_QUEUE = [reply({
    sttsCd: "SUCCESS",
    data: [{ slipNo: "38010102222", resultCd: "TRUE",
             data1: [{ scanDt: "20240501", scanTm: "090000", statNm: "배송중" }] }]
  }), reply(FIXTURE_LAST)];
  sandbox.csLogenTrack("38010102222", {});
  const run = Object.keys(CACHE).map(k => CACHE[k].ttl)[0];
  eq(run, 1800, "진행 건 TTL");
});

t("캐시가 있으면 서버를 다시 부르지 않는다", () => {
  FETCH_QUEUE = [reply(FIXTURE_TRACK), reply(FIXTURE_LAST)];
  sandbox.csLogenTrack("38010101111", {});
  const firstCalls = FETCH_LOG.length;

  const r2 = sandbox.csLogenTrack("38010101111", {});
  eq(FETCH_LOG.length, firstCalls, "추가 호출 없음");
  eq(r2.cached, true, "캐시 표시");
  eq(r2.statusName, "배송완료", "내용은 같다");
});

// ── 10. 오류 안내 ────────────────────────────────────────
t("401 이면 IP 미등록 가능성을 알려 준다", () => {
  FETCH_QUEUE = [{ code: 401, text: "Unauthorized" }];
  const r = sandbox.csLogenTrack("38010101111", {});
  eq(r.ok, false, "실패");
  ok(/IP/.test(r.error), "IP 문제를 짚어야 한다 — 이게 가장 흔한 원인이다");
});

t("헤더에 secretKey 를 싣는다", () => {
  FETCH_QUEUE = [reply(FIXTURE_TRACK), reply(FIXTURE_LAST)];
  sandbox.csLogenTrack("38010101111", {});
  eq(FETCH_LOG[0].opt.headers.secretKey, "TEST-KEY", "secretKey 헤더");
  eq(FETCH_LOG[0].body.userId, "30556066", "userId");
});

// ── 11. 쿼터 ─────────────────────────────────────────────
t("일일 상한에 닿으면 호출하지 않는다", () => {
  PROPS["LOGEN_QUOTA_20260915"] = String(sandbox._LOGEN_QUOTA_SOFT_CAP_);
  const r = sandbox.csLogenTrack("38010101111", {});
  eq(r.ok, false, "실패");
  eq(FETCH_LOG.length, 0, "서버를 부르지 않는다");
  ok(/한도/.test(r.error), "한도 안내");
});

// ── 12. 새 상태 문자열 기록 ───────────────────────────────
t("처음 보는 상태 문자열을 로그에 남긴다 (조회는 막지 않는다)", () => {
  FETCH_QUEUE = [reply({
    sttsCd: "SUCCESS",
    data: [{ slipNo: "38010101111", resultCd: "TRUE",
             data1: [{ scanDt: "20240501", scanTm: "090000", statNm: "미배달(부재)" }] }]
  }), reply(FIXTURE_LAST)];
  const r = sandbox.csLogenTrack("38010101111", {});
  eq(r.ok, true, "조회는 성공");
  eq(r.statusName, "미배달(부재)", "모르는 문자열도 그대로 보여준다");
  ok(WARNS.some(w => /미배달/.test(w)), "경고 로그에 남는다");
  ok(sandbox.csLogenSeenStatuses().indexOf("미배달(부재)") !== -1, "관측 목록에 쌓인다");
});

// ── 13. 중계 서버 경유 ───────────────────────────────────
t("중계 주소가 있으면 그쪽으로 보내고 키는 싣지 않는다", () => {
  sandbox.LOGEN_PROXY_URL = "https://proxy.example.com/logen";
  sandbox.LOGEN_PROXY_TOKEN = "PTOKEN";
  try {
    FETCH_QUEUE = [reply(FIXTURE_TRACK), reply(FIXTURE_LAST)];
    sandbox.csLogenTrack("38010101111", {});
    eq(FETCH_LOG[0].url, "https://proxy.example.com/logen", "중계로 간다");
    eq(FETCH_LOG[0].opt.headers["X-Proxy-Token"], "PTOKEN", "중계 토큰");
    ok(!FETCH_LOG[0].opt.headers.secretKey, "키는 싣지 않는다 — 중계가 들고 있다");
    eq(FETCH_LOG[0].body.api, "inquiryCargoTrackingMulti", "api 이름을 넘긴다");
    eq(FETCH_LOG[0].body.env, "dev", "환경도 넘긴다");
  } finally {
    sandbox.LOGEN_PROXY_URL = "";
    sandbox.LOGEN_PROXY_TOKEN = "";
  }
});

// ── 마무리 ───────────────────────────────────────────────
console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
if (fail) {
  process.exit(1);
} else {
  console.log("  ⚠ 이 통과는 «문서 예시대로면 맞다» 까지만 뜻한다.");
  console.log("    키를 받으면 개발계 실응답으로 FIXTURE 를 갈아 끼울 것.\n");
}
