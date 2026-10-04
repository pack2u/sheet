/**
 * 설정이 엔진까지 가는가
 *
 *  ★ 2026-09-22 에 여섯이 조용히 막혀 있었다 ★
 *    gasMain 이 설정을 «손으로 옮겨 적고» 있었다. 그 목록에 없으면 설정 탭에
 *    값이 있어도, 요약에 그 값이 찍혀도, 엔진은 못 본다. 틀린 데가 없어 보여서
 *    아무도 못 찾는다.
 *
 *      도선료_통일금액        9/21 「5,000원으로 통일」이 여태 안 먹었다
 *      합포장_최대건수_샘플     샘플 14개 한도
 *      합포장_품목낱말         합포장/합배송 가르기
 *      미발송_적요낱말         적요로 미발송 빼기 (사장님이 손으로 빼고 계셨다)
 *      도선료표_기준 · 고유ID_짧은날짜_전환일
 *
 *  이제 기본값을 깔고 시트 값으로 덮는다. 새 설정은 저절로 따라온다.
 *  이 시험은 그 길이 다시 막히지 않게 지킨다.
 *
 * 실행: node _sscfg_test.js
 */
const fs = require("fs"), vm = require("vm"), path = require("path");
const core = require(path.join(__dirname, "세트분리V2", "core.js"));

let pass = 0, fail = 0;
function ok(label, cond, 덧) {
  if (cond) { pass++; console.log("  ✅ " + label); }
  else { fail++; console.log("  ❌ " + label + (덧 === undefined ? "" : "   " + 덧)); }
}

const main = fs.readFileSync(path.join(__dirname, "세트분리V2", "gasMain.js"), "utf8");

console.log("\n① 손으로 옮겨 적지 않는다");
{
  //  옛 모양: var cfg = { 자사출고지접두: cfgRaw['자사출고지접두'] || …, … }
  ok("★ 설정 이름을 하나씩 나열한 덩어리가 없다",
    !/var cfg = \{[\s\S]{0,200}cfgRaw\['자사출고지접두'\]/.test(main));
  ok("기본값을 먼저 깐다", /for \(var _dk in SS_DEFAULT_CONFIG\)/.test(main));
  ok("시트 값으로 덮는다", /for \(var _ck in cfgRaw\)/.test(main));
  ok("빈 칸은 안 덮는다 (안 적은 것은 기본값대로)",
    /_cv === ''[\s\S]{0,60}continue;/.test(main));
}

console.log("\n② 그 코드를 그대로 돌려 본다");
{
  //  두 반복문을 «둘 다» 담아야 한다 — 첫 } 에서 끊으면 덮어쓰기가 빠진다
  const 시작 = main.indexOf("var cfg = {};");
  const 끝 = main.indexOf("단계 = ss단계_('판매현황 읽기')", 시작);
  const 덩어리 = main.slice(시작, 끝);
  const box = vm.createContext({
    SS_DEFAULT_CONFIG: core.SS_DEFAULT_CONFIG,
    cfgRaw: {
      합포장_최대건수: "10",          // 시트가 고친 값
      도선료_통일금액: "",            // 비워 둔 값 — 기본값을 이기면 안 된다
      새로생긴설정: "무엇이든",        // 목록에 없어도 따라와야 한다
    },
    Object, console,
  });
  vm.runInContext(덩어리, box);
  const cfg = vm.runInContext("cfg", box);

  ok("★ 기본값이 전부 실린다",
    Object.keys(core.SS_DEFAULT_CONFIG).every((k) => cfg[k] !== undefined),
    Object.keys(core.SS_DEFAULT_CONFIG).filter((k) => cfg[k] === undefined).join(", "));
  ok("시트 값이 기본값을 덮는다", cfg.합포장_최대건수 === "10", cfg.합포장_최대건수);
  ok("★ 빈 칸은 기본값을 안 덮는다", String(cfg.도선료_통일금액) === "5000", cfg.도선료_통일금액);
  ok("★ 목록에 없던 새 설정도 따라온다", cfg.새로생긴설정 === "무엇이든", cfg.새로생긴설정);

  //  오늘 막혀 있던 여섯을 이름으로 못 박는다
  console.log("\n③ 2026-09-22 에 막혀 있던 것들");
  ["도선료_통일금액", "합포장_최대건수_샘플", "합포장_품목낱말", "미발송_적요낱말", "도선료표_기준"]
    .forEach((k) => ok(k, cfg[k] !== undefined && cfg[k] !== "", String(cfg[k]).slice(0, 40)));
}

console.log("\n④ 기본값에 빈 구멍이 없다");
{
  const 빈것 = Object.keys(core.SS_DEFAULT_CONFIG)
    .filter((k) => core.SS_DEFAULT_CONFIG[k] === undefined);
  //  파일 위쪽에서 아래 var 를 참조하면 «호이스팅»으로 undefined 가 된다.
  //  고유ID_짧은날짜_전환일 이 실제로 그랬다 (2026-09-22 걷어냄).
  ok("★ undefined 인 기본값이 없다", 빈것.length === 0, 빈것.join(", "));
}

console.log("\n" + (fail ? "❌ " + fail + "개 실패" : "✅ 모두 통과") + " (통과 " + pass + ")");
process.exit(fail ? 1 : 0);
