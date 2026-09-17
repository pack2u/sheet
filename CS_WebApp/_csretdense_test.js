/**
 * 반품 카드 — 빈자리 줄이기
 *
 *  > "반품카드 크기 조절이 필요해 지금 너무 많은 빈공간들이 자리를 차지해"
 *
 *  두 가지를 지킨다 —
 *    ① 이력이 «한 장»뿐이면 오른쪽 폭을 다 쓴다 (사진이 한 줄로 서고 카드가 낮아진다)
 *    ② 「조밀」은 «고르는 것»이고, 고른 값은 그 사람 브라우저에만 남는다
 *       집중 보기(ret-focus)는 크게 보려고 켜는 것이라 조밀이 이기면 안 된다
 *
 *  ★ 정규식을 쓰지 않는다 ★ 백슬래시가 먹혀 «헛시험»이 되는 일이 잦았다.
 *  indexOf 로 있는 그대로 찾는다.
 *
 * 실행: node _csretdense_test.js
 */
const fs = require("fs");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; console.log("  ok   " + label); return; }
  fail++;
  console.log("  FAIL " + label + "\n         기대 " + want + "\n         실제 " + got);
}

const html = fs.readFileSync("home.html", "utf8");
const has = (s) => html.indexOf(s) >= 0;
const 몇곳 = (s) => html.split(s).length - 1;

/* ── [1] 한 장짜리 이력이 폭을 다 쓴다 ──────────────────── */
console.log("\n[1] 이력이 한 장뿐일 때");
{
  ok("★ :only-child 규칙이 있다", has(".ret-tl-track > .ret-proc:only-child"));
  const i = html.indexOf(".ret-tl-track > .ret-proc:only-child {");
  const 몸통 = i >= 0 ? html.substring(i, i + 200) : "";
  ok("★ 늘어나게 되어 있다", 몸통.indexOf("flex: 1 1 auto") >= 0);
  ok("★ 굳은 폭을 푼다", 몸통.indexOf("width: auto") >= 0);
  ok("★ 그래도 너무 좁아지진 않는다", 몸통.indexOf("min-width: 128px") >= 0);
  ok("★ 사진이 한 줄로 선다",
    has(".ret-tl-track > .ret-proc:only-child .ret-proc-thumbs { flex-wrap: nowrap; }"));

  //  여러 장일 때의 규칙은 그대로여야 한다 — 옆으로 밀어 보는 길이 막히면 안 된다
  ok("★ 여러 장일 때는 여태처럼 128px", has("flex: 0 0 auto; width: 128px;"));
}

/* ── [2] 조밀은 «고르는 것» ─────────────────────────────── */
console.log("\n[2] 조밀 단추");
{
  ok("★ 단추가 있다", has('id="retDense"'));
  ok("★ 누르면 토글한다", has('onclick="toggleReturnDense()"'));
  ok("★ 켜짐/꺼짐을 읽어 준다", has('aria-pressed="false"') && has("aria-pressed', RET_DENSE ? 'true' : 'false'"));
  ok("★ 켜져 있으면 단추에 보인다", has("#pane-returns.ret-dense #retDense"));

  ok("★ 고른 값을 기억한다", has("localStorage.setItem(RET_DENSE_KEY"));
  ok("★ 다시 열면 그대로다", has("localStorage.getItem(RET_DENSE_KEY)"));
  //  저장이 막힌 브라우저에서도 화면은 돌아야 한다
  ok("★ 읽기를 try 로 감쌌다",
    has("try { RET_DENSE = localStorage.getItem(RET_DENSE_KEY) === '1'; } catch (e) {}"));
  ok("★ 쓰기도 try 로 감쌌다",
    has("try { localStorage.setItem(RET_DENSE_KEY, RET_DENSE ? '1' : '0'); } catch (e) {}"));
}

/* ── [3] 집중 보기는 건드리지 않는다 ────────────────────── */
console.log("\n[3] 조밀이 집중 보기를 이기지 않는가");
{
  const 조밀줄 = html.split("\n").filter((l) => l.indexOf("#pane-returns.ret-dense .ret-card") >= 0);
  ok("(조밀 규칙이 있다 — " + 조밀줄.length + "줄)", 조밀줄.length >= 8);
  const 안전 = 조밀줄.every((l) => l.indexOf(".ret-card:not(.ret-focus)") >= 0);
  ok("★ 카드 규칙이 전부 :not(.ret-focus) 로 걸린다", 안전);
  if (!안전) {
    조밀줄.filter((l) => l.indexOf(":not(.ret-focus)") < 0)
      .forEach((l) => console.log("         남은 줄: " + l.trim()));
  }
}

/* ── [4] 줄인 것이 실제로 자리를 줄이는가 ───────────────── */
console.log("\n[4] 무엇을 줄였나");
{
  const i = html.indexOf("#pane-returns.ret-dense .ret-card:not(.ret-focus) {");
  const 몸통 = i >= 0 ? html.substring(i, i + 200) : "";
  ok("★ 카드 안쪽 여백을 줄인다", 몸통.indexOf("padding: 6px 8px 5px") >= 0);
  ok("★ 카드 사이 간격을 줄인다", 몸통.indexOf("margin-bottom: 6px") >= 0);
  ok("★ 이력 글줄을 2줄로 줄인다", has("-webkit-line-clamp: 2; line-height: 1.34;"));
  //  줄바꿈을 낀 채로 찾지 않는다 — 이 파일은 CRLF 라 \n 으로 찾으면 늘 «0곳»이다
  const t = html.indexOf("#pane-returns.ret-dense .ret-card:not(.ret-focus) .ret-proc-thumbs button");
  ok("★ 사진을 작게", t >= 0 && html.substring(t, t + 160).indexOf("width: 26px; height: 26px;") >= 0);
  ok("★ 이력 칸의 최소 높이를 푼다", has("min-height: 0; padding: 6px 7px;"));
}

/* ── [5] 그릴 때마다 같은 옷을 입는가 ───────────────────── */
console.log("\n[5] 배선");
{
  ok("★ 다시 그린 뒤 밀도를 입힌다", has("try { applyReturnDense(); } catch (eD) {}"));
  //  높이가 바뀌면 커스텀 스크롤바가 옛 길이 그대로 남는다 (2026-09-16 잔상 사고)
  ok("★ 스크롤바를 다시 잰다",
    has("if (typeof csSyncScrollbars === 'function') csSyncScrollbars();"));

  const 정의 = html.indexOf("function applyReturnDense()");
  const 부름 = html.indexOf("try { applyReturnDense(); } catch (eD) {}");
  ok("★ 정의도 있고 부르는 곳도 있다", 정의 > 0 && 부름 > 0);
  eq("★ 토글은 한 곳에서만 만든다", 몇곳("function toggleReturnDense()"), 1);
}

/* ── [6] 이력이 없으면 빈 상자를 안 그린다 ──────────────── */
console.log("\n[6] 진행 이력이 없는 카드");
{
  //  > "진행이력이 없으면 진행이력없음 카드가 안나오고 내용이 옆으로 빠져서"
  ok("★ 카드 쪽은 빈 문자열을 돌려준다", has("if (!visible.length) return '';"));
  ok("★ 「진행 이력 없음」 상자를 카드에 안 그린다",
    html.indexOf("<div class=\"ret-tl-track\"><div class=\"ret-proc empty\">") < 0);

  ok("★ 오른쪽 칸 자체를 뺀다",
    has("(tlHtml ? '<div class=\"ret-right\">' + tlHtml + '</div>' : '')"));
  ok("★ 카드에 표식을 붙인다", has("(tlHtml ? '' : ' ret-noproc')"));
  ok("★ 왼쪽이 폭을 다 쓴다", has(".ret-card.ret-noproc .ret-left"));
  const i = html.indexOf(".ret-card.ret-noproc .ret-left {");
  const 몸통 = i >= 0 ? html.substring(i, i + 160) : "";
  ok("  1/3 묶임을 푼다", 몸통.indexOf("flex: 1 1 auto") >= 0 && 몸통.indexOf("max-width: none") >= 0);

  //  «있고 없고»를 두 군데서 세면 언젠가 어긋나 빈 칸이 다시 생긴다
  eq("★ 이력을 그리는 곳은 카드에서 한 번뿐", 몇곳("renderReturnTimeline(c.timeline, idx)"), 1);

  //  팝업(반품 조회)은 다른 함수가 그린다 — 거기 「진행 이력 없음」은 그대로 둔다
  ok("★ 팝업 쪽 안내는 살아 있다", has("<div class=\"ret-proc empty\">진행 이력 없음</div>"));
  ok("  그 CSS 도 남아 있다", has(".ret-proc.empty"));
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
