/**
 * ══════════════════════════════════════════════════════════════
 *  중계기 올리기 — SFTP(22번)                                  (2026-10-26)
 *
 *  > 사장님: 「shh로 접속해줘」  · 22번이 열린 것을 확인하고 만들었다
 *
 *    node _sabang_relay/_올리기_sftp.mjs           ← 견주기만
 *    node _sabang_relay/_올리기_sftp.mjs --올려
 *
 *  ★ 왜 터미널 ssh 가 아니라 이것인가 ★
 *    이 호스팅은 **셸이 없는 계정**이라 `scp` 는 `Connection closed` 로 떨어지고,
 *    `sftp` 는 그 벽은 넘지만 **비밀번호 프롬프트에 영문이 안 들어간다(IME)**.
 *    라이브러리로 붙으면 프롬프트가 없어 IME 를 아예 안 탄다.
 *
 *  ★ 비밀번호는 `_ftp.json` 에서 읽는다 ★ 같은 파일을 쓴다(.gitignore).
 *    FTP 와 SSH 비밀번호가 다르면 `sshPassword` 를 따로 적으면 그것을 쓴다.
 *
 *  ★ 올리기 «전에» 서버 것을 받아 견준다 ★
 *    2026-10-13 에 그 걸음이 「서버가 한 판 뒤처져 있다」를 잡았다.
 * ══════════════════════════════════════════════════════════════
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const { Client } = req("ssh2");

const 여기 = import.meta.dirname;
const 설정길 = path.join(여기, "_ftp.json");
const 올릴까 = process.argv.includes("--올려");

if (!existsSync(설정길)) { console.error(`\n_ftp.json 이 없습니다 — ${설정길}\n`); process.exit(1); }
const cfg = JSON.parse(readFileSync(설정길, "utf8"));
const 비번 = cfg.sshPassword || cfg.password;
if (!비번 || String(비번).includes("여기에")) { console.error("\n비밀번호가 아직 안 채워졌습니다.\n"); process.exit(1); }

const 올릴것 = [
  { 이름: "sabang.php", 까닭: "클레임·문의 읽기 + 답변 저장 울타리 (판 20261026-cs-answer-guard)" },
];

const conn = new Client();
const 끝남 = new Promise((맞, 틀) => { conn.on("ready", 맞); conn.on("error", 틀); });

console.log(`\n붙습니다 — sftp://${cfg.user}@${cfg.host}:22`);
conn.connect({
  host: cfg.host, port: 22, username: cfg.user, password: String(비번),
  readyTimeout: 25_000,
  /*  이 호스팅은 옛 알고리즘만 받는 경우가 있다 — 기본값에 더해 넓게 연다 */
  algorithms: { serverHostKey: ["ssh-ed25519", "ecdsa-sha2-nistp256", "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"] },
});

let 나감 = 0;
try {
  await 끝남;
  console.log("  ✅ 로그인 됐습니다");

  const sftp = await new Promise((맞, 틀) => conn.sftp((e, s) => (e ? 틀(e) : 맞(s))));
  const 쓰 = (f, ...a) => new Promise((맞, 틀) => sftp[f](...a, (e, r) => (e ? 틀(e) : 맞(r))));

  const 원격 = cfg.dir;
  const 목록 = await 쓰("readdir", 원격).catch((e) => { throw new Error(`${원격} 를 못 엽니다 — ${e.message}`); });
  console.log(`  폴더 ${원격} (${목록.length}개)`);

  for (const { 이름, 까닭 } of 올릴것) {
    const 여기것길 = path.join(여기, 이름);
    if (!existsSync(여기것길)) { console.log(`\n  ✕ ${이름} — 내 쪽에 없습니다`); continue; }
    const 여기것 = readFileSync(여기것길);
    const 원격길 = 원격 + "/" + 이름;
    const 있나 = 목록.some((f) => f.filename === 이름);

    console.log(`\n── ${이름} ──`);
    console.log(`   까닭  ${까닭}`);
    console.log(`   내 것  ${여기것.length.toLocaleString()}바이트`);

    const 판 = (b) => String(b).match(/X-Relay-Build:\s*([\w-]+)/)?.[1] ?? "(없음)";
    if (!있나) {
      console.log(`   서버   ★ 없습니다 ★`);
    } else {
      /* ★ 받아서 견준다 ★ 크기만 보고 「같다」고 하지 않는다 */
      const 서버것 = await new Promise((맞, 틀) => {
        const 조각 = []; const st = sftp.createReadStream(원격길);
        st.on("data", (d) => 조각.push(d)); st.on("end", () => 맞(Buffer.concat(조각))); st.on("error", 틀);
      });
      const 같나 = Buffer.compare(여기것, 서버것) === 0;
      console.log(`   서버   ${서버것.length.toLocaleString()}바이트 · 판 ${판(서버것)}`);
      console.log(`   내 판  ${판(여기것)}`);
      if (같나) { console.log(`   → 이미 같습니다. 안 올립니다.`); continue; }
      const 백업 = path.join(여기, `sabang_서버사본_${new Date().toISOString().slice(0,10).replace(/-/g,"")}.php`);
      writeFileSync(백업, 서버것);
      console.log(`   서버 것을 받아 뒀습니다 → ${path.basename(백업)}  (되돌릴 자리)`);
    }

    if (!올릴까) { console.log(`   (견주기만 했습니다 — 올리려면 --올려)`); continue; }
    await new Promise((맞, 틀) => {
      const w = sftp.createWriteStream(원격길);
      w.on("close", 맞); w.on("error", 틀); w.end(여기것);
    });
    나감++;
    console.log(`   ✅ 올렸습니다`);
  }
} catch (e) {
  console.error(`\n★ 못 했습니다 — ${e.message}`);
  const m = String(e.message);
  if (/authentication|All configured authentication/i.test(m)) {
    console.error("  서버까지는 닿았고 «로그인만» 거절당했습니다.");
    console.error("  ★ 2026-10-26: 이것은 비밀번호가 아니라 «IP 제한»이었다 ★");
    console.error("    같은 비밀번호가 일산 PC 에서는 들어갔다(알드라이브로도 같은 증상).");
    console.error("    이 호스팅은 허용 안 된 IP 를 «인증 실패»로 돌려준다.");
    console.error("    → 호스팅 관리페이지 › 접속 범위를 「국내」로. 비밀번호를 고치기 전에 IP 부터.");
  }
  if (/timed out|ETIMEDOUT/i.test(m)) console.error("  시간초과 — 호스팅 접속 범위가 다시 닫혔을 수 있습니다(「국내」로).");
  process.exitCode = 1;
} finally {
  conn.end();
}

/* ★ 올렸으면 «밖에서» 확인한다 ★ 올렸다는 말과 돌아간다는 말은 다르다 */
if (나감) {
  console.log("\n올린 뒤 바깥에서 판 번호를 봅니다…");
  try {
    const r = await fetch("https://siot.com/pack2u/sabang/sabang.php");
    const 판 = r.headers.get("x-relay-build");
    console.log(`  HTTP ${r.status} · 판 ${판 ?? "(머리글 없음)"}`);
    console.log(`  ${(await r.text()).slice(0, 150)}`);
    /*  ★ 판 번호를 «박아 두지» 않는다 ★  (2026-10-26)
        남의 작업이 같은 파일에 섞이면 판 번호가 바뀐다 — 박아 두면 멀쩡히 올라간 것을
        「안 올라갔다」고 말한다. 내 파일의 판과 견준다.  */
    const 내판 = String(readFileSync(path.join(여기, "sabang.php"))).match(/X-Relay-Build:s*([w.+-]+)/)?.[1];
    if (판 && 내판 && 판 === 내판) {
      console.log("\n  ✅ 새 판이 돌고 있습니다. 이제 울타리를 깨 보세요:");
      console.log("     node _sabang_relay/_cs_answer_guard_check.mjs");
    } else {
      console.log("\n  ※ 판 번호가 안 바뀌었습니다 — 다른 자리에 올라갔을 수 있습니다.");
    }
  } catch (e) { console.log(`  못 봤습니다 — ${e.message}`); }
}
console.log("");
