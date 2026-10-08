/**
 * ══════════════════════════════════════════════════════════════
 *  즐겨찾기 — 협력업체 시트 «전체» 는 드라이브에서 온다
 *  2026-10-08
 *
 *  > "우리 상단에 북마크에 협력업체 시트 전체를 넣어주면 좋겠어"
 *
 *  ★ 왜 자동이어야 하나 ★
 *    코드 기본 목록의 「협력업체 시트」는 크롬 북마크바에서 «손으로» 베껴 온
 *    것이고, 그 자리에 이렇게 적혀 있다 —
 *      「원본이 바뀌면 여기도 손대야 한다. 자동으로 따라오지 않는다」
 *    업체는 늘고 줄고 이름도 바뀐다. 사람이 그때마다 옮겨 적는 일은
 *    반드시 빠뜨린다. 그래서 허브가 보는 바로 그 드라이브 폴더를 본다.
 *
 *  ★ 이 시험이 지키는 것 ★
 *    · 드라이브를 못 읽어도 «바가 통째로 죽지 않는다» (조용히 넘어간다)
 *    · 손으로 묶은 갈래(대리공급·대리판매·직매입)를 안 지운다
 *    · 두 번 불러도 「전체」가 두 개가 되지 않는다
 *    · 허브와 «같은 폴더»를 본다 — 어긋나면 미는 곳과 여는 곳이 갈린다
 *
 *  실행: node CS_WebApp/_csfavall_test.js
 * ══════════════════════════════════════════════════════════════
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "csFavorites.gs"), "utf8");
const DEPLOY = fs.readFileSync(
  path.join(__dirname, "..", "_partnerDeploy.gs"), "utf8");

let 잰것 = 0, 틀린것 = 0;
function ok(이름, 참인가, 덧붙임) {
  잰것++;
  if (참인가) { console.log("  ok   " + 이름); return; }
  틀린것++;
  console.log("  FAIL " + 이름 + (덧붙임 ? "\n         " + 덧붙임 : ""));
}
function eq(이름, 얻은, 바란) {
  ok(이름 + "  →  " + JSON.stringify(얻은),
    JSON.stringify(얻은) === JSON.stringify(바란),
    "기대 " + JSON.stringify(바란));
}

/** 드라이브·캐시를 흉내 낸 판을 하나 짓는다 */
function 판(파일들, opt) {
  opt = opt || {};
  const 담김 = {};
  const 파일만들기 = (nm, id) => ({ getName: () => nm, getId: () => id });
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Logger: { log: () => {} },
    _cs_ac_guard_: () => null,
    JSON, String, console,
    CacheService: opt.캐시없음 ? undefined : {
      getScriptCache: () => ({
        get: (k) => (담김[k] === undefined ? null : 담김[k]),
        put: (k, v) => { 담김[k] = v; },
      }),
    },
    DriveApp: opt.드라이브없음 ? undefined : {
      getFolderById: (fid) => {
        if (opt.터지는폴더 === fid) throw new Error("권한 없음");
        const list = (파일들[fid] || []).map((x) => 파일만들기(x[0], x[1]));
        let i = 0;
        return { getFiles: () => ({ hasNext: () => i < list.length, next: () => list[i++] }) };
      },
    },
  };
  if (opt.드라이브없음) delete ctx.DriveApp;
  if (opt.캐시없음) delete ctx.CacheService;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.__담김 = 담김;
  return ctx;
}

const 폴더A = "1IqqPLKxBNrqh-u14Op6jKNN7khzE13Cl";
const 폴더B = "1J0f8HjtartQwixF3xKQf0p7fvr04Ef7v";
const 샘플 = {
  [폴더A]: [["[협력업체] 당장드림", "SS_DJ"], ["[협력업체]_올팩", "SS_OP"],
            ["거래명세표 모음", "SS_NOPE"]],
  [폴더B]: [["[협력업체] 지니팩", "SS_JN"], ["[협력업체] 당장드림", "SS_DJ"]],
};

/* ── [1] 드라이브에서 모은다 ─────────────────────────────── */
console.log("\n[1] 드라이브를 훑어 모은다");
{
  const c = 판(샘플);
  const 것들 = vm.runInContext("_cs_fav_partnerSheets_()", c);
  eq("★ 세 곳 (중복 하나는 걸러짐)", 것들.length, 3);
  eq("  이름순", 것들.map((x) => x.name), ["당장드림", "올팩", "지니팩"]);
  ok("★ 「[협력업체]」가 아닌 파일은 안 담는다",
    !것들.some((x) => /거래명세표/.test(x.name)));
  ok("  「[협력업체]_」 밑줄 변형도 알아본다",
    것들.some((x) => x.name === "올팩"), "밑줄까지 떼어야 이름이 된다");
  ok("★ 주소는 그 시트로 간다",
    것들.every((x) => /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(x.url)));
}

/* ── [2] 못 읽어도 바가 안 죽는다 ───────────────────────── */
console.log("\n[2] ★ 못 읽어도 바가 통째로 죽지 않는다 ★");
{
  //  시험처럼 GAS 밖에서 돌 때 — DriveApp 이 아예 없다
  const c = 판(샘플, { 드라이브없음: true });
  eq("드라이브가 없으면 빈 배열", vm.runInContext("_cs_fav_partnerSheets_()", c).length, 0);
  const 목록 = vm.runInContext("csGetFavorites()", c).items;
  ok("★ 그래도 즐겨찾기는 나온다", 목록.length > 0,
    "전체 폴더가 없는 편이 바가 사라지는 것보다 낫다");
  ok("  「전체 (자동」 칸은 안 생긴다",
    !JSON.stringify(목록).includes("전체 (자동"));
}
{
  //  한 폴더만 권한이 없을 때 — 반쪽이라도 가져온다
  const c = 판(샘플, { 터지는폴더: 폴더B });
  const 것들 = vm.runInContext("_cs_fav_partnerSheets_()", c);
  eq("★ 한 폴더가 막혀도 다른 폴더는 본다", 것들.map((x) => x.name), ["당장드림", "올팩"]);
}
{
  //  캐시가 없는 판에서도 돈다
  const c = 판(샘플, { 캐시없음: true });
  eq("캐시가 없어도 모은다", vm.runInContext("_cs_fav_partnerSheets_()", c).length, 3);
}

/* ── [3] 손으로 묶은 갈래를 안 지운다 ───────────────────── */
console.log("\n[3] 사람이 정한 갈래는 그대로 둔다");
{
  const c = 판(샘플);
  const 목록 = vm.runInContext("csGetFavorites()", c).items;
  const 협력 = 목록.filter((x) => x.children && String(x.name).indexOf("협력업체") >= 0);
  eq("★ 「협력업체 시트」 폴더는 하나뿐", 협력.length, 1);

  const 이름들 = 협력[0].children.map((x) => x.name);
  eq("★ 「전체」가 맨 앞", 이름들[0], "전체 (자동 · 3곳)");
  ["대리공급업체", "대리판매업체", "직매입"].forEach(function (g) {
    ok("  손으로 묶은 「" + g + "」가 살아 있다", 이름들.indexOf(g) > 0);
  });
  const 전체 = 협력[0].children[0];
  eq("  전체 안에 세 곳", 전체.children.length, 3);
}

/* ── [4] 두 번 불러도 하나다 ────────────────────────────── */
console.log("\n[4] ★ 두 번 불러도 「전체」가 둘이 되지 않는다 ★");
{
  //  csGetFavorites 는 화면이 뜰 때마다 불린다. 누적되면 폴더가 쌓인다.
  const c = 판(샘플);
  vm.runInContext("csGetFavorites()", c);
  const 목록 = vm.runInContext("csGetFavorites()", c).items;
  const 협력 = 목록.filter((x) => x.children && String(x.name).indexOf("협력업체") >= 0)[0];
  const 전체칸 = 협력.children.filter((x) => String(x.name).indexOf("전체 (자동") === 0);
  eq("★ 전체 칸은 한 개", 전체칸.length, 1);
}

/* ── [5] 허브와 «같은 폴더»를 보는가 ────────────────────── */
console.log("\n[5] 한 값에 주인은 하나 — 허브와 같은 폴더");
{
  /*  허브(_partnerDeploy.gs _pt_listFiles)가 미는 곳과 사장님이 여는 곳이
      어긋나면, 미는데 안 보이는 시트가 생긴다.                        */
  [폴더A, 폴더B].forEach(function (fid) {
    ok("  허브도 이 폴더를 본다 — " + fid.slice(0, 8) + "…",
      DEPLOY.indexOf(fid) >= 0,
      "허브 폴더가 바뀌면 여기도 같이 바꿔야 한다");
  });
  ok("★ 즐겨찾기도 그 둘만 본다",
    (SRC.match(/_CS_FAV_PARTNER_FOLDERS_ = \[[^\]]*\]/) || [""])[0]
      .split('"').filter((s) => /^[A-Za-z0-9_-]{20,}$/.test(s)).length === 2);
}

/* ── [6] 느리면 안 된다 ─────────────────────────────────── */
console.log("\n[6] 화면이 뜰 때마다 드라이브를 훑지 않는다");
{
  const c = 판(샘플);
  vm.runInContext("csGetFavorites()", c);
  const 담긴 = c.__담김["CS_FAV_PARTNER_ALL_V1"];
  ok("★ 캐시에 담는다", !!담긴);
  ok("  담은 것이 그 목록이다", !!담긴 && JSON.parse(담긴).length === 3);
  ok("  여섯 시간쯤 담아 둔다", /_CS_FAV_PARTNER_TTL_ = 21600/.test(SRC));
}

console.log("");
console.log(틀린것 ? "실패 " + 틀린것 + "건 / 통과 " + (잰것 - 틀린것)
                  : "모두 통과 (" + 잰것 + "건)");
process.exit(틀린것 ? 1 : 0);
