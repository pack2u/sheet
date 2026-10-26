/**
 *  FTP 서버와 «한 줄씩» 말해 본다 — 왜 거절하는지 글자 그대로 본다   (2026-10-26)
 *
 *    node _sabang_relay/_ftp_말걸기.mjs
 *
 *  ★ 왜 ★ 2026-10-26 에 두 번 잘못 짚었다 (비밀번호 → IP 제한).
 *    라이브러리가 뭉뚱그린 말(`530 Login incorrect`) 말고 **서버가 보낸 줄 전부**를 본다.
 *    인사말·기능목록(FEAT)·거절 문구에 까닭이 적혀 있는 경우가 많다.
 *
 *  ★ 비밀번호는 한 번만 쓴다 ★ 여러 번 틀리면 잠긴다.
 *    보내는 것은 USER·PASS 한 쌍뿐이고, 글자는 화면에 안 찍는다.
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const 여기 = import.meta.dirname;
const cfg = JSON.parse(readFileSync(path.join(여기, "_ftp.json"), "utf8"));

const sock = net.createConnection({ host: cfg.host, port: cfg.port ?? 21 });
sock.setEncoding("utf8");
sock.setTimeout(20_000);

let 버퍼 = "";
const 기다 = () => new Promise((맞) => {
  const 본다 = () => {
    /* 한 응답은 「숫자 공백 … 줄바꿈」으로 끝난다. 여러 줄(220-…)도 모은다 */
    const m = 버퍼.match(/^\d{3} [^\r\n]*\r?\n/m);
    if (m) { const 답 = 버퍼; 버퍼 = ""; sock.off("data", 받); 맞(답.trimEnd()); }
  };
  const 받 = (d) => { 버퍼 += d; 본다(); };
  sock.on("data", 받); 본다();
});

const 보내 = async (줄, 숨길) => {
  console.log(`  →  ${숨길 ? 줄.split(" ")[0] + " ********" : 줄}`);
  sock.write(줄 + "\r\n");
  const 답 = await 기다();
  for (const l of 답.split(/\r?\n/)) console.log(`  ←  ${l}`);
  return 답;
};

try {
  console.log(`\n${cfg.host}:${cfg.port ?? 21} 에 말을 겁니다 (비밀번호는 한 번만 보냅니다)\n`);
  await new Promise((맞, 틀) => { sock.once("connect", 맞); sock.once("error", 틀); sock.once("timeout", () => 틀(new Error("시간초과"))); });
  const 인사 = await 기다();
  for (const l of 인사.split(/\r?\n/)) console.log(`  ←  ${l}`);

  /* 서버가 무엇을 할 수 있는지 — 거절 까닭이 여기 적히는 경우가 있다 */
  await 보내("FEAT");
  const u = await 보내(`USER ${cfg.user}`);
  if (/^331/.test(u)) {
    const p = await 보내(`PASS ${cfg.password}`, true);
    console.log("\n── 읽는 법 ──");
    if (/^230/.test(p)) {
      console.log("  230 = 로그인 됐습니다. 아까와 달라졌습니다.");
    } else if (/^530/.test(p)) {
      console.log("  530 = 서버가 «로그인을 거절»했습니다.");
      console.log("  ★ 이 줄의 «글자»가 중요합니다 ★");
      console.log("    · 그냥 'Login incorrect' 뿐이면 아이디/비밀번호 아니면 IP 둘 중 하나인데 안 알려주는 것입니다.");
      console.log("    · 'not allowed' · 'denied' · 'blocked' 같은 말이 섞이면 IP·차단 쪽입니다.");
    } else {
      console.log(`  ${p.slice(0, 3)} = 흔치 않은 답입니다. 위 줄을 그대로 보세요.`);
    }
  } else {
    console.log("\n  ※ USER 에 331 이 안 왔습니다 — 아이디 단계에서 이미 막힌 것입니다.");
  }
  await 보내("QUIT").catch(() => {});
} catch (e) {
  console.error(`\n★ ${e.message}`);
} finally {
  sock.destroy();
  console.log("");
}
