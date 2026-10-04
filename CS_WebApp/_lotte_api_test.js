/**
 * 롯데택배 Open API 연결 점검 — 개발 환경
 *
 * ★ 왜 이 스크립트가 있나 ★
 *   롯데 게이트웨이는 "키 오류"와 "권한 미부여"를 똑같이 EGTA4011 로 돌려준다.
 *   FAQ 는 이걸 "API Key 가 잘못된 경우"로만 설명해서, 권한을 안 붙인 상태로
 *   키만 계속 재발급하는 삽질을 하기 쉽다. message 꼬리를 보고 갈라준다.
 *
 *   GAS 에 올리기 전에 여기서 먼저 통과시킨다. 포트(10100)·TLS·헤더 형식 문제인지
 *   권한 문제인지 로컬에서 30초 만에 가른다.
 *
 * 실행: node _lotte_api_test.js
 * (.claspignore 의 *_test.js 규칙으로 GAS 에는 올라가지 않는다)
 */
const fs = require("fs");
const https = require("https");

const HOST = "devapigw.llogis.com";
const PORT = 10100;
const TEST_CUST_CD = "101000";      // 개발서버 전용 테스트 거래처코드 (FAQ)
const TEST_INV_NO = "313633845254"; // 문서 예제 운송장번호

// 키는 _secrets.gs 에서만 읽는다. 이 파일에 값을 적지 말 것.
const secrets = fs.readFileSync("_secrets.gs", "utf8");
const KEY = (secrets.match(/var LOTTE_API_KEY_DEV\s*=\s*"([^"]+)"/) || [])[1];
if (!KEY) {
  console.log("NG  _secrets.gs 에서 LOTTE_API_KEY_DEV 를 찾지 못했습니다.");
  process.exit(1);
}

function call(method, path, body) {
  return new Promise(resolve => {
    const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const headers = { "Authorization": "IgtAK " + KEY };
    if (payload) {
      headers["Content-Type"] = "application/json;charset=UTF-8";
      headers["Content-Length"] = payload.length;
    }
    const req = https.request({ host: HOST, port: PORT, path, method, headers, timeout: 30000 },
      res => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", d => buf += d);
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "TIMEOUT" }); });
    req.on("error", e => resolve({ status: 0, body: "ERROR " + e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

/** EGTA4011 은 원인이 둘이다. message 꼬리로 가른다. */
function diagnose(status, body) {
  if (status === 0) return ["NG", "네트워크/TLS 실패 — " + body];
  if (/apiClient is null/.test(body)) {
    // ★ 키를 재발급하지 말 것 ★
    //   권한을 붙인 직후에도 이 메시지가 몇 분간 그대로 나온다(게이트웨이 캐싱).
    //   2026-08-31 에 실제로 겪었고, 아무것도 안 바꾸고 몇 분 뒤 재호출하니 200 이 왔다.
    //   여기서 키를 다시 발급받으면 원인을 엉뚱한 데서 찾게 된다.
    return ["NG", "[설정]-[권한] 에 RS_ADDR 이 없으면 추가할 것. " +
                  "이미 있다면 게이트웨이 반영 대기다 — 몇 분 뒤 재시도 (키 재발급 아님)"];
  }
  if (/입력이 필요/.test(body)) return ["NG", "Authorization 헤더 형식 오류"];
  if (/Invalid Token/.test(body)) return ["NG", "키 자체가 유효하지 않음"];
  if (status === 200) return ["OK", "응답 수신"];
  return ["??", "HTTP " + status];
}

function show(title, r) {
  const [mark, why] = diagnose(r.status, r.body);
  console.log("\n── " + title + " ──");
  console.log("  HTTP " + r.status + "  → " + mark + " : " + why);
  console.log("  " + r.body.replace(/\s+/g, " ").trim().slice(0, 300));
  return mark === "OK";
}

(async () => {
  console.log("HOST  https://" + HOST + ":" + PORT);
  console.log("KEY   길이 " + KEY.length + " (앞 12자 " + KEY.slice(0, 12) + "…)");

  const results = [];

  results.push(show("표준 화물추적 (GET)", await call(
    "GET",
    "/api/pid/cus/806/custmer-view-tracking?jobCustCd=" + TEST_CUST_CD +
    "&invNo=" + TEST_INV_NO + "&ordNo="
  )));

  results.push(show("주소정제 단건 (POST)", await call(
    "POST", "/api/address/newprint-info",
    {
      id: TEST_CUST_CD, network: "00",
      area_no: "04527", zip_no: "100801", address: "서울 중구 통일로 10 10층",
      pick_area_no: "08500", pick_zip_no: "153803",
      pick_address: "서울 금천구 가산디지털2로 179",
      spcalShopNm: "김롯데", tel: "010-0000-0000"
    }
  )));

  // 대조군 — 헤더 없이. 여기서 "입력이 필요" 가 나와야 게이트웨이가 정상 동작 중인 것이다.
  const bare = await new Promise(resolve => {
    https.get({
      host: HOST, port: PORT,
      path: "/api/pid/cus/806/custmer-view-tracking?jobCustCd=" + TEST_CUST_CD + "&invNo=" + TEST_INV_NO
    }, res => {
      let b = ""; res.setEncoding("utf8");
      res.on("data", d => b += d); res.on("end", () => resolve({ status: res.statusCode, body: b }));
    }).on("error", e => resolve({ status: 0, body: "ERROR " + e.message }));
  });
  console.log("\n── 대조군: 헤더 없이 호출 ──");
  console.log("  " + bare.body.replace(/\s+/g, " ").trim().slice(0, 200));
  console.log("  (여기서 '입력이 필요' 가 나오면 게이트웨이·포트는 정상이다)");

  const okCount = results.filter(Boolean).length;
  console.log("\n결과: " + okCount + "/" + results.length + " 통과");
  process.exit(okCount === results.length ? 0 : 1);
})();
