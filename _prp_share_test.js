/**
 * 로컬 검증: 협력업체 포털 공개 범위
 *
 *  2026-08-27 정책 변경 — 처리과정을 업체와 공유해 문의를 줄이려고
 *  상담·메모·사진을 **기본 공개**로 열었다. 숨기려면 `[내부]` 를 붙인다.
 *
 *  열어 놓은 만큼 여기서 지켜야 할 것이 늘었다.
 *    ① `[내부]` 가 붙은 줄은 절대 나가지 않는다
 *    ② 담당자 실명은 어떤 경로로도 나가지 않는다 (who 는 늘 역할 이름)
 *    ③ 형식 없는 옛 메모(note)는 계속 비공개
 *    ④ 업체 본인 글은 `[내부]` 와 무관하게 자기에게 보인다
 *    ⑤ CS앱과 포털의 내부 표시 판정이 서로 같다
 *
 * 실행: node _prp_share_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  →  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

/** 함수 하나를 본문까지 떼어낸다 */
function grabFn(src, name) {
  const s = src.indexOf("function " + name + "(");
  if (s < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}
/** `var NAME = ...;` 한 줄을 떼어낸다 (들여쓰기 허용) */
function grabVar(src, name) {
  const re = new RegExp("^[ \\t]*var\\s+" + name + "\\s*=.*?;[ \\t]*$", "m");
  const m = src.match(re);
  if (!m) throw new Error("var " + name + " 를 못 찾음");
  return m[0].trim();
}
/** 여러 줄에 걸친 `var NAME = { … };` — 중괄호를 맞춰 끝을 찾는다 */
function grabObj(src, name) {
  const re = new RegExp("^[ \\t]*var\\s+" + name + "\\s*=\\s*\\{", "m");
  const m = src.match(re);
  if (!m) throw new Error("var " + name + " (객체) 를 못 찾음");
  const s = m.index;
  let d = 0;
  for (let i = src.indexOf("{", s); i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") { d--; if (d === 0) return src.slice(s, i + 1).trim() + ";"; }
  }
  throw new Error("var " + name + " 객체가 안 닫힘");
}
/** 여러 줄에 걸친 `var NAME = [ … ];` — 대괄호를 맞춰 끝을 찾는다 */
function grabArr(src, name) {
  const re = new RegExp("^[ \\t]*var\\s+" + name + "\\s*=\\s*\\[", "m");
  const m = src.match(re);
  if (!m) throw new Error("var " + name + " (배열) 을 못 찾음");
  const s = m.index;
  let d = 0;
  for (let i = src.indexOf("[", s); i < src.length; i++) {
    if (src[i] === "[") d++;
    else if (src[i] === "]") { d--; if (d === 0) return src.slice(s, i + 1).trim() + ";"; }
  }
  throw new Error("var " + name + " 배열이 안 닫힘");
}

const ledgerSrc = fs.readFileSync("Partner_WebApp/prpLedger.gs", "utf8");
const configSrc = fs.readFileSync("Partner_WebApp/prpConfig.gs", "utf8");
const portalSrc = fs.readFileSync("Partner_WebApp/portal.html", "utf8");
const homeSrc = fs.readFileSync("CS_WebApp/home.html", "utf8");

// ── 서버: 공개 타임라인 ──────────────────────────────────────
const srvCtx = {};
vm.createContext(srvCtx);
vm.runInContext([
  grabVar(configSrc, "PRP_STAFF_PREFIX"),
  grabVar(configSrc, "PRP_PUBLIC_TIMELINE_KINDS"),
  grabVar(configSrc, "PRP_INTERNAL_MARK_"),
  grabFn(ledgerSrc, "prpYmdFromCell_"),
  grabFn(ledgerSrc, "prpSortKey_"),
  grabFn(ledgerSrc, "prpSortKeyFromYmd_"),
  grabFn(ledgerSrc, "prpPublicTimeline_")
].join("\n"), srvCtx);

function timeline(notice, vendor) {
  return vm.runInContext(
    "prpPublicTimeline_(" + JSON.stringify(notice) + ', "수거중", "김담당", "260827", "단순변심", ' +
    JSON.stringify(vendor || "준테크") + ")", srvCtx);
}

console.log("[1] 상담·메모·사진이 업체에게 나간다 (정책 변경의 핵심)");
const notice1 = [
  "[260826 10:00 김담당] 상태→수거요청",
  "[260826 11:30 김담당] 택배사 회수 접수했습니다. 내일 방문 예정입니다.",
  "[260827 09:10 박담당] 사진 첨부 https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz01234/view",
  "[260827 09:40 업체:준테크] 언제쯤 환불되나요?"
].join("\n");
const t1 = timeline(notice1);
check("이벤트 수 (접수 1건 포함)", t1.length, 5);
// 최신순. 접수(access)는 시각이 없어 그 날 00:00 으로 잡히므로 27일 기록들 뒤에 온다.
check("종류 목록(최신순)", t1.map(e => e.kind), ["mine", "photo", "access", "consult", "status"]);
check("상담 본문이 그대로 나간다",
  t1.filter(e => e.kind === "consult")[0].text,
  "택배사 회수 접수했습니다. 내일 방문 예정입니다.");
check("사진 줄에 드라이브 URL 이 살아 있다",
  /drive\.google\.com/.test(t1.filter(e => e.kind === "photo")[0].text), true);

console.log("\n[2] [내부] 표시가 붙은 줄은 나가지 않는다");
const notice2 = [
  "[260826 11:00 김담당] 정상 상담 내용",
  "[260826 12:00 김담당] [내부] 이 업체 반품률이 높다. 단가 재협상 필요",
  "[260826 13:00 김담당] #내부 다른 업체 건과 묶어서 처리",
  "[260826 14:00 김담당] 내부: 창고 재고 확인 중",
  "[260826 15:00 김담당] 내부적으로 검토한 결과 정상 처리됩니다"
].join("\n");
const t2 = timeline(notice2).filter(e => e.kind === "consult");
check("공개된 상담 건수", t2.length, 2);
check("남은 본문", t2.map(e => e.text).sort(),
  ["내부적으로 검토한 결과 정상 처리됩니다", "정상 상담 내용"]);
check("내부 문구가 하나도 안 섞였다",
  JSON.stringify(t2).indexOf("단가 재협상") < 0 &&
  JSON.stringify(t2).indexOf("다른 업체") < 0 &&
  JSON.stringify(t2).indexOf("창고 재고") < 0, true);

console.log("\n[3] 담당자 실명은 어떤 경우에도 나가지 않는다");
const t3 = timeline(notice1);
check("who 값 종류", [...new Set(t3.map(e => e.who))].sort(),
  ["CS팀", "CS팀 사진", "우리 문의", "CS팀 접수"].sort());
check("페이로드에 실명이 없다",
  JSON.stringify(t3).indexOf("김담당") < 0 && JSON.stringify(t3).indexOf("박담당") < 0, true);

console.log("\n[4] 형식 없는 옛 메모는 계속 비공개");
const t4 = timeline("앱 도입 전 자유기재 메모\n[260826 10:00 김담당] 상태→수거중");
check("공개 이벤트 수 (상태 1 + 접수 1)", t4.length, 2);
check("자유기재 줄이 없다", JSON.stringify(t4).indexOf("자유기재") < 0, true);

console.log("\n[5] 업체 본인 글은 [내부] 와 무관하게 자기에게 보인다");
const t5 = timeline("[260827 09:00 업체:준테크] [내부] 라고 써봤습니다", "준테크");
check("본인 문의가 남는다", t5.filter(e => e.kind === "mine").length, 1);

console.log("\n[6] 반품송장 메타 줄은 타임라인에 안 들어간다 (별도 필드로 이미 나간다)");
const t6 = timeline("반품송장: 1234567890\n[260826 10:00 김담당] 상태→수거중");
check("공개 이벤트 수", t6.length, 2);
check("송장 줄이 없다", JSON.stringify(t6).indexOf("반품송장:") < 0, true);

// ── 클라이언트: 처리 단계 · 썸네일 ──────────────────────────
const cliCtx = { OPEN_POP: "" };
vm.createContext(cliCtx);
vm.runInContext([
  grabVar(portalSrc, "STEPS"),
  grabFn(portalSrc, "esc"),
  grabFn(portalSrc, "stepIndex"),
  grabFn(portalSrc, "stepsHtml"),
  grabFn(portalSrc, "driveId"),
  grabFn(portalSrc, "thumbsHtml")
].join("\n"), cliCtx);
const stepIdx = s => vm.runInContext("stepIndex(" + JSON.stringify(s) + ")", cliCtx);

console.log("\n[7] 처리 단계 — '어디까지 됐나요' 를 대신 답한다");
check("접수", stepIdx("접수"), 0);
check("수거요청", stepIdx("수거요청"), 1);
check("수거중", stepIdx("수거중"), 2);
check("반품입고", stepIdx("반품입고"), 3);
check("입고검수 (반품입고보다 뒤로 잡혀야 한다)", stepIdx("입고검수"), 4);
check("환불처리", stepIdx("환불처리"), 5);
check("완료", stepIdx("완료"), 6);
check("이카운트 ok → 완료로 본다", stepIdx("이카운트 ok"), 6);
check("철회 → 흐름 밖", stepIdx("철회"), -1);
check("모르는 값 → 접수로 본다", stepIdx("듣보잡상태"), 0);
const stepHtml = vm.runInContext('stepsHtml({status:"반품입고"})', cliCtx);
check("현재 단계가 하나만 표시된다", (stepHtml.match(/ now/g) || []).length, 1);
check("지난 단계 3개가 done", (stepHtml.match(/ done/g) || []).length, 3);
check("철회는 바 대신 문장",
  /steps-off-note/.test(vm.runInContext('stepsHtml({status:"철회"})', cliCtx)), true);

console.log("\n[8] 사진 썸네일");
const fid = "1AbCdEfGhIjKlMnOpQrStUvWxYz01234";
const tb = vm.runInContext("thumbsHtml(" + JSON.stringify(
  "사진 첨부 https://drive.google.com/file/d/" + fid + "/view https://drive.google.com/file/d/" + fid + "/view"
) + ")", cliCtx);
check("썸네일 2장", (tb.match(/<img /g) || []).length, 2);
check("드라이브 썸네일 주소를 쓴다", tb.indexOf("drive.google.com/thumbnail?id=" + fid) >= 0, true);
check("속성 안의 & 를 escape 했다", tb.indexOf("&amp;sz=w480") >= 0, true);
check("드라이브 링크가 없으면 빈 문자열",
  vm.runInContext('thumbsHtml("그냥 상담 내용입니다")', cliCtx), "");

console.log("\n[9] 반품송장 배송조회 링크 — 업체가 가장 자주 묻는 항목");
vm.runInContext([
  grabArr(portalSrc, "TRACK"),
  grabFn(portalSrc, "trackUrl"),
  grabFn(portalSrc, "invLine")
].join("\n"), cliCtx);
const tUrl = (inv, hint) => vm.runInContext(
  "trackUrl(" + JSON.stringify(inv) + "," + JSON.stringify(hint || "") + ")", cliCtx);
check("롯데 → 롯데글로지스", /lotteglogis\.com/.test(tUrl("1234567890", "롯데택배")), true);
check("로젠 → 아이로젠", /ilogen\.com/.test(tUrl("1234567890", "로젠택배")), true);
check("CJ → CJ대한통운", /cjlogistics\.com/.test(tUrl("1234567890", "CJ대한통운")), true);
check("한진 → 한진", /hanjin\.com/.test(tUrl("1234567890", "한진택배")), true);
check("우체국 → 우체국", /epost\.go\.kr/.test(tUrl("1234567890", "우체국")), true);
check("택배사 모르면 네이버 검색", /search\.naver\.com/.test(tUrl("1234567890", "")), true);
check("송장 8자리 미만이면 링크 없음", tUrl("123", "롯데"), "");
check("하이픈 섞인 송장도 숫자만 뽑는다",
  tUrl("123-456-7890", "롯데").indexOf("InvNo=1234567890") >= 0, true);
const line = vm.runInContext('invLine("반품송장","1234567890","롯데")', cliCtx);
check("반품송장 줄이 링크가 된다", /<a class="inv-link"/.test(line), true);
check("송장 없으면 줄 자체가 없다", vm.runInContext('invLine("반품송장","","롯데")', cliCtx), "");
// CS앱과 URL 이 어긋나면 업체와 CS가 다른 화면을 보며 통화한다
const csTrack = homeSrc.match(/https:\/\/www\.lotteglogis\.com[^'"]*/)[0];
check("롯데 URL 이 CS앱과 같다",
  tUrl("1234567890", "롯데").indexOf(csTrack.replace("' + d", "")) >= 0, true);

console.log("\n[10] CS앱과 포털의 내부 표시 판정이 같다 (한쪽만 고치면 조용히 어긋난다)");
const portalMark = grabVar(configSrc, "PRP_INTERNAL_MARK_").replace(/^var\s+\S+\s*=\s*/, "").replace(/;$/, "");
const csMark = grabVar(homeSrc, "RET_INTERNAL_MARK").replace(/^var\s+\S+\s*=\s*/, "").replace(/;$/, "");
check("정규식 문자열이 일치", csMark, portalMark);

console.log("\n[11] CS 반품카드 업체 아이콘 표가 포털·허브와 같다");
const pepSrc = fs.readFileSync("_partnerExclusivePush.gs", "utf8");
const iconCtx = {};
vm.createContext(iconCtx);
vm.runInContext([
  grabObj(homeSrc, "RET_VENDOR_LABELS"),
  grabObj(homeSrc, "RET_VENDOR_ALIAS"),
  grabObj(homeSrc, "RET_VENDOR_COLOR"),
  grabFn(homeSrc, "retNormVendor_"),
  grabFn(homeSrc, "retVendorDisplayName_"),
  grabFn(homeSrc, "retVendorInfo"),
  grabObj(configSrc, "PRP_VENDOR_LABELS"),
  grabObj(pepSrc, "_PEP_VENDOR_LABELS_")
].join("\n"), iconCtx);
const keysOf = (name) => vm.runInContext("Object.keys(" + name + ").sort().join(',')", iconCtx);
check("CS 표 = 포털 표", keysOf("RET_VENDOR_LABELS"), keysOf("PRP_VENDOR_LABELS"));
check("CS 표 = 허브 표", keysOf("RET_VENDOR_LABELS"), keysOf("_PEP_VENDOR_LABELS_"));
const infoOf = (name) => vm.runInContext("retVendorInfo(" + JSON.stringify(name) + ")", iconCtx);
check("준테크 → JT", infoOf("준테크").pfx, "JT");
check("냅킨코리아 → NK", infoOf("냅킨코리아").pfx, "NK");
check("보조접두 NS → JT", infoOf("NS").pfx, "JT");
check("업체명 없으면 아이콘 없음", infoOf(""), null);
check("모르는 업체는 앞 글자", infoOf("새업체").pfx, "새업체");
check("법인/배민 → 배민", infoOf("법인/배민").pfx, "배민");
check("법인 / 배민상회 → 슬래시 뒤", infoOf("법인 / 배민상회").pfx, "배민상회");
check("슬래시 있으면 뒤 상호명", infoOf("채널/스마트스토어").pfx, "스마트스토어");
check("법인/준테크 → 준테크 (접두 아님)", infoOf("법인/준테크").pfx, "준테크");
check("법인만 있고 슬래시 없으면 그대로", infoOf("법인").pfx, "법인");

console.log("\n" + (fail === 0 ? "전부 통과" : "실패 " + fail + "건") + " (통과 " + pass + ")");
process.exit(fail === 0 ? 0 : 1);
