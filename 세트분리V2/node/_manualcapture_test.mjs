import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
//  어느 폴더에서 돌려도 같게 — 제 위치를 기준으로 찾는다
const HERE = path.dirname(fileURLToPath(import.meta.url));
import vm from "node:vm";
const SRC = readFileSync(path.join(HERE, "..", "gasMasters.js"), "utf8");
const at = SRC.indexOf("      var 원줄 = null, 코드그대로 = false");
const MARK = "if (이름 && !이름그대로) 새이름 = 이름;";
const end = SRC.indexOf(MARK, at);
if (at < 0 || end < 0) { console.log("FAIL 고친 자리를 못 찾음"); process.exit(1); }
const 조각 = SRC.slice(at, end + MARK.length);

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  if (String(g) === String(w)) { pass++; console.log("  ok   " + l); return; }
  fail++; console.log("  FAIL " + l + "\n         기대 " + w + "\n         실제 " + g);
};

/*  고친 조각을 그대로 돌려 본다 — 같은 원본을 가진 줄이 둘일 때 */
function 담기(code, 이름, LL) {
  const ctx = { ssText: (v) => String(v == null ? "" : v).trim(), console,
    적힌원본: "JHMINIJJIMB00002", code, 이름, byUid: { U1: LL }, uid: "U1",
    새코드: "", 새이름: "" };
  vm.createContext(ctx);
  vm.runInContext(조각.replace(/byUid\[uid\]/g, "byUid[uid]"), ctx);
  return { 새코드: ctx.새코드, 새이름: ctx.새이름 };
}

const 원장 = [
  { 원본: "JHMINIJJIMB00002", 코드: "JHMINIJJIMB90002", 이름: "몸통" },
  { 원본: "JHMINIJJIMB00002", 코드: "JHMINIJJIM90005", 이름: "뚜껑" },
];

console.log("\n[담을 때] 세트가 쪼개진 주문");
{
  /*  ★ 9/17 사고의 뿌리 ★ 뚜껑 줄을 조치했을 뿐인데, 첫 줄(몸통)과
      견주는 바람에 「코드를 고쳤다」고 잘못 봤다.  */
  const r = 담기("JHMINIJJIM90005", "뚜껑", 원장);
  eq("★ 뚜껑 줄을 손대면 «안 고친 것»으로 본다", r.새코드, "");
  eq("  이름도 그대로", r.새이름, "");

  const r2 = 담기("JHMINIJJIMB90002", "몸통", 원장);
  eq("★ 몸통 줄도 마찬가지", r2.새코드, "");

  //  진짜로 고쳤을 때는 잡아야 한다
  const r3 = 담기("ZZZ999", "딴것", 원장);
  eq("진짜 고친 코드는 잡는다", r3.새코드, "ZZZ999");

  //  이름만 고친 경우
  const r4 = 담기("JHMINIJJIM90005", "뚜껑(새이름)", 원장);
  eq("이름만 고치면 이름만 잡는다", r4.새코드, "");
  eq("  새이름은 잡힌다", r4.새이름, "뚜껑(새이름)");
}

console.log("");
console.log(fail ? "FAIL " + fail + "건" : "통과 " + pass + "건");
process.exit(fail ? 1 : 0);
