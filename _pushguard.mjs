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
 *    ② 서버가 git «역사 밖»인가  서버 내용이 어느 커밋에도 없으면 → 멈춘다
 *
 *  ★ ②를 「HEAD 와 같은가」로 물으면 안 된다 ★  (2026-10-04 에 그렇게 썼다가 고쳤다)
 *    배포는 «고친 것을 올리는 일»이다. 그러니 배포 직전에는 서버가 HEAD 보다
 *    뒤처진 것이 당연하다. 그걸 멈추면 정상 배포가 전부 막히고, 그러면 사람은
 *    검문을 끄거나 우회한다 — 안 막는 검문보다 그게 나쁘다.
 *
 *    물어야 할 것은 «서버에 있는 그 내용이 우리 역사 안에 있나»다.
 *    있으면 어느 시점에 커밋된 것을 배포해 둔 것이니 밀어도 잃는 게 없다.
 *    없으면 누가 편집기에서 고치고 커밋을 안 한 것이다 — 그때 멈춘다.
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
const SEP2 = String.fromCharCode(10) + "[2] ";
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

    /*  ★★ 빈손으로 왔으면 «멈춘다» ★★  (2026-10-06)

        clasp 가 오류 없이 파일을 하나도 안 주는 일이 있다(로그인이
        만료돼 invalid_rapt 가 난 뒤 같은 때). 그러면 서버 목록이 비고,
        아래 ①②가 둘 다 「없음」이 되어 문이 «무사 통과»를 외친다 —
        서버에 무엇이 있는지 한 번도 안 본 채로.

        2026-10-05 에 실제로 그랬다. 여덟 프로젝트를 당겼는데 모두 빈
        폴더였고, 「서버와 같습니다」라고 사장님께 말했다. 사실은 서버에
        일산에서 한 작업이 가득 있었다.

        「아무것도 못 봤다」와 「같다」는 다른 일이다. 모르면 멈춘다.    */
    if (서버.length === 0 || 서버.length * 2 < 로컬.length) {
      console.error("");
      console.error("★★ 서버에서 온 파일이 " + 서버.length + "개뿐입니다 " +
        "(올릴 파일 " + 로컬.length + "개) — 당기기가 샌 것으로 봅니다. ★★");
      console.error("");
      console.error("   clasp 가 오류 없이 빈손으로 돌아오는 일이 있습니다(로그인 만료 뒤 등).");
      console.error("   그대로 올리면 서버에 무엇이 있는지 «한 번도 안 보고» 덮습니다.");
      console.error("");
      console.error("     npx clasp login       그리고 다시");
      process.exit(1);
    }

    /* ① 지워질 것 */
    const 지워질것 = 서버.filter((f) => !로컬이름.has(이름만(f)));

    /* ② 서버 내용이 이 파일의 «역사» 안에 있나 */
    const 밖으로 = [];
    for (const f of 서버) {
      const 짝 = 로컬.find((l) => 이름만(l) === 이름만(f));
      if (!짝) continue;

      /*  줄끝을 고른 뒤 견준다 — 편집기는 LF, 저장소는 CRLF 다.
          줄끝은 뜻이 아니므로 비교에서 빼야 매번 「다르다」가 되지 않는다. */
      const 서버본 = 벗기(readFileSync(join(집, f), "utf8"));

      let 커밋들 = [];
      try {
        /*  stderr 를 받아 둔다 — 무시 목록의 _secrets.gs 는 git 이 모르고,
            그때 fatal 한 줄을 뱉는다. 예상된 경우를 오류처럼 보여 주면
            정작 멈춰야 할 때의 말이 묻힌다. */
        /*  ★ --full-history ★  (2026-10-04)
            git 은 기본으로 «그 파일이 안 바뀐 합치기»의 옆가지를 숨긴다.
            다른 세션의 서버 작업을 보관 가지에 남기고 -s ours 로 «보았고
            우리 것을 골랐다»를 기록했더니, 그 보관 커밋이 안 보여 견주기가
            계속 멈췄다. 묻는 것은 「역사 어디에든 있나」다 — 옆가지도 봐야 한다. */
        커밋들 = execFileSync("git", ["log", "--full-history", "--format=%H", "--", "./" + 짝], {
          cwd: 어디, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        }).split(String.fromCharCode(10)).filter(Boolean);
      } catch { continue; }
      if (!커밋들.length) continue;   //  git 이 모르는 파일은 넘긴다

      /*  최근 것부터 본다 — 거의 언제나 «마지막 배포»가 최근 몇 커밋 안에 있다.
          찾으면 바로 끝낸다. 못 찾으면 그 파일의 역사를 다 훑는다. */
      let 찾음 = false;
      for (const c of 커밋들) {
        let 그때;
        try {
          그때 = execFileSync("git", ["show", c + ":./" + 짝], {
            cwd: 어디, encoding: "buffer", maxBuffer: 1 << 28,
            stdio: ["ignore", "pipe", "pipe"],
          }).toString("utf8");
        } catch { continue; }
        if (벗기(그때) === 서버본) { 찾음 = true; break; }
      }
      if (!찾음) 밖으로.push(짝);
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
      console.log(SEP2 + "서버에 있는 내용이 커밋 «어디에도» 없습니다 — 편집기에서 고치고 커밋을 안 한 것입니다");
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
