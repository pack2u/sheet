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
 *   ⚠ 2026-09-28 로젠 회신: **개발계는 화물추적·반품 테스트를 지원하지 않는다.**
 *     그래서 «개발계 실호출»이라는 길이 없다. **운영** 키를 받은 뒤 운영에서 조회해
 *     FIXTURE 를 교체해야 한다. 화물추적은 읽기 전용이라 운영 조회에 부작용이 없다.
 *     그 전까지 이 테스트는 "문서대로면 맞게 판다" 까지만 보증한다.
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
let SLEEPS = [];        // Utilities.sleep 이 몇 ms 로 불렸나

function resetEnv() {
  FETCH_QUEUE = []; FETCH_LOG = []; CACHE = {}; PROPS = {}; WARNS = []; SLEEPS = [];
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
    formatDate: () => "20260915",
    sleep: ms => { SLEEPS.push(ms); }   // 실제로 쉬지는 않는다 — 부른 것만 센다
  },

  /* _secrets.gs 대신 — 실제 키는 쓰지 않는다.
     ★ PROD 도 채워 둔다 ★ csLogen.gs 가 2026-10-07 에 운영(_LOGEN_USE_PROD_=true)으로
       바뀌었다. 여기가 비어 있으면 모든 호출이 「키가 없습니다」로 죽는다. */
  LOGEN_SECRET_KEY_DEV: "TEST-KEY-DEV",
  LOGEN_SECRET_KEY_PROD: "TEST-KEY-PROD",
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

/**
 * ★ 실측 응답 ★  2026-10-02 개발계에서 실제로 받은 것.
 *
 * 자사출고 송장 5건(10/02 집하)을 조회했더니 전부 이 모양이었다.
 * 개발계에는 **운영 스캔 데이터가 없다** — 로젠이 "개발계는 화물추적 테스트를
 * 지원하지 않는다"고 한 것이 이 뜻이었다. API 는 돌지만 DB 가 다르다.
 *
 * 그래도 이 모양은 **CS 화면에서 자주 만난다** — 방금 집하된 건은 아직 스캔이 없다.
 * 눈여겨볼 것:
 *   - `data1[]` 이 **빈 문자열로 채워진 한 줄**로 온다. 배열이 비는 게 아니다.
 *   - `sttsCd` 가 `FAIL` 인데 이건 「조회 실패」가 아니라 「0건」이라는 뜻이다.
 *   - 사람에게 보여줄 사유는 `resultMsg` 에 있다.
 */
const FIXTURE_NODATA = {
  sttsCd: "FAIL",
  sttsMsg: "처리결과 0건",
  data: [{
    slipNo: "45292632652",
    resultCd: "FALSE",
    resultMsg: "화물추적 조회 결과 없음 - 스캔정보가 없습니다.",
    data1: [{
      rcvBranNm: "", sndBranNm: "", scanTm: "", oppBranCd: "", branCd: "",
      scanDt: "", branNm: "", acptorTyNm: "", oppBranNm: "",
      salesCd: "", statNm: "", salesNm: ""
    }]
  }]
};

/**
 * ★★ 운영 실측 응답 ★★  2026-10-07, 중계기(222.122.39.14) 경유로 받은 그대로.
 *
 * 자사출고 송장 `453-0321-1446` (10/06 집하, 춘천행).
 * **문서 예시와 다른 점이 여럿 있어 이 샘플이 중요하다:**
 *
 *   ① **이력이 시간순이 아니다.**  000754 → 043300 → 001009 → 080737
 *      043300(원주터미널출고)이 001009(이천터미널출고)보다 «먼저» 실려 온다.
 *      롯데에서 겪은 그 문제가 로젠에도 있다. 정렬하지 않으면 CS 가 화물 위치를 못 읽는다.
 *   ② **`salesNm`·`acptorTyNm` 이 `null`** 로 온다. 빈 문자열이 아니다.
 *      String(null) 은 "null" 이 되므로 `|| ""` 를 반드시 거쳐야 한다.
 *   ③ **`sndBranNm`/`rcvBranNm` 은 «구간»** 이다 — "동수원[305]" → "이천터미널[912]".
 *      문서의 「배송지점명·수하인지점명」이라는 설명만 보고는 알 수 없다.
 *   ④ 집하 단계(집하완료·집하입고)가 **안 실려 온다.** 10/06 집하인데 10/07 것만 온다.
 */
const FIXTURE_REAL = {
  sttsCd: "SUCCESS",
  sttsMsg: "총1건 - 처리결과 : 1건 처리 중 1건 성공",
  data: [{
    slipNo: "45303211446",
    resultCd: "TRUE",
    resultMsg: null,
    data1: [
      { scanDt: "20261007", scanTm: "000754", statNm: "터미널입고",
        branCd: "912", branNm: "이천터미널", oppBranCd: "305", oppBranNm: "동수원",
        salesCd: "91210000", salesNm: null,
        sndBranNm: "동수원[305]", rcvBranNm: "이천터미널[912]", acptorTyNm: null },
      { scanDt: "20261007", scanTm: "043300", statNm: "터미널출고",
        branCd: "918", branNm: "원주터미널", oppBranCd: "708", oppBranNm: "남춘천",
        salesCd: "91810000", salesNm: null,
        sndBranNm: "원주터미널[918]", rcvBranNm: "남춘천[708]", acptorTyNm: null },
      { scanDt: "20261007", scanTm: "001009", statNm: "터미널출고",
        branCd: "912", branNm: "이천터미널", oppBranCd: "918", oppBranNm: "원주터미널",
        salesCd: "91210000", salesNm: null,
        sndBranNm: "이천터미널[912]", rcvBranNm: "원주터미널[918]", acptorTyNm: null },
      { scanDt: "20261007", scanTm: "080737", statNm: "배송입고",
        branCd: "708", branNm: "남춘천", oppBranCd: "918", oppBranNm: "원주터미널",
        salesCd: "70810000", salesNm: "춘천 기본",
        sndBranNm: "원주터미널[918]", rcvBranNm: "남춘천[708]", acptorTyNm: null }
    ]
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

console.log("\ncsLogen.gs 검증  (★ 표시는 운영 실측 응답 기반)\n");

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

t("담당자가 준 7단계 중 «배송완료»만 끝으로 본다", () => {
  // 2026-09-28 정보전략팀 회신: 집하완료→집하입고→터미널입고→터미널출고
  //                              →배송입고→배송출고→배송완료
  const flow = sandbox._LOGEN_STATUS_FLOW_;
  eq(flow.length, 7, "7단계");
  eq(flow[0], "집하완료", "첫 단계");
  eq(flow[6], "배송완료", "마지막 단계");
  flow.forEach((s, i) => {
    eq(sandbox._logen_isDone_(s), i === 6, s + " 는 " + (i === 6 ? "끝" : "아직"));
  });
});

t("아는 7단계는 경고를 남기지 않는다 (새 값만 걸러내려고)", () => {
  sandbox._LOGEN_STATUS_FLOW_.forEach(s => sandbox._logen_noteStatus_(s));
  eq(WARNS.length, 0, "아는 값은 조용하다");
  sandbox._logen_noteStatus_("미배달(부재)");
  eq(WARNS.length, 1, "모르는 값만 경고");
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

// ── 5-1. 실측: 스캔 전 건 (2026-10-02 개발계 실응답) ───────
t("스캔 전인 건은 로젠이 준 사유를 그대로 전한다 [실측]", () => {
  FETCH_QUEUE = [reply(FIXTURE_NODATA)];
  const r = sandbox.csLogenTrack("452-9263-2652", {});

  eq(r.ok, false, "조회 실패로 본다");
  eq(r.error, "화물추적 조회 결과 없음 - 스캔정보가 없습니다.", "사유를 그대로");
  eq(r.invoice, "45292632652", "하이픈을 떼고 11자리로");
  eq(FETCH_LOG.length, 1, "최종조회까지 가지 않는다 (본 조회가 실패했으므로)");
});

t("빈 문자열로 채워진 data1 을 «이력 있음»으로 착각하지 않는다 [실측]", () => {
  // resultCd 가 FALSE 라 _logen_buildTrack_ 까지 가지 않아야 한다.
  // 만약 가 버리면 "(상태 없음)" 이력 한 줄이 생겨 화면에 빈 줄이 뜬다.
  FETCH_QUEUE = [reply(FIXTURE_NODATA)];
  const r = sandbox.csLogenTrack("45292632652", {});
  ok(!r.history || r.history.length === 0, "이력을 만들지 않는다");
  ok(!r.statusName, "상태도 만들지 않는다");
});

// ── 5-2. 운영 실측 응답 (2026-10-07) ──────────────────────
t("운영 실데이터를 시간순으로 세운다 [실측·중요]", () => {
  FETCH_QUEUE = [reply(FIXTURE_REAL), reply({ sttsCd: "FAIL" })];
  const r = sandbox.csLogenTrack("453-0321-1446", {});

  eq(r.ok, true, "조회 성공");
  eq(r.history.length, 4, "이력 4건");

  // 응답 순서는 000754 → 043300 → 001009 → 080737 (뒤섞여 있다)
  // 제대로 세우면 000754 → 001009 → 043300 → 080737 이어야 한다
  const at = r.history.map(h => h.at);
  eq(at.join(" "), "10-07 00:07 10-07 00:10 10-07 04:33 10-07 08:07", "시간순 정렬");

  eq(r.history[1].branch, "이천터미널", "두 번째는 이천터미널 출고");
  eq(r.history[2].branch, "원주터미널", "세 번째가 원주터미널");
});

t("대표 상태는 «시간상» 마지막 것이다 [실측]", () => {
  FETCH_QUEUE = [reply(FIXTURE_REAL), reply({ sttsCd: "FAIL" })];
  const r = sandbox.csLogenTrack("45303211446", {});
  eq(r.statusName, "배송입고", "정렬 후 마지막 = 배송입고");
  eq(r.lastAt, "10-07 08:07", "그 시각");
  eq(r.delivered, false, "아직 배송완료 아님");
  eq(r.branch, "남춘천", "그 지점");
  // 응답 순서 그대로 썼다면 043300 원주터미널출고가 대표가 됐을 것이다
});

t("null 로 오는 필드를 \"null\" 로 찍지 않는다 [실측]", () => {
  FETCH_QUEUE = [reply(FIXTURE_REAL), reply({ sttsCd: "FAIL" })];
  const r = sandbox.csLogenTrack("45303211446", {});
  r.history.forEach((h, i) => {
    ok(h.empNm !== "null", i + "번 empNm 이 문자열 null 이면 안 된다");
    ok(h.msg !== "null", i + "번 msg 가 문자열 null 이면 안 된다");
  });
  eq(r.history[0].empNm, "", "salesNm 이 null 이면 빈 문자열");
  eq(r.history[3].empNm, "춘천 기본", "값이 있으면 그대로");
  eq(r.empNm, "춘천 기본", "대표 영업소는 «찍힌» 이벤트에서 가져온다");
});

t("구간(leg)을 만든다 — 상담원이 화물 위치를 읽는 값 [실측]", () => {
  FETCH_QUEUE = [reply(FIXTURE_REAL), reply({ sttsCd: "FAIL" })];
  const r = sandbox.csLogenTrack("45303211446", {});
  eq(r.history[0].leg, "동수원[305] → 이천터미널[912]", "첫 구간");
  eq(r.history[3].leg, "원주터미널[918] → 남춘천[708]", "마지막 구간");
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

// ── 8-1. 로젠이 요청한 호출 예절 (2026-09-28) ─────────────
t("10건을 넘으면 끊어서 부른다", () => {
  const invs = [];
  for (let i = 0; i < 23; i++) invs.push("3801010" + String(1000 + i));

  // 묶음마다 그 묶음의 송장을 그대로 돌려준다
  for (let c = 0; c < 3; c++) {
    FETCH_QUEUE.push({
      code: 200,
      get text() { return ""; }   // 아래 stub 에서 갈아끼운다
    });
  }
  FETCH_QUEUE = [];
  const chunks = [invs.slice(0, 10), invs.slice(10, 20), invs.slice(20)];
  chunks.forEach(ch => {
    FETCH_QUEUE.push(reply({
      sttsCd: "SUCCESS",
      data: ch.map(sn => ({
        slipNo: sn, resultCd: "TRUE",
        data1: [{ scanDt: "20260928", scanTm: "090000", statNm: "배송출고" }]
      }))
    }));
  });

  const r = sandbox.csLogenTrackMany(invs);
  eq(FETCH_LOG.length, 3, "세 번에 나눠 부른다");
  eq(FETCH_LOG[0].body.data.length, 10, "첫 묶음 10건");
  eq(FETCH_LOG[1].body.data.length, 10, "둘째 묶음 10건");
  eq(FETCH_LOG[2].body.data.length, 3, "셋째 묶음 3건");
  eq(Object.keys(r).length, 23, "23건 모두 결과가 있다");
});

t("호출 사이에 쉰다 — 첫 호출 앞에서는 안 쉰다", () => {
  const invs = [];
  for (let i = 0; i < 12; i++) invs.push("3801010" + String(2000 + i));
  [invs.slice(0, 10), invs.slice(10)].forEach(ch => {
    FETCH_QUEUE.push(reply({
      sttsCd: "SUCCESS",
      data: ch.map(sn => ({
        slipNo: sn, resultCd: "TRUE",
        data1: [{ scanDt: "20260928", scanTm: "090000", statNm: "배송출고" }]
      }))
    }));
  });

  sandbox.csLogenTrackMany(invs);
  eq(SLEEPS.length, 1, "두 번 부르면 한 번 쉰다");
  eq(SLEEPS[0], 2000, "수 초 간격");
});

t("한 묶음이 실패해도 나머지는 계속 본다", () => {
  const invs = [];
  for (let i = 0; i < 12; i++) invs.push("3801010" + String(3000 + i));
  FETCH_QUEUE.push({ code: 500, text: '{"sttsCd":"FAIL","sttsMsg":"일시 오류"}' });
  FETCH_QUEUE.push(reply({
    sttsCd: "SUCCESS",
    data: invs.slice(10).map(sn => ({
      slipNo: sn, resultCd: "TRUE",
      data1: [{ scanDt: "20260928", scanTm: "090000", statNm: "배송완료" }]
    }))
  }));

  const r = sandbox.csLogenTrackMany(invs);
  eq(r[invs[0]].ok, false, "첫 묶음은 실패");
  eq(r[invs[11]].ok, true, "둘째 묶음은 성공");
  eq(FETCH_LOG.length, 2, "두 번 다 부른다");
});

t("일일 한도에 닿으면 남은 묶음을 부르지 않는다", () => {
  const invs = [];
  for (let i = 0; i < 30; i++) invs.push("3801010" + String(4000 + i));
  PROPS["LOGEN_QUOTA_20260915"] = String(sandbox._LOGEN_QUOTA_SOFT_CAP_);

  const r = sandbox.csLogenTrackMany(invs);
  eq(FETCH_LOG.length, 0, "한 번도 부르지 않는다");
  eq(Object.keys(r).length, 30, "그래도 30건 모두 사유가 있다");
  ok(/한도/.test(r[invs[29]].error), "마지막 건도 한도 사유");
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
  eq(FETCH_LOG[0].opt.headers.secretKey, "TEST-KEY-PROD", "운영 키를 싣는다");
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
    eq(FETCH_LOG[0].body.env, "prod", "환경도 넘긴다 (지금은 운영)");
  } finally {
    sandbox.LOGEN_PROXY_URL = "";
    sandbox.LOGEN_PROXY_TOKEN = "";
  }
});

// ── 새 화물상태 기록이 «줄마다» 속성을 읽지 않는가 ──────────────
t("★ 아는 상태는 속성을 아예 안 본다 (보통의 날)", () => {
  let 읽음 = 0, 씀 = 0;
  const 본래 = sandbox.PropertiesService;
  sandbox.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => { 읽음++; return k in PROPS ? PROPS[k] : null; },
    setProperty: (k, v) => { 씀++; PROPS[k] = String(v); },
  }) };
  try {
    sandbox._LOGEN_STATNM_SEEN_ = null;
    const 아는것 = vm.runInContext("_LOGEN_STATUS_FLOW_.slice()", sandbox);
    ok(아는것.length >= 5, "아는 단계 표가 있다");
    for (let i = 0; i < 300; i++) {
      for (const s of 아는것) {
        vm.runInContext("_logen_noteStatus_(" + JSON.stringify(s) + ")", sandbox);
      }
    }
    eq(읽음, 0, "아는 상태 " + (300 * 아는것.length) + "번에 속성 읽기");
    eq(씀, 0, "쓰기");
  } finally { sandbox.PropertiesService = 본래; }
});

t("★ 새 상태가 나와도 속성은 한 번만 읽는다 (느려지던 날)", () => {
  /*  2026-10-09 — 25분을 먹은 _lrt_isOff_ 와 «같은 모양»이다.
      아는 7단계 울타리가 보통은 여기까지 안 오게 막지만, 정말 새 문자열이
      나온 날에는 그 상태를 가진 «줄마다» 속성을 읽었다. 한 회차 추적이
      수백~천 건이다. 새 상태가 나온 날에만 느려지는, 가장 안 반가운 함정. */
  let 읽음 = 0, 씀 = 0;
  const 본래 = sandbox.PropertiesService;
  sandbox.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => { 읽음++; return k in PROPS ? PROPS[k] : null; },
    setProperty: (k, v) => { 씀++; PROPS[k] = String(v); },
  }) };
  try {
    sandbox._LOGEN_STATNM_SEEN_ = null;
    WARNS.length = 0;
    for (let i = 0; i < 500; i++) {
      vm.runInContext('_logen_noteStatus_("아주새로운상태")', sandbox);
    }
    ok(읽음 <= 2, "500줄에 속성 읽기 " + 읽음 + "번 (2번 이하여야 한다)");
    eq(씀, 1, "쓰기는 한 번");
    eq(WARNS.filter((w) => /아주새로운상태/.test(w)).length, 1, "경고도 한 번");
    ok(/\|아주새로운상태\|/.test(PROPS["LOGEN_STATNM_SEEN"] || ""), "속성에 적혔다");
  } finally { sandbox.PropertiesService = 본래; }
});

t("★ 적는 순간에는 다시 읽는다 — 남이 적어 둔 것을 지우지 않는다", () => {
  /*  외운 것만 믿고 덮으면, 다른 실행이 그 사이 적어 둔 새 문자열이 사라진다.
      적는 일은 새 문자열마다 한 번뿐이라 다시 읽어도 싸다. */
  sandbox._LOGEN_STATNM_SEEN_ = "";            // 「비어 있다」고 외운 상태
  PROPS["LOGEN_STATNM_SEEN"] = "|남이적은것|";   // 그 사이 남이 적었다
  vm.runInContext('_logen_noteStatus_("내가본것")', sandbox);
  const v = PROPS["LOGEN_STATNM_SEEN"] || "";
  ok(/\|남이적은것\|/.test(v), "남이 적은 것이 살아 있다 — 실제: " + v);
  ok(/\|내가본것\|/.test(v), "내가 본 것도 적혔다 — 실제: " + v);
});

t("기록이 못 되더라도 조회를 막지 않는다", () => {
  const 본래 = sandbox.PropertiesService;
  sandbox.PropertiesService = { getScriptProperties: () => { throw new Error("못 읽음"); } };
  try {
    sandbox._LOGEN_STATNM_SEEN_ = null;
    vm.runInContext('_logen_noteStatus_("무엇이든")', sandbox);   // 터지지 않아야 한다
    ok(true, "터지지 않았다");
  } finally { sandbox.PropertiesService = 본래; }
});

// ── 마무리 ───────────────────────────────────────────────
console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
if (fail) {
  process.exit(1);
} else {
  console.log("  [실측] 붙은 것은 2026-10-07 «운영계» 실응답으로 검증했다.");
  console.log("  나머지는 문서 예시 기준이다 — **반품은 아직 실호출로 확인하지 않았다.**");
  console.log("  반품을 운영에서 부르면 실제로 접수된다. cancelReserveState 로 무를 수 있는");
  console.log("  것은 확인했지만, 집하 기사가 뜨기 전에 취소되는지는 아직 모른다.\n");
}
