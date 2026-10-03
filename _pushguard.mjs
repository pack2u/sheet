/**
 * ══════════════════════════════════════════════════════════════
 *  푸시 전 견주기 — «서버에만 있는 것»을 지우지 않게
 *  파일: _pushguard.mjs   (배포 스크립트들이 불러 쓴다)
 *
 *  ★ 왜 ★  (2026-10-04)
 *    clasp push 는 «로컬에 있는 것만 올린다»가 아니라 로컬 파일 목록으로
 *    서버를 동기화한다. 로컬에 없는 파일은 서버에서 지워진다.
 *
 *    2026-09-08 에 그렇게 37개를 날렸다. 2026-10-04 에 또 그럴 뻔했다 —
 *    평택에서 편집기로 만든 파일 5개(csDeposit·csInquiry·csReturnUid·
 *    csAddReturnCols·csRebuildOct)가 저장소에 없었고, home.html 은 서버가
 *    131KB 앞서 있었다. 그때는 손으로 견주어 막았다.
 *    손으로 막은 것은 다음에 또 안 막는다. 도구가 막아야 한다.
 *
 *  ★ 두 가지를 본다 ★
 *    ① 지워질 것이 있나          서버에 있고 로컬에 없는 파일 → 멈춘다
 *    ② 서버가 git 밖으로 갔나    서버 내용이 git HEAD 와 다른 파일 → 멈춘다
 *
 *    ②가 핵심이다. 로컬이 HEAD 보다 앞선 것은 «고친 것»이니 당연하다.
 *    하지만 «서버»가 HEAD 와 다르면 누가 편집기에서 고치고 커밋을 안 한 것이다.
 *    그걸 모르고 밀면 그 작업이 사라진다. 먼저 되찾아 커밋해야 한다.
 *
 *  ★ 줄끝은 뜻이 아니다 ★
 *    편집기에서 내려오는 것은 LF, 저장소는 CRLF 다. CR 을 벗기고 견준다.
 *    안 그러면 매번 「전부 다르다」가 되어 아무도 이 검문을 안 쓴다.
 *
 *  쓰는 법
 *    import { 견주기 } from "../_pushguard.mjs";
 *    견주기();            // 어긋나면 그 자리에서 멈춘다(throw)
 *    견주기({ 그냥: true });  // 보여만 주고 안 멈춘다
 * ══════════════════════════════════════════════════════════════
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, extname } from "node:path";

const CR = String.fromCharCode(13);
const 벗기 = (s) => s.split(CR).join("");

/** GAS 는 .gs/.js 를 같은 파일로 본다 — 이름만 견준다 */
const 이름만 = (f) => basename(f, extname(f));

function 달려(args, 어디) {
  return execFileSync("npx", ["clasp", ...args], {
    cwd: 어디, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"],
  });
}

/** 지금 폴더가 clasp 로 올릴 파일들 (무시 목록을 뺀 것) */
function 올릴것(어디) {
  const out = 달려(["status"], 어디);
  const 줄 = out.split(/\r?\n/);
  const 끝 = 줄.findIndex((l) => /Untracked/i.test(l));
  return 줄.slice(0, 끝 < 0 ? 줄.length : 끝)
    .filter((l) => l.indexOf("└─") >= 0)
    .map((l) => l.slice(l.indexOf("└─") + 2).trim())
    .filter(Boolean);
}

export function 견주기({ 그냥 = false } = {}) {
  const 어디 = process.cwd();
  const 집 = mkdtempSync(join(tmpdir(), "pushguard-"));
  try {
    writeFileSync(join(집, ".clasp.json"), readFileSync(join(어디, ".clasp.json")));
    달려(["pull"], 집);

    const 서버 = readdirSync(집).filter((f) => f !== ".clasp.json");
    const 로컬 = 올릴것(어디);
    const 로컬이름 = new Set(로컬.map(이름만));

    /* ① 지워질 것 */
    const 지워질것 = 서버.filter((f) => !로컬이름.has(이름만(f)));

    /* ② 서버가 git 밖으로 간 것 */
    const 밖으로 = [];
    for (const f of 서버) {
      const 짝 = 로컬.find((l) => 이름만(l) === 이름만(f));
      if (!짝) continue;
      let 커밋된;
      try {
        /*  stderr 를 받아 둔다 — 무시 목록의 _secrets.gs 는 HEAD 에 없고,
            그때 git 이 fatal 한 줄을 뱉는다. 예상된 경우를 사람에게
            오류처럼 보여 주면 정작 멈춰야 할 때의 말이 묻힌다. */
        커밋된 = execFileSync("git", ["show", "HEAD:./" + 짝], {
          cwd: 어디, encoding: "buffer", maxBuffer: 1 << 28,
          stdio: ["ignore", "pipe", "pipe"],
        }).toString("utf8");
      } catch { continue; }          //  git 이 모르는 파일(무시 목록 등)은 넘긴다
      const 서버내용 = readFileSync(join(집, f), "utf8");
      if (벗기(서버내용) !== 벗기(커밋된)) 밖으로.push(짝);
    }

    /*  서버에 없는 로컬 파일은 «새로 올라간다». 지우는 것이 아니라 막지는
        않지만, 모르고 올리면 1회용 손질 함수가 서버에 남는다. 말은 해 준다. */
    const 서버이름 = new Set(서버.map(이름만));
    const 새로올라갈것 = 로컬.filter((l) => !서버이름.has(이름만(l)));

    if (!지워질것.length && !밖으로.length) {
      console.log(`견주기 통과 — 서버 ${서버.length}개 · 올릴 것 ${로컬.length}개`);
      if (새로올라갈것.length) {
        console.log("  (서버에 없던 것 " + 새로올라갈것.length + "개가 새로 올라갑니다: " +
          새로올라갈것.join(", ") + ")");
      }
      return { ok: true, 지워질것, 밖으로, 새로올라갈것 };
    }

    console.log("");
    console.log("━".repeat(60));
    console.log("★ 멈춥니다 — 푸시하면 서버 작업이 사라집니다");
    console.log("━".repeat(60));
    if (지워질것.length) {
      console.log("\n[1] 서버에만 있는 파일 — 푸시하면 «지워집니다»");
      지워질것.forEach((f) => console.log("    · " + f));
    }
    if (밖으로.length) {
      console.log("\n[2] 서버가 커밋된 것과 다릅니다 — 편집기에서 고치고 커밋을 안 한 것입니다");
      밖으로.forEach((f) => console.log("    · " + f));
    }
    console.log("\n  먼저 되찾아 커밋하세요:");
    console.log("    npx clasp pull        (임시 폴더에 받아 견주고 옮기는 쪽이 안전합니다)");
    console.log("    git add -A && git commit");
    console.log("  그 다음에 다시 배포하세요.\n");

    if (그냥) return { ok: false, 지워질것, 밖으로 };
    throw new Error("푸시 전 견주기 실패 — 서버에 저장소로 안 돌아온 작업이 있습니다");
  } finally {
    try { if (existsSync(집)) rmSync(집, { recursive: true, force: true }); } catch {}
  }
}
