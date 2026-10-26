/**
 * ══════════════════════════════════════════════════════════════
 *  중계기 올리기 — FTP 프로그램 없이                          (2026-10-26)
 *
 *  > 사장님: 「FTP가 안된다니까」
 *
 *    node _sabang_relay/_올리기.mjs           ← 견주기만 (아무것도 안 올린다)
 *    node _sabang_relay/_올리기.mjs --올려
 *
 *  ★ 왜 이걸 만들었나 ★
 *    포트 21 은 이 PC 에서 **열려 있다**(실측 2026-10-26). 서버도 `220 FTP server ready`
 *    로 답한다. 그런데 사장님 FTP 프로그램은 시간초과가 난다 — 거의 둘 중 하나다:
 *      · 프로그램이 **SFTP(22번)** 로 잡혀 있다 → 22번은 닫혀 있어 영원히 시간초과
 *      · **자료 채널(PASV)** 설정이 안 맞는다
 *    이 스크립트는 **평문 FTP + 패시브**로 붙는다. 설정을 고를 여지를 없앴다.
 *
 *  ★ 올리기 «전에» 서버 것을 받아 견준다 ★
 *    2026-10-13 에 그 걸음이 「서버가 한 판 뒤처져 있다」를 잡았다.
 *    두드려 본 문만으로 「같다」고 단정했다가 틀렸다. 그래서 늘 받아서 견준다.
 *
 *  ★ 비밀번호는 채팅에 적지 않는다 ★
 *    같은 폴더의 `_ftp.json` 에서 읽는다. 그 파일은 git 에 안 올라간다(.gitignore).
 *      { "host": "222.122.39.14", "user": "siot00", "password": "…", "dir": "/siot00/www/pack2u/sabang" }
 *    메모장으로 만들어 «붙여넣기» 하면 된다 — 터미널 비밀번호 창의 IME 문제를 안 탄다.
 * ══════════════════════════════════════════════════════════════
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const ftp = req("basic-ftp");

/*  ★ import.meta.url 의 pathname 으로 길을 만들면 한글 폴더가 %EC%83%81… 로 깨진다 ★
    사장님께 「여기에 만드세요」라고 알려 줄 길이 깨지면 그 자리를 못 찾는다. */
const 여기 = import.meta.dirname;
const 설정길 = path.join(여기, "_ftp.json");
const 올릴까 = process.argv.includes("--올려");

/* 올릴 것 — 파일마다 「왜 올리나」를 적어 둔다 */
const 올릴것 = [
  { 이름: "sabang.php", 까닭: "클레임·문의 읽기 + 답변 저장 울타리 (판 20261026-cs-answer-guard)" },
];

if (!existsSync(설정길)) {
  console.error(`\n설정 파일이 없습니다 — ${설정길}`);
  console.error(`\n메모장으로 이 내용을 만들어 «그 자리»에 저장해 주세요 (비밀번호만 채우면 됩니다):\n`);
  console.error(JSON.stringify({
    host: "222.122.39.14", port: 21, user: "siot00",
    password: "여기에 FTP 비밀번호",
    dir: "/siot00/www/pack2u/sabang",
  }, null, 2));
  console.error(`\n  · 이 파일은 git 에 안 올라갑니다.`);
  console.error(`  · 비밀번호는 채팅에 적지 마세요 — 저는 이 파일로만 읽습니다.`);
  console.error(`  · user 가 siot00 이 아니면 그것도 고쳐 주세요.\n`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(설정길, "utf8"));
for (const k of ["host", "user", "password", "dir"]) {
  if (!cfg[k] || String(cfg[k]).includes("여기에")) {
    console.error(`\n_ftp.json 의 ${k} 가 아직 안 채워졌습니다.\n`);
    process.exit(1);
  }
}

const c = new ftp.Client(30_000);
c.ftp.verbose = false;
/* ★ 평문 FTP + 패시브로 못박는다 ★ 시간초과의 두 원인(SFTP·액티브)을 둘 다 없앤다 */
let 나감 = 0;

try {
  console.log(`\n붙습니다 — ftp://${cfg.user}@${cfg.host}:${cfg.port ?? 21}  (평문 · 패시브)`);
  await c.access({
    host: cfg.host, port: cfg.port ?? 21, user: cfg.user, password: cfg.password,
    secure: false,
  });
  console.log("  ✅ 로그인 됐습니다");

  await c.cd(cfg.dir);
  console.log(`  폴더 ${cfg.dir}`);

  const 목록 = await c.list();
  const 임시 = mkdtempSync(path.join(tmpdir(), "relay-"));

  for (const { 이름, 까닭 } of 올릴것) {
    const 여기것길 = path.join(여기, 이름);
    if (!existsSync(여기것길)) { console.log(`\n  ✕ ${이름} — 내 쪽에 없습니다`); continue; }
    const 여기것 = readFileSync(여기것길);
    const 서버줄 = 목록.find((f) => f.name === 이름);

    console.log(`\n── ${이름} ──`);
    console.log(`   까닭  ${까닭}`);
    console.log(`   내 것  ${여기것.length.toLocaleString()}바이트`);

    if (!서버줄) {
      console.log(`   서버   ★ 없습니다 ★`);
    } else {
      /*  ★ 받아서 견준다 ★ 크기만 보고 「같다」고 하지 않는다 */
      const 받은길 = path.join(임시, 이름);
      await c.downloadTo(받은길, 이름);
      const 서버것 = readFileSync(받은길);
      const 같나 = Buffer.compare(여기것, 서버것) === 0;
      const 판 = (b) => String(b).match(/X-Relay-Build:\s*([\w-]+)/)?.[1] ?? "(없음)";
      console.log(`   서버   ${서버것.length.toLocaleString()}바이트 · 판 ${판(서버것)}`);
      console.log(`   내 판  ${판(여기것)}`);
      if (같나) { console.log(`   → 이미 같습니다. 안 올립니다.`); continue; }
      /*  서버 것을 백업해 둔다 — 되돌릴 자리가 없으면 올리면 안 된다 */
      const 백업 = path.join(여기, `sabang_서버사본_${new Date().toISOString().slice(0,10).replace(/-/g,"")}.php`);
      writeFileSync(백업, 서버것);
      console.log(`   서버 것을 받아 뒀습니다 → ${path.basename(백업)}`);
    }

    if (!올릴까) { console.log(`   (견주기만 했습니다 — 올리려면 --올려)`); continue; }
    await c.uploadFrom(여기것길, 이름);
    나감++;
    console.log(`   ✅ 올렸습니다`);
  }
} catch (e) {
  console.error(`\n★ 못 했습니다 — ${e.message}`);
  if (/530|login/i.test(String(e.message))) {
    /*  530 은 «서버까지 닿아서 거절당한 것»이다 — 방화벽·접속범위·포트는 다 멀쩡하다.
        남은 것은 아이디와 비밀번호뿐. 흔한 까닭을 적어 둔다(2026-10-26 에 여기서 막혔다). */
    console.error("  서버까지는 닿았고 «로그인만» 거절당했습니다.");
    console.error("  ★ 2026-10-26: 이것은 비밀번호가 아니라 «IP 제한»이었다 ★");
    console.error("    같은 비밀번호가 일산 PC 에서는 들어갔다. 이 호스팅은 허용 안 된 IP 를");
    console.error("    «인증 실패»로 돌려준다 — 포트는 열어 주고 로그인에서 막는다.");
    console.error("    → 호스팅 관리페이지 › 접속 범위를 「국내」로 열어야 한다.");
    console.error("    (비밀번호를 고치기 «전에» IP 부터 본다)");
    console.error("  흔한 까닭 둘:");
    console.error("    · ★ FTP 비밀번호가 호스팅 관리페이지 로그인 비밀번호와 «다를» 수 있습니다 ★");
    console.error("      관리페이지의 「FTP 비밀번호 변경」에서 새로 정하고 그 값을 넣으면 확실합니다.");
    console.error("    · 아이디가 siot00 이 아닐 수 있습니다 (_ftp.json 의 user).");
    console.error("  ※ 여러 번 틀리면 잠길 수 있으니 짐작으로 되풀이하지 않습니다.");
  }
  if (/timeout|ETIMEDOUT/i.test(String(e.message))) console.error("  시간초과입니다 — 호스팅에서 접속 범위를 「국내」로 열어야 할 수 있습니다.");
  process.exitCode = 1;
} finally {
  c.close();
}

/* ★ 올렸으면 «밖에서» 확인한다 ★ 올렸다는 말과 돌아간다는 말은 다르다 */
if (나감) {
  console.log("\n올린 뒤 바깥에서 판 번호를 봅니다…");
  try {
    const r = await fetch("https://siot.com/pack2u/sabang/sabang.php");
    const 판 = r.headers.get("x-relay-build");
    const t = (await r.text()).slice(0, 160);
    console.log(`  HTTP ${r.status} · 판 ${판 ?? "(머리글 없음)"}`);
    console.log(`  ${t}`);
    if (판 === "20261026-cs-answer-guard") {
      console.log("\n  ✅ 새 판이 돌고 있습니다. 이제 깨보기를 돌리세요:");
      console.log("     node _sabang_relay/_cs_answer_guard_check.mjs");
    } else {
      console.log("\n  ※ 판 번호가 안 바뀌었습니다 — 다른 자리에 올라갔을 수 있습니다.");
    }
  } catch (e) { console.log(`  못 봤습니다 — ${e.message}`); }
}
console.log("");
