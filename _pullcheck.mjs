/**
 * ══════════════════════════════════════════════════════════════
 *  올리기 전에 «서버를 먼저 본다»
 *  2026-10-04
 *
 *  > "지금 파주에서 수정을 했는데 수정내용을 편집기로 커밋을 안하면
 *  >  일이 반복된다고 하네."
 *
 *  ★ 무엇이 어긋나나 ★
 *    `clasp push -f` 는 「내 것을 올린다」가 아니라 로컬 파일 목록으로
 *    서버를 **동기화**한다. 그래서 편집기에서 고친 것이 서버에만 있으면
 *    그대로 «덮인다». 오류는 안 난다 — 그냥 없어진다.
 *    그러면 거기서 한 일을 다시 해야 한다. 그게 「일이 반복된다」다.
 *
 *    2026-10-04 에 실제로 그럴 뻔했다. 서버 빌드는 382, 내 쪽은 381 이었고
 *    아홉 파일에 「택배사 한 칸」 작업이 서버에만 있었다.
 *
 *  ★ 사람이 기억하는 것으로는 안 된다 ★
 *    배포는 급할 때 돌린다. 급할 때 「먼저 당겨 볼까」를 떠올리는 사람은 없다.
 *    그래서 배포 스크립트가 스스로 보고, 다르면 «멈춘다».
 *
 *  ★ 작업 폴더에 당기지 않는다 ★
 *    `clasp pull` 은 파일을 덮어쓴다. 커밋 안 된 것이 날아갈 수 있다.
 *    그래서 임시 폴더에 당겨 «견주기만» 한다.
 *
 *  쓰는 법 (배포 스크립트 안에서, push 하기 «전»에):
 *      import { 서버먼저보기 } from "../_pullcheck.mjs";
 *      서버먼저보기();            // 다르면 거기서 멈춘다(exit 1)
 *
 *  일부러 덮어쓰려면 배포 스크립트에 --서버무시 를 붙인다.
 * ══════════════════════════════════════════════════════════════
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/*  _secrets 는 git 에 없고 서버에만 온전할 수 있다. 여기서 다루지 않는다 —
    그 파일은 _secrets_guard_test.js 가 따로 지킨다.                      */
const 안볼것 = /^_secrets\./;

const 고르게 = (s) =>
  s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\s+$/, "");

/**
 * 한 파일을 올려도 되나. — 「다르다」만으로 막으면 평소 배포가 다 막힌다.
 *
 *   서버 == 작업 폴더  → 올려도 덮을 게 없다            → "같다"
 *   서버 == git HEAD   → 담긴 것 위에 내가 앞서 있다     → "내가앞섰다"
 *   둘 다 아니다       → 서버에 양쪽 다 없는 것이 있다   → "서버에만있다"
 *
 * 2026-10-04 의 사고가 세 번째였다. 서버에 「택배사 한 칸」 작업이 있었고
 * git 에도, 작업 폴더에도 없었다. 그대로 올리면 조용히 없어진다.
 *
 * ★ 담긴 적 없는 파일(담긴것 = null)은 막는 쪽으로 기운다 ★
 *   서버에 있고 내 쪽과 다른데 견줄 근거가 없다 — 모르면 멈춘다.
 *
 * @param {string} 작업  작업 폴더의 내용 (고르게 한 것)
 * @param {string} 서버  서버의 내용 (고르게 한 것)
 * @param {string|null} 담긴것  git HEAD 의 내용, 없으면 null
 * @returns {"같다"|"내가앞섰다"|"서버에만있다"}
 */
export function 판단(작업, 서버, 담긴것) {
  if (작업 === 서버) return "같다";
  if (담긴것 !== null && 담긴것 === 서버) return "내가앞섰다";
  return "서버에만있다";
}

/**
 * git 에 「지움」으로 담아 두었나 (staged delete).
 *
 * 끝난 일회용 파일을 치울 때 쓰는 길이다 — `git rm` 한 뒤 배포하면
 * 서버에서도 없어진다. 그 파일은 당기면 「서버에만 있다」로 보이는데,
 * 뜻은 「지우는 중」이다. 담아 둔 뜻이 있으면 막지 않는다.
 */
function 지움으로담겼나(이름) {
  try {
    /*  ★ git 의 두 가지 경로 기준을 섞지 말 것 ★
        `git show HEAD:<길>` 은 «저장소 뿌리» 기준이라 접두사를 붙여야 한다.
        `git diff -- <길>` 의 경로는 «지금 폴더» 기준이다 — 접두사를 붙이면
        CS_WebApp/CS_WebApp/… 을 찾아 늘 「없다」가 된다.
        2026-10-04 에 그래서 「일부러 지운 것」을 못 알아봤다.        */
    /*  ★ 두 이름을 다 물어본다 ★ clasp 는 서버 것을 .js 로 주는데, 내 쪽
        이름(.gs)은 «로컬 파일이 있어야» 알아낼 수 있다. 지운 뒤에는 없다 —
        그래서 .js 로 물어 늘 「없다」가 나왔다(2026-10-04 에 그랬다).
        담긴 이름은 .gs 일 수도 .js 일 수도 있으니 둘 다 본다.       */
    const 이름들 = [이름];
    if (이름.endsWith(".js")) 이름들.push(이름.slice(0, -3) + ".gs");
    else if (이름.endsWith(".gs")) 이름들.push(이름.slice(0, -3) + ".js");
    for (const n of 이름들) {
      const out = execFileSync("git", ["diff", "--cached", "--name-status", "--", n],
        { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      if (/^D\s/m.test(out)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * git 에 «담긴» 그 파일의 내용. 담긴 적이 없으면 null.
 *
 * 서버가 이것과 같으면, 서버는 담긴 것 그대로이고 내 작업 폴더가 그 위에
 * 앞서 있다는 뜻이다 — 올려도 잃을 게 없다. 평소 배포가 다 이 경우다.
 */
function gitHEAD(이름) {
  try {
    const 안 = execFileSync("git", ["rev-parse", "--show-prefix"],
      { cwd: process.cwd(), encoding: "utf8" }).trim();
    return execFileSync("git", ["show", "HEAD:" + 안 + 이름],
      {
        cwd: process.cwd(), encoding: "utf8", maxBuffer: 1 << 28,
        //  ★ git 의 오류 글을 삼킨다 ★ 담긴 적 없는 파일이면 git 이
        //    「exists on disk, but not in HEAD」를 stderr 로 뿜는다.
        //    그건 고장이 아니라 답이다 — 사람 눈에 띄면 겁먹는다.
        stdio: ["ignore", "pipe", "ignore"],
      });
  } catch {
    return null;                  // git 밖이거나 담긴 적 없는 파일
  }
}

/**
 * 지금 폴더의 clasp 프로젝트를 임시 폴더에 당겨 내 쪽과 견준다.
 *
 * @param {{무시?:boolean}} 선택  무시:true 면 보기만 하고 안 멈춘다
 * @returns {string[]} 다른 파일 이름들 (없으면 빈 배열)
 */
export function 서버먼저보기(선택 = {}) {
  if (process.argv.includes("--서버무시")) {
    console.log("· 서버 견주기를 건너뜁니다 (--서버무시)");
    return [];
  }

  const cj = path.join(process.cwd(), ".clasp.json");
  if (!fs.existsSync(cj)) {
    console.error("★ .clasp.json 이 없습니다 — 프로젝트 폴더에서 돌리세요");
    process.exit(1);
  }
  const id = JSON.parse(fs.readFileSync(cj, "utf8")).scriptId;

  const 받을곳 = fs.mkdtempSync(path.join(os.tmpdir(), "claspcheck-"));
  fs.writeFileSync(path.join(받을곳, ".clasp.json"),
    JSON.stringify({ scriptId: id, rootDir: "." }, null, 2));

  try {
    execFileSync("clasp", ["pull"], { cwd: 받을곳, encoding: "utf8", shell: true, stdio: "pipe" });
  } catch (e) {
    const 말 = String(e.stdout || e.stderr || e.message).split("\n")[0];
    /*  ★ 못 당겼으면 «멈춘다» ★ 「못 봤으니 그냥 올리자」는 가장 위험한
        길이다. 로그인이 풀렸을 때가 흔하다(invalid_rapt) — 그때 올리면
        편집기 작업을 덮는다. 로그인하고 다시 돌리는 게 맞다.          */
    console.error("★ 서버를 못 당겼습니다 — " + 말.slice(0, 200));
    console.error("");
    console.error("   로그인이 풀린 것이면:  clasp login");
    console.error("   그래도 안 되면 일부러 덮어쓸 때만 --서버무시 를 붙이세요.");
    fs.rmSync(받을곳, { recursive: true, force: true });
    process.exit(1);
  }

  const 다른것 = [];   // 서버에만 있는 것 — 이것이 있으면 멈춘다
  const 앞선것 = [];   // 내 쪽이 앞선 파일 — 막지 않지만 몇 개인지는 말해 준다
  const 지운것 = [];   // 일부러 지우는 중인 파일 — 막지 않지만 말해 준다
  for (const f of fs.readdirSync(받을곳)) {
    if (f === ".clasp.json" || 안볼것.test(f)) continue;

    /*  clasp pull 은 서버 스크립트를 늘 .js 로 준다. 내 쪽은 프로젝트마다
        다르다 — CS·포털은 .gs, 세트분리V2 는 .js. 그래서 둘 다 찾는다.
        한쪽만 보면 멀쩡한 파일을 「없다」로 줄줄이 찍어, 정말 다른 파일이
        그 속에 묻힌다 (2026-10-04 에 그래서 한 번 헛봤다).            */
    let 내이름 = f;
    if (f.endsWith(".js")) {
      const gs = f.slice(0, -3) + ".gs";
      if (fs.existsSync(path.join(process.cwd(), gs))) 내이름 = gs;
    }
    const 내길 = path.join(process.cwd(), 내이름);

    if (!fs.existsSync(내길)) {
      /*  ★ 일부러 지운 파일은 막지 않는다 ★  (2026-10-04)
          끝난 일회용 파일을 치울 때, 그 파일은 «서버에만» 남는다 —
          문이 그것까지 막으면 지울 때마다 --서버무시 를 쓰게 되고,
          그 버릇이 들면 문이 있으나 없으나 같아진다.
          git 에 「지움(D)」으로 담아 두었으면 뜻이 분명하다 — 통과시킨다.
          담지 않고 그냥 파일만 없앤 것은 여전히 막는다.            */
      if (지움으로담겼나(내이름)) { 지운것.push(내이름); continue; }
      다른것.push(내이름 + "  ← 서버에만 있다 (" + fs.statSync(path.join(받을곳, f)).size + "바이트)" +
        " · git 에 「지움」으로 담지 않았다");
      continue;
    }
    const a = 고르게(fs.readFileSync(내길, "utf8"));
    const b = 고르게(fs.readFileSync(path.join(받을곳, f), "utf8"));

    /*  ★ 「다르다」만으로 막으면 평소 배포가 다 막힌다 ★
        내가 고쳐서 올리려는 것이니 내 쪽이 앞서 있는 게 «정상»이다.
        막아야 할 것은 «서버에만 있는 것»이다. 그래서 셋을 견준다 —

          서버 == 작업 폴더  → 올려도 덮을 게 없다            → 통과
          서버 == git HEAD   → 담긴 것 위에 내가 앞서 있다     → 통과
          둘 다 아니다       → 서버에 양쪽 다 없는 것이 있다   → 멈춘다

        2026-10-04 의 사고가 바로 세 번째였다. 서버에 「택배사 한 칸」
        작업이 있었고, git 에도 작업 폴더에도 없었다.                  */
    //  ★ 같으면 git 을 묻지 않는다 ★ 파일마다 git 을 한 번씩 부르면
    //    서른 번이 되고, 담긴 적 없는 파일마다 오류 글이 한 줄씩 난다.
    if (a === b) continue;
    const 담긴것 = gitHEAD(내이름);
    const 판 = 판단(a, b, 담긴것 === null ? null : 고르게(담긴것));
    if (판 === "같다") continue;    // 여기까지 오면 거의 없다
    if (판 === "내가앞섰다") { 앞선것.push(내이름); continue; }

    const 차 = b.length - a.length;
    다른것.push(내이름 + "  (" + (차 > 0 ? "서버가 " + 차 + "자 많다" :
      차 < 0 ? "내 쪽이 " + -차 + "자 많다" : "길이는 같고 내용이 다르다") +
      (담긴것 === null ? " · git 에 없는 파일" : "") + ")");
  }

  if (!다른것.length) {
    if (지운것.length) console.log("· 지우는 중인 파일 " + 지운것.length + "개: " + 지운것.join(", ") + " — 올리면 서버에서도 없어집니다");
    console.log(앞선것.length
      ? "· 서버에만 있는 것은 없습니다 (내 쪽이 앞선 파일 " + 앞선것.length + "개 — 그것을 올립니다)"
      : "· 서버와 같습니다 — 올려도 덮을 것이 없습니다");
    fs.rmSync(받을곳, { recursive: true, force: true });
    return [];
  }

  console.error("");
  console.error("★★ 서버(편집기)에 내 쪽과 다른 것이 " + 다른것.length + "개 있습니다 ★★");
  for (const x of 다른것) console.error("   · " + x);
  console.error("");
  console.error("   그대로 올리면 편집기에서 한 작업이 «덮입니다». 오류는 안 납니다 — 그냥 없어집니다.");
  console.error("   당긴 것은 여기 있습니다 (작업 폴더는 안 건드렸습니다):");
  console.error("     " + 받을곳);
  console.error("");
  console.error("   먼저 그것과 견주어 담고 나서 올리세요.");
  console.error("   일부러 덮어쓸 때만 --서버무시 를 붙이세요.");

  if (선택.무시) return 다른것;
  process.exit(1);
}
