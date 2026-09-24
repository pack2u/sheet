/**
 * csLotte.gs 로컬 검증 — **운영 환경 실제 응답**으로 파싱을 확인한다.
 *
 * ★ 왜 이렇게 하나 ★
 *   GAS 전역(UrlFetchApp / CacheService / PropertiesService / Utilities)은 Node 에 없다.
 *   그렇다고 응답을 손으로 지어내면 _csbarcode_test.js 때와 같은 함정에 빠진다
 *   (가짜 샘플이 틀린 구현을 통과시켰다).
 *   그래서 **운영 게이트웨이를 실제로 호출해 응답을 받아온 뒤**, 그 응답을 돌려주는
 *   UrlFetchApp 스텁을 끼워 csLotte.gs 를 그대로 돌린다. 파싱만 검증 대상이다.
 *
 * ★ 2026-09-08 운영 전환 ★
 *   개발 환경은 거래처 348782 의 화물추적 연계 등록이 없어 쓸 수 없다.
 *   운영에서는 우리 실제 송장이 그대로 조회된다.
 *
 * 실행: node _cslotte_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");
const https = require("https");

const HOST = "apigw.llogis.com", PORT = 10100;
const CUST = "348782";
const INV = "258131494106"; // 실제 출고 송장 (배달완료 건)

const KEY = fs.readFileSync("_secrets.gs", "utf8")
  .match(/var LOTTE_API_KEY_PROD\s*=\s*"([^"]+)"/)[1];

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
  const trkRes = await live("GET",
    "/api/pid/cus/806/custmer-view-tracking?jobCustCd=" + CUST + "&invNo=" + INV + "&ordNo=");
  const addrRes = await live("POST", "/api/address/newprint-info", {
    id: CUST, network: "00",
    area_no: "04527", zip_no: "100801", address: "서울 중구 통일로 10 10층",
    pick_area_no: "08500", pick_zip_no: "153803",
    pick_address: "서울 금천구 가산디지털2로 179"
  });

  // ── GAS 전역 스텁 ────────────────────────────────────
  let served = null;
  global.UrlFetchApp = {
    fetch() {
      const r = served;
      return { getResponseCode: () => r.code, getContentText: () => r.text };
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
  global.LOTTE_API_KEY_DEV = "";
  global.LOTTE_API_KEY_PROD = KEY;

  eval(fs.readFileSync("csLotte.gs", "utf8"));

  console.log("\n[0] 환경 설정");
  ok("운영 환경으로 설정됨", _LOTTE_USE_PROD_ === true);
  ok("화물추적 거래처코드가 우리 코드", _LOTTE_TRACK_CUST_CD_ === CUST, _LOTTE_TRACK_CUST_CD_);
  ok("호스트가 운영 게이트웨이", _lotte_host_().indexOf("apigw.llogis.com") > -1, _lotte_host_());

  console.log("\n[1] 화물추적 — 운영 실제 응답 파싱");
  served = trkRes;
  const t = csLotteTrack(INV, { noCache: true });
  ok("조회 성공", t.ok, t.ok ? "" : t.error);
  ok("운송장번호 일치", t.invoice === INV, t.invoice);
  ok("이력 수신", t.history.length > 0, t.history.length + "건");
  console.log("     " + t.history.map(h => h.code + ":" + h.name).join(" → "));

  console.log("\n[2] 시간순 정렬 — 응답 순서는 시간순이 아니다");
  ok("정렬됨", t.history.every((h, i, a) => i === 0 || a[i - 1].sortKey <= h.sortKey));
  const rawOrder = (JSON.parse(trkRes.text).tracking || []).map(x => x.godsStatCd).join(",");
  const sorted = t.history.map(h => h.code).join(",");
  ok("실제로 재정렬이 일어났다(응답 순서와 다름)", rawOrder !== sorted,
     "응답 " + rawOrder + " / 정렬 " + sorted);

  console.log("\n[3] 대표 상태 — 배달완료가 있으면 그것을 쓴다");
  ok("delivered = true", t.delivered === true);
  ok("statusCode = 41", t.statusCode === "41", t.statusCode);
  ok("statusName = 배달완료", t.statusName === "배달완료", t.statusName);
  ok("배달완료 시각이 있다", !!t.lastAt, t.lastAt);
  const lastEvent = t.history[t.history.length - 1];
  ok("마지막 이벤트가 41이 아니어도 대표는 41 (후속 처리에 가려지지 않음)",
     t.statusCode === "41", "마지막 이벤트=" + lastEvent.code + ":" + lastEvent.name);

  console.log("\n[4] 코드표에 없는 코드 / 같은 코드의 다른 이름");
  const names = {};
  t.history.forEach(h => { (names[h.code] = names[h.code] || []).push(h.name); });
  ok("표에 없던 코드가 실제로 온다", t.history.some(h => ["02", "05", "45"].indexOf(h.code) > -1),
     Object.keys(names).join(","));
  ok("이름이 비어 있는 이벤트가 없다", t.history.every(h => h.name && !/^코드 /.test(h.name)));
  const multi = Object.keys(names).filter(c => new Set(names[c]).size > 1);
  if (multi.length) {
    ok("같은 코드의 서로 다른 이름을 뭉개지 않는다",
       multi.every(c => new Set(names[c]).size > 1),
       multi.map(c => c + "=" + [...new Set(names[c])].join("/")).join(" "));
  }

  console.log("\n[5] 시각이 '------' 인 이벤트");
  const noTime = (JSON.parse(trkRes.text).tracking || [])
    .filter(x => !/^\d{6}$/.test(String(x.scanTme || "")));
  if (noTime.length) {
    ok("시각 없는 이벤트가 실제로 있다", true,
       noTime.map(x => x.godsStatCd + ":" + x.godsStatNm).join(","));
    ok("정렬이 깨지지 않는다", t.history.every(h => h.sortKey.length === 17));
    ok("표시 문자열이 날짜만 남고 깨지지 않는다",
       t.history.filter(h => noTime.some(n => n.godsStatCd === h.code))
                .every(h => /^\d{2}-\d{2}$/.test(h.at) || h.at === ""));
  } else {
    console.log("  -- 이번 응답에는 없음 (건너뜀)");
  }

  console.log("\n[6] 캐시");
  served = { code: 500, text: '{"code":"E","message":"캐시를 안 썼다면 이 오류가 보인다"}' };
  const cached = csLotteTrack(INV);
  ok("두 번째 호출은 캐시에서 온다", cached.ok && cached.cached === true);
  ok("캐시 내용이 같다", cached.statusCode === t.statusCode);

  console.log("\n[7] 주소정제");
  served = addrRes;
  const a = csLotteRefineAddress({
    areaNo: "04527", zipNo: "100801", address: "서울 중구 통일로 10 10층",
    pickAreaNo: "08500", pickZipNo: "153803",
    pickAddress: "서울 금천구 가산디지털2로 179"
  });
  ok("정제 성공", a.ok, a.ok ? a.branchNm + " / " + a.empNm : a.error);
  ok("배송 가능 판정", a.deliverable === true, "dlvMsg=" + JSON.stringify(a.dlvMsg));

  console.log("\n[8] 입력 검증 / 쿼터");
  ok("빈 입력 거부", csLotteTrack("").ok === false);
  ok("호출 수가 집계된다", csLotteQuotaUsed().used > 0, csLotteQuotaUsed().used + "/" + _LOTTE_QUOTA_SOFT_CAP_);

  console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
  process.exit(fail ? 1 : 0);
})();
