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

/* ── [1] 맨 앞(=최신) 한 장이 폭을 다 쓴다 ──────────────── */
console.log("\n[1] 이력 맨 앞 한 장");
{
  //  > "최종 내용이 중요한거라 이전 내용은 스크롤을 이용해서 보면되니까"
  //  최신이 앞이다 — 서버가 내림차순으로 준다(_cs_parseReturnTimeline_)
  ok("★ 맨 앞 한 장에 거는 규칙이 있다", has(".ret-tl-track > .ret-proc:first-child"));
  ok("★ 「한 장뿐일 때만」이 아니다", html.indexOf(".ret-tl-track > .ret-proc:only-child") < 0);
  const i = html.indexOf(".ret-tl-track > .ret-proc:first-child {");
  const 몸통 = i >= 0 ? html.substring(i, i + 200) : "";
  //  flex-grow 만으로는 부모가 내용만큼만 넓을 때 안 늘어난다 — 바닥을 100% 로 깐다
  ok("★ 늘어나게 되어 있다", 몸통.indexOf("flex: 1 1 100%") >= 0);
  ok("★ 굳은 폭을 푼다 (바닥을 100% 로)", 몸통.indexOf("width: 100%") >= 0);
  ok("★ 그래도 너무 좁아지진 않는다", 몸통.indexOf("min-width: 128px") >= 0);
  //  ★ 사진은 오른쪽 칸에 세운다 (2026-09-17) ★
  const g = html.indexOf(".ret-tl-track > .ret-proc:first-child.photo {");
  const 격자 = g >= 0 ? html.substring(g, g + 420) : "";
  ok("★ 사진 이력은 두 칸으로 나눈다", 격자.indexOf("display: grid") >= 0);
  ok("★ 왼쪽은 글, 오른쪽은 사진", 격자.indexOf("grid-template-columns: minmax(0, 1fr) auto") >= 0);
  //  시각·구분이 없는 이력도 있다. 줄 번호로 박으면 사진이 엉뚱한 줄에 앉는다
  ok("★ 자리를 이름으로 준다", 격자.indexOf('"when  pics"') >= 0 && 격자.indexOf('"share share"') >= 0);
  ok("  사진이 그 자리에 간다",
    has(".ret-tl-track > .ret-proc:first-child.photo > .ret-proc-thumbs"));
  ok("  글도 제 자리에 간다",
    has(".ret-tl-track > .ret-proc:first-child.photo > .ret-proc-body { grid-area: body; }"));
  ok("  공개 표시는 아래 한 줄을 다 쓴다",
    has(".ret-tl-track > .ret-proc:first-child.photo > .ret-share { grid-area: share; }"));
  const t2 = html.indexOf(".ret-tl-track > .ret-proc:first-child.photo > .ret-proc-thumbs {");
  const 사진칸 = t2 >= 0 ? html.substring(t2, t2 + 320) : "";
  ok("★ 사진이 많아도 글 칸을 밀어내지 않는다", 사진칸.indexOf("max-width: 55%") >= 0);

  //  여러 장일 때 옛것은 그대로여야 한다 — 옆으로 밀어 보는 길이 막히면 안 된다
  ok("★ 옛 이력은 여태처럼 128px", has("flex: 0 0 auto; width: 128px;"));

  //  밀린 것이 «있다»는 사실은 말해 줘야 한다. 스크롤바는 4px 라 눈에 안 띈다
  ok("★ 옆에 더 있으면 알려 준다", has("class=\"ret-proc-more\""));
  ok("  맨 앞에만 붙인다", has("(j === 0 && visible.length > 1)"));
  ok("  몇 건인지 센다", has("(visible.length - 1) + '건 →</span>'"));
  ok("  시각이 없는 이력에서도 붙는다", has("(when || moreChip ?"));
  ok("  그 딱지 CSS 도 있다", has(".ret-proc-more {"));
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

/* ── [7] 짧은 것은 가로로 흐른다 ────────────────────────── */
console.log("\n[7] 반품비·전화가 한 줄에 나란히");
{
  ok("★ 담는 칸이 있다", has('<div class="ret-metas">'));
  const i = html.indexOf(".ret-metas {");
  const 몸통 = i >= 0 ? html.substring(i, i + 200) : "";
  ok("★ 가로로 흐른다", 몸통.indexOf("display: flex") >= 0);
  ok("★ 좁아지면 접힌다", 몸통.indexOf("flex-wrap: wrap") >= 0);
  ok("★ 비면 자리를 안 먹는다", has(".ret-metas:empty { display: none; }"));

  //  div 가 섞이면 flex 한 줄이 깨진다 — 안에 든 것은 span 이어야 한다
  const j = html.indexOf('<div class="ret-metas">');
  const 안쪽 = j >= 0 ? html.substring(j, html.indexOf("'</div>' +", j)) : "";
  ok("★ 반품비가 span 이다", 안쪽.indexOf('<span class="ret-meta">반품비 ') >= 0);
  ok("★ 전화도 span 이다", 안쪽.indexOf('<span class="ret-meta">\' + esc(c.phone)') >= 0);
  ok("  줄바꿈을 만드는 div 가 안 남았다", 안쪽.indexOf('<div class="ret-meta">') < 0);
}

/* ── [8] 「202609 170행」을 안 적는다 ───────────────────── */
console.log("\n[8] 시트 몇 행인지는 카드에 안 적는다");
{
  //  > "굳이 202609 127행 같은 내용은 불필요해"
  ok("★ 행 번호를 카드에 안 적는다", html.indexOf("esc(c.tab) + ' ' + c.row + '행 · '") < 0);
  ok("★ 아랫줄을 따로 만든다", has("function retSubLine(c)"));
  ok("★ 카드가 그것을 쓴다", has("retSubLine(c) +"));

  const i = html.indexOf("function retSubLine(c) {");
  const 몸통 = i >= 0 ? html.substring(i, i + 420) : "";
  ok("★ 날짜는 남긴다", 몸통.indexOf("if (c.date)") >= 0);
  ok("★ 담당자도 남긴다", 몸통.indexOf("if (c.staff)") >= 0);
  ok("★ 둘 다 없으면 줄 자체를 안 만든다", 몸통.indexOf("if (!bits.length) return '';") >= 0);
  ok("★ 행 번호는 여기에도 없다", 몸통.indexOf("c.row") < 0 && 몸통.indexOf("c.tab") < 0);

  //  자료에서 지운 것이 아니다 — 서버는 그대로 실어 보낸다 (팝업·진단이 쓴다)
  ok("★ 자료에서 지운 것은 아니다", has("c.tab") && has("c.row"));
}

console.log("\n" + (fail ? "FAIL " + fail + "건" : "통과 " + pass + "건"));
process.exit(fail ? 1 : 0);
