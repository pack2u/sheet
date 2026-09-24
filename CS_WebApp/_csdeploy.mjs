/**
 * ══════════════════════════════════════════════════════════════
 *  CS웹앱 배포 — 빌드 번호를 «사람이 기억하지 않는다»
 *  2026-09-16
 *
 *  > "올린건가? 새버전 안내가 안뜨네"
 *
 *  ★ 무엇이 어긋났나 ★
 *    csPulse.gs 의 CS_BUILD_ 는 열어 둔 화면에게 「새 버전이 나왔다」고
 *    알리는 값이다. 코드에 「재배포할 때마다 올린다」고 적혀 있는데,
 *    2026-09-16 에 259·260 을 올리면서 «두 번 다» 안 올렸다.
 *    팀은 옛 화면을 쓰면서 고쳐진 줄 알았다.
 *
 *    적어 두는 것으로는 안 된다 — 적어 둔 그 자리에서 두 번 틀렸다.
 *
 *  ★ 차례가 중요하다 ★
 *    지금 배포판이 @N 이면 다음 배포는 @N+1 이 된다. 그러니
 *      ① clasp deployments 로 N 을 읽고
 *      ② CS_BUILD_ 를 N+1 로 고쳐 넣고
 *      ③ push 한 다음
 *      ④ deploy
 *    해야 번호와 값이 «같아진다». 먼저 배포하고 나중에 고치면 늘 하나 어긋난다.
 *
 *  실행:  node _csdeploy.mjs "한 줄 설명"
 * ══════════════════════════════════════════════════════════════
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const 설명 = process.argv.slice(2).join(" ").trim() || "CS웹앱 갱신";

function 달려(args) {
  return execFileSync("clasp", args, { encoding: "utf8", shell: true });
}

/* ── ① 지금 배포판 번호 ── */
const 목록 = 달려(["deployments"]);
const 번호들 = [...목록.matchAll(/@(\d+)/g)].map((m) => Number(m[1]));
if (!번호들.length) {
  console.error("배포 목록에서 번호를 못 읽었습니다:\n" + 목록);
  process.exit(1);
}
const 지금 = Math.max(...번호들);

/* ── ①-2 다음 «버전» 번호 ──  (2026-09-24)
   다음 번호는 «배포 번호 + 1» 이 아니다. deploy 는 서버의 「마지막 버전」
   다음을 찍는다. 그래서 배포하지 않은 버전이 하나라도 남아 있으면 둘이
   어긋나고, CS_BUILD_ 가 실제 배포 번호보다 작아진다 — 그러면 열어 둔
   화면에 「새 버전」 안내가 끝까지 안 뜬다.

   2026-09-24 에 실제로 그랬다: 배포는 @306 인데 서버에는 쓰지 않은 307 이
   남아 있어, 다음 배포가 308 로 찍히는데 스크립트는 307 을 적으려 했다.
   편집기에서 「버전 저장」만 눌러도 같은 일이 생긴다.

   버전은 지울 수 없으니, 배포 번호를 믿지 않고 버전 목록에서 최댓값을 읽는다. */
const 버전목록 = 달려(["list-versions"]);
const 버전들 = [...버전목록.matchAll(/^\s*(\d+)\s*-/gm)].map((m) => Number(m[1]));
if (!버전들.length) {
  console.error("버전 목록에서 번호를 못 읽었습니다:\n" + 버전목록);
  process.exit(1);
}
const 마지막버전 = Math.max(...버전들);
const 다음 = 마지막버전 + 1;

if (마지막버전 !== 지금) {
  console.log(
    "알림 — 배포는 @" + 지금 + " 인데 서버 마지막 버전은 " + 마지막버전 +
    " 입니다 (쓰지 않은 버전이 있다). 다음 배포는 @" + 다음 + " 로 찍힙니다."
  );
}

/* 고칠 배포 id — @HEAD 가 아닌 «번호 붙은» 쪽이 팀이 쓰는 주소다 */
const idLine = 목록.split(/\r?\n/).find((l) => /@\d+/.test(l));
const depId = (idLine.match(/-\s*(\S+)\s+@/) || [])[1];
if (!depId) {
  console.error("배포 id 를 못 읽었습니다:\n" + 목록);
  process.exit(1);
}

/* ── ② 빌드 번호를 다음 것으로 ── */
const p = "csPulse.gs";
const before = readFileSync(p, "utf8");
const m = before.match(/var CS_BUILD_ = "(\d+)";/);
if (!m) {
  console.error("csPulse.gs 에서 CS_BUILD_ 를 못 찾았습니다");
  process.exit(1);
}
if (m[1] === String(다음)) {
  console.log("CS_BUILD_ 가 이미 " + 다음 + " 입니다 — 그대로 둡니다");
} else {
  writeFileSync(p, before.replace(m[0], 'var CS_BUILD_ = "' + 다음 + '";'));
  console.log("CS_BUILD_  " + m[1] + " → " + 다음);
}

/* ── ③ push ── */
console.log(달려(["push", "-f"]).split(/\r?\n/).slice(-2).join("\n"));

/* ── ④ deploy ── */
const 결과 = 달려(["deploy", "-i", depId, "-d", JSON.stringify(설명)]);
console.log(결과.trim());

const 찍힘 = (결과.match(/@(\d+)/) || [])[1];
if (String(찍힘) !== String(다음)) {
  console.error("");
  console.error("★ 번호가 어긋났습니다 — CS_BUILD_=" + 다음 + " 인데 배포는 @" + 찍힘 + " 입니다.");
  console.error("   csPulse.gs 를 @" + 찍힘 + " 로 고치고 한 번 더 배포하세요.");
  process.exit(1);
}
console.log("");
console.log("✅ 배포 @" + 찍힘 + " · CS_BUILD_ " + 다음 + " — 열어 둔 화면에 새 버전 안내가 뜹니다");
