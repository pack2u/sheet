/**
 * 로컬 검증: 「진행 중」이 정말 진행 중인가
 *
 *  > "대리판매 마감도 중간에 멈추고 다시 실행하면 백그라운드에서
 *  >  실행중이라고.. 11시간전에 실행된건데.."
 *
 *  여태 판정은 «깃발만» 봤다. 남은 목록이나 예약 키가 있으면 돌고 있는
 *  것으로 쳤다. 그런데 백그라운드는 트리거가 굴린다 — 트리거가 죽으면
 *  깃발만 남고, 시스템이 «없는 일»을 있다고 말한다.
 *
 * 실행: node _pea_stale_test.js
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

const src = fs.readFileSync("_partnerExclusiveArchive.gs", "utf8");
function grab(n) {
  const s = src.indexOf("function " + n + "(");
  if (s < 0) throw new Error(n + " 를 못 찾음");
  let d = 0, seen = false;
  for (let i = s; i < src.length; i++) {
    if (src[i] === "{") { d++; seen = true; }
    else if (src[i] === "}") { d--; if (seen && d === 0) return src.slice(s, i + 1); }
  }
}

/** 트리거가 있나 / 몇 분 전에 시작했나 를 정해 놓고 본다 */
function 문맥(트리거있음, 지난분) {
  const now = 1757900000000;
  const started = 지난분 === null ? "" : String(now - 지난분 * 60000);
  const ctx = {
    _PEA_RESUME_TRIGGER_: "_pea_resume_",
    ScriptApp: {
      getProjectTriggers: () => (트리거있음
        ? [{ getHandlerFunction: () => "_pea_resume_" }]
        : [{ getHandlerFunction: () => "다른함수" }]),
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => started, setProperty() {} }),
    },
    Utilities: { formatDate: () => "09-14 22:10" },
    Date: class extends Date {
      constructor(...a) { super(...(a.length ? a : [now])); }
      getTime() { return a0 ? super.getTime() : now; }
    },
  };
  let a0 = false;
  ctx.Date = function (v) { return v === undefined ? { getTime: () => now } : new Date(v); };
  vm.createContext(ctx);
  vm.runInContext([
    "var _PEA_STARTED_KEY_ = '_PEA_STARTED_AT';",
    "var _PEA_STALE_MIN_ = 30;",
    grab("_pea_resumeTriggerAlive_"),
    grab("_pea_runState_"),
    grab("_pea_ago_"),
  ].join("\n"), ctx);
  return ctx;
}

console.log("\n[진행 중] 트리거가 없으면 돌고 있지 않다");
{
  const c = 문맥(false, 5);
  const s = c._pea_runState_();
  check("★ 트리거가 없으면 «안 돎»", s.돌고있나, false);
  check("★ 까닭을 말한다", /재개 트리거가 없습니다/.test(s.왜), true);
}

console.log("\n[진행 중] 트리거가 있어도 너무 오래면 멈춘 것");
{
  const c = 문맥(true, 11 * 60);   // 11시간 전
  const s = c._pea_runState_();
  check("★★ 11시간째면 멈춘 것으로 본다", s.돌고있나, false);
  check("★ 몇 분째인지 말한다", /660분째/.test(s.왜), true);
}

console.log("\n[진행 중] 방금 시작했으면 정말 진행 중");
{
  const c = 문맥(true, 3);
  const s = c._pea_runState_();
  check("★ 3분 전 · 트리거 있음 → 진행 중", s.돌고있나, true);
  check("그때는 까닭이 없다", s.왜, "");
  check("얼마나 됐는지는 늘 안다", s.지난분, 3);
}

console.log("\n[진행 중] 시작 시각을 모를 때");
{
  const c = 문맥(true, null);
  const s = c._pea_runState_();
  check("트리거가 있으면 진행 중으로 본다", s.돌고있나, true);
  check("모르면 모른다고", s.시작, "(모름)");
}

console.log("\n[읽기 좋은 꼴]");
{
  const c = 문맥(true, 3);
  check("45분", c._pea_ago_(45), "45분 전");
  check("1시간", c._pea_ago_(60), "1시간 전");
  check("★ 11시간 20분", c._pea_ago_(680), "11시간 20분 전");
  check("모를 때", c._pea_ago_(-1), "(언제인지 모름)");
}

console.log("\n[소스] 화면이 사실을 말하는가");
{
  check("★ 돌고 있을 때만 「진행 중」이라고 한다",
    src.includes('if (상태.돌고있나) {'), true);
  check("★ 아니면 «멈췄다»고 한다",
    src.includes('"⚠ 대리공급 마감이 멈춰 있습니다"'), true);
  check("★ 멈춘 까닭을 같이 적는다", src.includes("상태.왜 +"), true);
  check("★ 언제 시작했는지 적는다", src.includes("_pea_ago_(상태.지난분)"), true);
  check("★ 시작할 때 시각을 남긴다", src.includes("_pea_markStarted_();"), true);
  check("★ 「이미 백그라운드에서 처리 중입니다」라는 거짓말이 사라졌다",
    src.includes('"이미 백그라운드에서 처리 중입니다.'), false);
}

console.log("\n" + (fail ? "실패 " + fail + "건 / " : "") + "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
