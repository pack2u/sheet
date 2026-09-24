/**
 * ══════════════════════════════════════════════════════════════
 *  협력업체 반품 포털 배포 — «쓰던 주소 그대로»
 *  파일: Partner_WebApp/_prpdeploy.mjs
 *
 *  쓰는 법:  node _prpdeploy.mjs "한 줄 설명"
 *
 *  ★ 왜 스크립트로 하나 ★  (2026-09-16)
 *    `clasp deploy` 를 그냥 치면 «새 주소»가 생긴다. 업체가 즐겨찾기에
 *    넣어 둔 주소는 옛 배포본 그대로라 아무것도 안 바뀐다.
 *    실제로 그랬다 — 다 고쳐 올려 놓고 「똑같은데」라는 말을 들었다.
 *
 *    쓰던 주소에 덮어쓰려면 `-i <배포ID>` 가 있어야 하는데, 그 ID 를
 *    사람이 외울 수는 없다. 도구가 찾아서 쓴다.
 *
 *  ★ @HEAD 는 건드리지 않는다 ★
 *    @HEAD 는 편집기에서 「테스트 배포」로 쓰는 자리다. 여기에 덮어쓰면
 *    테스트와 실사용이 한 몸이 된다.
 *
 *  ★ 배포가 둘 이상이면 멈춘다 ★
 *    어느 것이 업체가 쓰는 주소인지 기계가 고를 수 없다. 골라 달라고 한다.
 *    조용히 아무거나 고르면 또 「똑같은데」가 된다.
 * ══════════════════════════════════════════════════════════════
 */
import { execFileSync } from "node:child_process";

const 설명 = (process.argv[2] || "반품 포털 갱신").trim();

function 실행(args) {
  return execFileSync("npx", ["clasp", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/* ── 1) 지금 있는 배포를 읽는다 ───────────────────────── */
let 목록;
try {
  목록 = 실행(["deployments"]);
} catch (e) {
  console.error("배포 목록을 못 읽었습니다 — " + (e.stdout || e.message));
  process.exit(1);
}

const 줄들 = 목록.split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.startsWith("- "));

/*  「- <ID> @<버전> - <설명>」 꼴. @HEAD 는 테스트 자리라 뺀다.  */
const 실배포 = [];
for (const l of 줄들) {
  const m = l.match(/^- (\S+) @(\S+)/);
  if (!m) continue;
  if (m[2] === "HEAD") continue;
  실배포.push({ id: m[1], ver: m[2], raw: l });
}

if (실배포.length === 0) {
  console.error("실사용 배포가 없습니다. 처음이라면 편집기에서 «새 배포»를 한 번 만드세요.");
  process.exit(1);
}
if (실배포.length > 1) {
  console.error("★ 배포가 " + 실배포.length + "개입니다 — 어느 것이 업체가 쓰는 주소인지 고를 수 없습니다.");
  실배포.forEach((d) => console.error("   " + d.raw));
  console.error("\n안 쓰는 것을 지운 뒤 다시 실행하세요:  npx clasp undeploy <ID>");
  process.exit(1);
}

const 대상 = 실배포[0];
console.log("배포 대상  " + 대상.id + "  (현재 @" + 대상.ver + ")");

/* ── 2) 밀어 넣고 ─────────────────────────────────────── */
try {
  const out = 실행(["push", "-f"]);
  const n = (out.match(/Pushed (\d+) files/) || [])[1];
  console.log("push " + (n ? n + "개 파일" : "완료"));
} catch (e) {
  console.error("push 실패 — " + (e.stdout || e.message));
  process.exit(1);
}

/* ── 3) «같은 주소»에 덮어쓴다 ────────────────────────── */
let 결과;
try {
  결과 = 실행(["deploy", "-i", 대상.id, "-d", JSON.stringify(설명)]);
} catch (e) {
  console.error("deploy 실패 — " + (e.stdout || e.message));
  process.exit(1);
}
const 새버전 = (결과.match(/@(\S+)\s*$/m) || [])[1] || "?";
console.log(결과.trim());

/* ── 4) 진짜 그 주소가 올라갔는지 확인한다 ────────────── */
const 다시 = 실행(["deployments"]);
const 맞나 = 다시.split(/\r?\n/).some((l) =>
  l.includes(대상.id) && !l.includes("@HEAD"));
if (!맞나) {
  console.error("★ 확인 실패 — 그 주소가 목록에 없습니다. 손으로 봐 주세요.");
  process.exit(1);
}
console.log("\n✅ 쓰던 주소 그대로 @" + 새버전 + " 로 올라갔습니다.");
console.log("   업체는 즐겨찾기를 안 바꿔도 됩니다. 새로고침만 하면 됩니다.");
