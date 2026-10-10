/**
 * 로젠 개발계 실호출 확인 — **이 PC(사무실 IP)에서** 직접 부른다.
 *
 * ★ 왜 여기서 부르나 ★
 *   신청등록(개발계)에 등록한 IP 가 «사무실 IP» 다. 중계기(siot.com) IP 는
 *   아직 개발계에 등록 전이라 그쪽으로는 못 부른다.
 *   그래서 등록된 자리 — 이 PC — 에서 먼저 확인한다.
 *
 * ★ 무엇을 보나 ★
 *   ① 인증키가 유효한가
 *   ② 사무실 IP 가 실제로 열렸는가 (미등록이면 401 이 아니라 **timeout** 이 난다)
 *   ③ 응답이 문서와 같은 모양인가  ← _cslogen_test.js 의 FIXTURE 를 갈아 끼울 근거
 *
 * ★ 키는 여기 적지 않는다 ★
 *   relay_config.php 에서 읽는다(.gitignore 대상).
 *   CS_WebApp/_cslotte_test.js 가 _secrets.gs 를 읽는 것과 같은 방식이다.
 *
 * 실행: node _logen_live_test.mjs
 */
import fs from "node:fs";
import https from "node:https";

/** `--prod` 를 붙이면 운영계. 기본은 개발계. */
const PROD = process.argv.includes("--prod");
const FIELD = PROD ? "secretKeyProd" : "secretKeyDev";

const CFG = fs.readFileSync("relay_config.php", "utf8");
const KEY = (CFG.match(new RegExp("'" + FIELD + "'\\s*=>\\s*'([^']+)'")) || [])[1];
if (!KEY) {
  console.log("NG  relay_config.php 에서 " + FIELD + " 를 못 찾았습니다.");
  process.exit(1);
}

const HOST = PROD ? "openapi.ilogen.com" : "topenapi.ilogen.com";
const USER_ID = "30556066";                   // 담당자 확인: userId·custCd 둘 다 거래처코드
const CUST_CD = "30556066";

function call(api, body, timeout = 20000) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = https.request(
      {
        host: HOST,
        port: 443,
        path: "/lrm02b-edi/edi/" + api,
        method: "POST",
        timeout,
        headers: {
          "secretKey": KEY,
          "Content-Type": "application/json;charset=UTF-8",
          "Content-Length": payload.length,
        },
      },
      (res) => {
        let d = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ code: res.statusCode, text: d }));
      }
    );
    req.on("error", (e) => resolve({ code: 0, text: "", err: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ code: 0, text: "", err: "timeout" });
    });
    req.write(payload);
    req.end();
  });
}

const started = Date.now();
console.log("\n로젠 개발계 실호출 — " + HOST + "\n");

const r = await call("contractTotalInfo", {
  userId: USER_ID,
  data: [{ custCd: CUST_CD }],
});

const ms = Date.now() - started;

if (r.code === 0) {
  console.log("  NG  연결 실패 (" + (r.err || "?") + ") · " + ms + "ms");
  console.log("      로젠은 «미등록 IP» 의 연결을 드롭한다 — 401 이 아니라 timeout 이 난다.");
  console.log("      이 PC 의 공인 IP 가 해당 환경에 등록되어 있는지 확인할 것.");
  process.exit(1);
}

console.log("  HTTP " + r.code + " · " + ms + "ms\n");

let j = null;
try { j = JSON.parse(r.text); } catch (e) { /* 아래서 처리 */ }

if (!j) {
  console.log("  NG  JSON 이 아니다:\n" + r.text.slice(0, 500));
  process.exit(1);
}

console.log(JSON.stringify(j, null, 2));
console.log("");

// 규격서 2장의 판정 규칙대로 읽어 본다
const rows = Array.isArray(j.data) ? j.data : (j.data ? [j.data] : []);
const ok = (v) => ["TRUE", "SUCCESS"].includes(String(v || "").toUpperCase().trim());

console.log("  sttsCd        : " + j.sttsCd);
console.log("  sttsMsg       : " + j.sttsMsg);
console.log("  건수          : " + rows.length);
rows.forEach((row, i) => {
  console.log("  [" + i + "] resultCd  : " + row.resultCd + "  → " + (ok(row.resultCd) ? "성공" : "실패"));
  if (row.resultMsg) console.log("      resultMsg : " + row.resultMsg);
  if (ok(row.resultCd)) {
    console.log("      집하영업소 : " + row.pickSalesNm + " (" + row.pickSalesCd + ")");
    console.log("      집하지점   : " + row.pickBranNm + " (" + row.pickBranCd + ")");
    console.log("      운임타입   : " + row.fareTy + " " + row.fareTyNm);
    console.log("      사용여부   : " + row.useYn);
  }
});
console.log("");
