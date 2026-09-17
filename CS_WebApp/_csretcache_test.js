/**
 * 반품대장 읽기 — «월 탭 하나를 한 번만» 읽는가
 *
 *  > "속도가 느려서 그래"
 *
 *  느렸던 까닭 둘을 각각 박아 둔다 —
 *    ① 한 번 띄울 때 같은 탭을 열한 번 읽었다 (열쇠에 days·activeOnly 가 있어서)
 *    ② 90일치가 100KB 를 넘겨 캐시 put 이 조용히 던졌고, 그래서 매번 다시 읽었다
 *
 *  그리고 빨라지느라 «목록이 달라지면» 안 된다 —
 *  옛 방식(읽으면서 거르기)과 새 방식(통째로 읽고 메모리에서 거르기)의
 *  결과가 같은지 나란히 견준다.
 *
 * 실행: node _csretcache_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + w + "\n         실제 " + g);
}

const src = fs.readFileSync("csOrderSearch.gs", "utf8");

/* ── 가짜 구글 서비스 ───────────────────────────────────── */
function 만들기(탭들, opt) {
  opt = opt || {};
  const 읽은탭 = [];          //  시트를 실제로 몇 번 읽었나
  const 캐시 = {};

  const CacheService = {
    getScriptCache: () => ({
      get: (k) => (캐시[k] === undefined ? null : 캐시[k]),
      getAll: (ks) => {
        const o = {};
        ks.forEach((k) => { if (캐시[k] !== undefined) o[k] = 캐시[k]; });
        return o;
      },
      put: (k, v) => {
        if (String(v).length > 100000) throw new Error("Argument too large: value");
        캐시[k] = v;
      },
      putAll: (m) => {
        for (const k in m) {
          //  ★ 실제 CacheService 처럼 «넘치면 던진다» ★
          if (String(m[k]).length > 100000) throw new Error("Argument too large: value");
        }
        for (const k in m) 캐시[k] = m[k];
      },
    }),
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: () => opt.gen || "7",
      setProperty: () => {},
    }),
  };

  const ss = {
    getSheetByName: (n) => (탭들[n] ? { __name: n } : null),
    getSheets: () => Object.keys(탭들).map((n) => ({ getName: () => n })),
  };
  const SpreadsheetApp = { openById: () => ss };

  const ctx = {
    CacheService, PropertiesService, SpreadsheetApp,
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = (n) => (n < 10 ? "0" : "") + n;
        const y = d.getFullYear(), m = p(d.getMonth() + 1), dd = p(d.getDate());
        return f === "yyyyMM" ? y + m : y + m + dd;
      },
    },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  //  탭 읽기를 가로채 «몇 번 읽었는지» 센다
  ctx._cs_readReturnLedgerTabCases_ = function (tab, tabName, cutoffYmd, activeOnly) {
    읽은탭.push(tabName);
    let rows = (탭들[tabName] || []).slice();
    if (cutoffYmd) rows = rows.filter((r) => !(r.dateYmd && r.dateYmd < cutoffYmd));
    if (activeOnly) rows = rows.filter((r) => r.active);
    return rows;
  };

  return { ctx, 읽은탭, 캐시 };
}

const 오늘 = new Date();
const 달키 = (뒤로) => {
  const d = new Date(오늘.getTime());
  d.setMonth(d.getMonth() - 뒤로);
  return d.getFullYear() + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1);
};
const 줄 = (id, ymd, active) =>
  ({ id: id, dateYmd: ymd, active: active, sortKey: ymd + "_" + id, tab: "", row: 1 });

const ymd = (뒤로) => {
  const d = new Date(오늘.getTime());
  d.setDate(d.getDate() - 뒤로);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate());
};

/* ── [1] 한 번 띄울 때 탭을 몇 번 읽나 ──────────────────── */
console.log("\n[1] 보드 한 번 띄울 때 — 같은 탭을 몇 번 읽는가");
{
  const 탭들 = {};
  탭들[달키(0)] = [줄("a", ymd(1), true), 줄("b", ymd(2), false)];
  탭들[달키(1)] = [줄("c", ymd(40), true)];
  탭들[달키(2)] = [줄("d", ymd(70), false)];
  탭들[달키(3)] = [줄("e", ymd(100), true)];
  탭들[달키(4)] = [줄("f", ymd(130), true)];

  const { ctx, 읽은탭 } = 만들기(탭들);
  //  화면이 부르는 그대로 — 진행목록 · 전체(접수셈) · 뱃지색인(90일)
  ctx._cs_loadReturnLedgerCases_(30, true, false);
  ctx._cs_loadReturnLedgerCases_(30, false, false);
  ctx._cs_loadReturnLedgerCases_(30, true, false);
  ctx._cs_loadReturnLedgerCases_(90, false, false);

  const 센것 = {};
  읽은탭.forEach((t) => { 센것[t] = (센것[t] || 0) + 1; });
  const 두번이상 = Object.keys(센것).filter((k) => 센것[k] > 1);
  ok("★ 어떤 탭도 두 번 읽지 않는다  (읽은 횟수 " + 읽은탭.length + "번)", 두번이상.length === 0);
  ok("★ 90일치가 보는 다섯 달만 읽는다", 읽은탭.length === 5);
}

/* ── [2] 새로고침이어도 한 실행에선 한 번 ───────────────── */
console.log("\n[2] 새로고침(refresh)으로 불러도");
{
  const 탭들 = {};
  탭들[달키(0)] = [줄("a", ymd(1), true)];
  탭들[달키(1)] = [];
  탭들[달키(2)] = [];
  const { ctx, 읽은탭 } = 만들기(탭들);
  ctx._cs_loadReturnLedgerCases_(30, true, true);
  ctx._cs_loadReturnLedgerCases_(30, false, true);
  ok("★ 새로고침이어도 탭마다 한 번", 읽은탭.length === 3);
}

/* ── [3] 캐시가 «정말» 먹는가 (100KB 를 넘겨도) ─────────── */
console.log("\n[3] 90일치가 100KB 를 넘을 때");
{
  const 큰탭 = [];
  //  한 줄에 긴 한글 메모를 달아 통째로는 100KB 를 훌쩍 넘게 만든다
  for (let i = 0; i < 400; i++) {
    const r = 줄("r" + i, ymd(3), true);
    r.notice = "고객이 남긴 긴 메모입니다 ".repeat(12);
    큰탭.push(r);
  }
  const 탭들 = {};
  탭들[달키(0)] = 큰탭;
  탭들[달키(1)] = [];
  탭들[달키(2)] = [];

  const { ctx, 읽은탭, 캐시 } = 만들기(탭들);
  const 첫판 = ctx._cs_loadReturnLedgerCases_(30, true, false);
  const 통째크기 = JSON.stringify(큰탭).length;
  ok("(표본이 100KB 를 넘는다 — " + 통째크기 + "자)", 통째크기 > 100000);
  ok("★ 조각으로 나뉘어 들어갔다", 캐시[Object.keys(캐시).find((k) => k.indexOf("_n") > 0)] !== undefined);

  //  두 번째 실행 — 새 전역(기억)으로 시작해도 캐시가 받쳐 줘야 한다
  const 번째 = 만들기(탭들);
  번째.ctx.CacheService = ctx.CacheService;          //  같은 캐시를 물려준다
  vm.runInContext("CacheService = __c;", Object.assign(번째.ctx, { __c: ctx.CacheService }));
  const 둘째판 = 번째.ctx._cs_loadReturnLedgerCases_(30, true, false);

  ok("★ 두 번째에는 시트를 «안» 읽는다  (읽은 " + 번째.읽은탭.length + "번)", 번째.읽은탭.length === 0);
  eq("★ 캐시에서 온 것이 같은 건수", 둘째판.length, 첫판.length);
  eq("  내용도 같다", 둘째판[0].id, 첫판[0].id);
}

/* ── [4] 조각 하나가 말라 죽으면 통째로 버린다 ──────────── */
console.log("\n[4] 캐시 조각 하나가 사라졌을 때");
{
  const 탭들 = {};
  const 큰탭 = [];
  for (let i = 0; i < 400; i++) {
    const r = 줄("r" + i, ymd(3), true);
    r.notice = "긴 메모 ".repeat(30);
    큰탭.push(r);
  }
  탭들[달키(0)] = 큰탭; 탭들[달키(1)] = []; 탭들[달키(2)] = [];

  const { ctx, 캐시 } = 만들기(탭들);
  ctx._cs_loadReturnLedgerCases_(30, true, false);

  //  조각 하나만 지운다 (실제로 조각마다 따로 만료될 수 있다)
  const 조각들 = Object.keys(캐시).filter((k) => /_[0-9]+$/.test(k) && k.indexOf("_n") < 0);
  ok("(조각이 둘 이상이다 — " + 조각들.length + "개)", 조각들.length > 1);
  delete 캐시[조각들[1]];

  const cache = ctx.CacheService.getScriptCache();
  const key = 조각들[0].replace(/_[0-9]+$/, "");
  eq("★ 반쪽을 주지 않는다 (null)", ctx._cs_retCacheGet_(cache, key), null);
}

/* ── [5] 빨라지느라 «목록이 달라지면» 안 된다 ───────────── */
console.log("\n[5] 옛 방식과 결과가 같은가");
{
  const 탭들 = {};
  탭들[달키(0)] = [
    줄("a", ymd(0), true), 줄("b", ymd(5), false), 줄("c", ymd(10), true),
  ];
  탭들[달키(1)] = [줄("d", ymd(29), true), 줄("e", ymd(31), true)];
  탭들[달키(2)] = [줄("f", ymd(60), false)];
  탭들[달키(3)] = [줄("g", ymd(95), true)];
  탭들[달키(4)] = [줄("h", ymd(120), true)];

  const { ctx } = 만들기(탭들);

  //  옛 방식 — 읽으면서 거른다
  function 옛방식(days, activeOnly) {
    const cut = ctx._cs_daysAgoYmd_(days);
    const 달 = ctx._cs_returnLedgerMonthsToScan_(days);
    let out = [];
    달.forEach((mk) => {
      (탭들[mk] || []).forEach((r) => {
        if (cut && r.dateYmd && r.dateYmd < cut) return;
        if (activeOnly && !r.active) return;
        out.push(r);
      });
    });
    out.sort((a, b) => String(b.sortKey || "").localeCompare(String(a.sortKey || "")));
    return out.map((r) => r.id);
  }
  const 새방식 = (d, a) => ctx._cs_loadReturnLedgerCases_(d, a, false).map((r) => r.id);

  eq("★ 30일 · 진행만", 새방식(30, true), 옛방식(30, true));
  eq("★ 30일 · 전부", 새방식(30, false), 옛방식(30, false));
  eq("★ 90일 · 전부", 새방식(90, false), 옛방식(90, false));
  eq("★ 60일 · 진행만 (스캔이 쓰는 값)", 새방식(60, true), 옛방식(60, true));
  ok("★ 30일에 31일 전 것이 안 들어온다", 새방식(30, false).indexOf("e") < 0);
  ok("★ 90일에는 들어온다", 새방식(90, false).indexOf("e") >= 0);
}

/* ── [6] 세대 번호가 올라가면 다시 읽는다 ───────────────── */
console.log("\n[6] 접수가 생겨 세대 번호가 올라가면");
{
  const 탭들 = {};
  탭들[달키(0)] = [줄("a", ymd(1), true)];
  탭들[달키(1)] = []; 탭들[달키(2)] = [];

  const 첫 = 만들기(탭들, { gen: "7" });
  첫.ctx._cs_loadReturnLedgerCases_(30, true, false);
  const 읽은수 = 첫.읽은탭.length;

  const 다음 = 만들기(탭들, { gen: "8" });
  //  캐시는 그대로 물려주되 세대만 올린다
  vm.runInContext("CacheService = __c;", Object.assign(다음.ctx, { __c: 첫.ctx.CacheService }));
  다음.ctx._cs_loadReturnLedgerCases_(30, true, false);

  ok("(첫 실행은 읽는다 — " + 읽은수 + "번)", 읽은수 === 3);
  ok("★ 세대가 바뀌면 옛 캐시를 안 쓴다", 다음.읽은탭.length === 3);
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
