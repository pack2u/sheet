/**
 * csLotte.gs 로컬 검증 — **실제 API 응답**으로 파싱을 확인한다.
 *
 * ★ 왜 이렇게 하나 ★
 *   GAS 전역(UrlFetchApp / CacheService / PropertiesService / Utilities)은 Node 에 없다.
 *   그렇다고 응답을 손으로 지어내면 _csbarcode_test.js 때와 같은 함정에 빠진다
 *   (가짜 샘플이 틀린 구현을 통과시켰다).
 *   그래서 **개발 게이트웨이를 실제로 호출해 응답을 받아온 뒤**, 그 응답을 돌려주는
 *   UrlFetchApp 스텁을 끼워 csLotte.gs 를 그대로 돌린다. 파싱만 검증 대상이다.
 *
 * 실행: node _cslotte_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");
const https = require("https");

const HOST = "devapigw.llogis.com", PORT = 10100;
const KEY = fs.readFileSync("_secrets.gs", "utf8")
  .match(/var LOTTE_API_KEY_DEV\s*=\s*"([^"]+)"/)[1];

function live(method, path, body) {
  return new Promise(resolve => {
    const pl = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const headers = { "Authorization": "IgtAK " + KEY };
    if (pl) {
      headers["Content-Type"] = "application/json;charset=UTF-8";
      headers["Content-Length"] = pl.length;
    }
    const req = https.request({ host: HOST, port: PORT, path, method, headers, timeout: 25000 },
      res => {
        let d = ""; res.setEncoding("utf8");
        res.on("data", c => d += c);
        res.on("end", () => resolve({ code: res.statusCode, text: d }));
      });
    req.on("error", e => resolve({ code: 0, text: '{"code":"E","message":"' + e.message + '"}' }));
    req.on("timeout", () => { req.destroy(); resolve({ code: 0, text: '{"code":"E","message":"timeout"}' }); });
    if (pl) req.write(pl);
    req.end();
  });
}

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  cond ? pass++ : fail++;
  console.log((cond ? "  OK " : "  NG ") + label + (extra ? "  → " + extra : ""));
}

(async () => {
  // ── 실제 응답을 미리 받아둔다 ──────────────────────────
  const trkRes = await live("GET",
    "/api/pid/cus/806/custmer-view-tracking?jobCustCd=101000&invNo=313633845254&ordNo=");
  const addrRes = await live("POST", "/api/address/newprint-info", {
    id: "348782", network: "00",
    area_no: "04527", zip_no: "100801", address: "서울 중구 통일로 10 10층",
    pick_area_no: "08500", pick_zip_no: "153803",
    pick_address: "서울 금천구 가산디지털2로 179"
  });
  // 우리 거래처코드로 화물추적 — 연계 등록 전이면 막혀 있어야 한다
  const blockedRes = await live("GET",
    "/api/pid/cus/806/custmer-view-tracking?jobCustCd=348782&invNo=313633845254&ordNo=");

  // ── GAS 전역 스텁 ────────────────────────────────────
  let served = null; // 다음 호출에 돌려줄 응답
  global.UrlFetchApp = {
    fetch(url, opt) {
      const r = served;
      return {
        getResponseCode: () => r.code,
        getContentText: () => r.text
      };
    }
  };
  const cacheStore = {};
  global.CacheService = {
    getScriptCache: () => ({
      get: k => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = v; }
    })
  };
  const propStore = {};
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: k => (k in propStore ? propStore[k] : null),
      setProperty: (k, v) => { propStore[k] = v; },
      deleteProperty: k => { delete propStore[k]; },
      getProperties: () => Object.assign({}, propStore)
    })
  };
  global.Utilities = {
    formatDate(d, tz, fmt) {
      const p = n => String(n).padStart(2, "0");
      if (fmt === "yyyyMMdd") return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
      throw new Error("스텁이 모르는 포맷: " + fmt);
    }
  };
  global.LOTTE_API_KEY_DEV = KEY;
  global.LOTTE_API_KEY_PROD = "";

  eval(fs.readFileSync("csLotte.gs", "utf8"));

  // ── [1] 화물추적 파싱 ────────────────────────────────
  console.log("\n[1] 화물추적 — 실제 응답 파싱");
  served = trkRes;
  const t = csLotteTrack("3136-3384-5254", { noCache: true });
  ok("조회 성공", t.ok, t.ok ? "" : t.error);
  ok("운송장번호 숫자만 추출", t.invoice === "313633845254", t.invoice);
  ok("이력이 있다", t.history.length > 0, t.history.length + "건");
  ok("이력이 시간순 정렬", t.history.every((h, i, a) => i === 0 || a[i - 1].sortKey <= h.sortKey));
  ok("최종 상태명이 비지 않음", !!t.statusName, t.statusName);
  ok("배달완료 아님 (마지막이 집하)", t.delivered === false, t.statusCode + " " + t.statusName);
  console.log("     이력: " + t.history.map(h => h.code + ":" + h.name + "@" + h.at).join(" → "));

  console.log("\n[2] 코드표에 없는 코드 — 뭉개지 않아야 한다");
  const unknown = t.history.filter(h => !_LOTTE_STATUS_[h.code]);
  ok("02(출력)처럼 표에 없는 코드가 실제로 존재", unknown.length > 0,
     unknown.map(h => h.code + ":" + h.name).join(", ") || "없음");
  ok("표에 없어도 응답의 이름을 살려서 표시",
     unknown.every(h => h.name && !/^코드 /.test(h.name)),
     unknown.map(h => h.name).join(", "));
  ok("표에 있는 코드는 표 이름을 쓴다",
     t.history.filter(h => _LOTTE_STATUS_[h.code])
              .every(h => h.name === _LOTTE_STATUS_[h.code]));

  console.log("\n[3] 캐시");
  served = { code: 500, text: '{"code":"E","message":"캐시를 안 썼다면 이 오류가 보인다"}' };
  const cached = csLotteTrack("3136-3384-5254");
  ok("두 번째 호출은 캐시에서 온다", cached.ok && cached.cached === true);
  ok("캐시 내용이 같다", cached.statusCode === t.statusCode);

  console.log("\n[4] 주소정제 — 우리 거래처코드 348782");
  served = addrRes;
  const a = csLotteRefineAddress({
    areaNo: "04527", zipNo: "100801", address: "서울 중구 통일로 10 10층",
    pickAreaNo: "08500", pickZipNo: "153803",
    pickAddress: "서울 금천구 가산디지털2로 179"
  });
  ok("정제 성공", a.ok, a.ok ? a.branchNm + " / " + a.empNm : a.error);
  ok("배송 가능 판정", a.deliverable === true, "dlvMsg=" + JSON.stringify(a.dlvMsg));

  console.log("\n[5] 오류 처리 — 연계 등록 전 우리 거래처코드");
  served = blockedRes;
  const b = csLotteTrack("313633845254", { noCache: true });
  const blockedMsg = JSON.parse(blockedRes.text).message || "";
  if (/연계\s*등록/.test(blockedMsg)) {
    ok("차단을 ok:false 로 돌려준다", b.ok === false);
    ok("원인 메시지를 그대로 전달", /연계\s*등록/.test(b.error), b.error);
  } else {
    ok("★ 연계 등록이 완료된 듯 — _LOTTE_TRACK_CUST_CD_ 를 348782 로 바꿀 것", b.ok === true,
       blockedMsg || "정상 조회됨");
  }

  console.log("\n[6] 쿼터 카운터");
  const q = csLotteQuotaUsed();
  ok("호출 수가 집계된다", q.used > 0, q.used + "/" + q.softCap);

  console.log("\n[7] 입력 검증");
  ok("빈 입력 거부", csLotteTrack("").ok === false);

  console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
  process.exit(fail ? 1 : 0);
})();
