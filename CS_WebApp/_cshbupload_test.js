/**
 * 카드 올리기 — 다 될 때까지 팝업이 막아 서고, 올라간 글이 보인다
 *
 *  > "이미지 업로드 중이라고 하단에 잠깐 뜨고마니까 창을 나가버리면서
 *  >  업로드가 완료가 안되.. 글등록이 되어도 등록된 내용이 안뜨꼬
 *  >  글쓰기그데로 남아 있으니까 글이 올라간건지 확인이 안되..
 *  >  팝업창으로 업로드가 완료되면 글쓰기 창도 새로고침되거나 글이
 *  >  올라가야 완료가 된건지 알수가 있자나"   (2026-09-16)
 *
 *  여태 무엇이 보였나 — 등록 단추 글씨가 「첨부 올리는 중…」으로 바뀌는 것이
 *  전부였다. 작성 창은 그대로 열려 있고 취소 단추도 눌렸다. 사람은 다 된 줄
 *  알고 창을 닫았고, 남은 사진은 안 올라갔다.
 *
 *  지켜야 할 것
 *    · 올리는 동안 팝업이 «위에» 서서 작성 창을 못 건드리게 한다
 *    · 끝은 사람이 «확인»해야 닫힌다 — 저절로 닫히면 못 본 채 지나간다
 *    · 실패한 첨부는 버리지 않는다 — 그것만 다시 올릴 수 있어야 한다
 *    · 확인을 누르면 작성 창이 닫히고, 올라간 카드가 화면에 보인다
 *
 * 실행: node _cshbupload_test.js
 */
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? "  ok   " : "  FAIL ") + label + "  ->  " + JSON.stringify(got) +
    (ok ? "" : "   (기대: " + JSON.stringify(want) + ")"));
}

const html = fs.readFileSync("home.html", "utf8");
function grabFn(name) {
  const i = html.indexOf("function " + name + "(");
  if (i < 0) throw new Error(name + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { d++; seen = true; }
    else if (html[k] === "}") { d--; if (seen && d === 0) return html.slice(i, k + 1); }
  }
  throw new Error(name + " 본문이 안 닫힘");
}

/* ── 가짜 화면 ── */
function 화면() {
  const 칸 = {};
  function el(id) {
    if (!칸[id]) {
      칸[id] = {
        id, textContent: "", innerHTML: "", className: "", style: {}, value: "",
        children: [], onclick: null,
        classList: {
          _s: new Set(),
          add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
          contains(c) { return this._s.has(c); },
          toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
        },
        appendChild(c) { this.children.push(c); },
        scrollIntoView() { this._scrolled = true; },
        setAttribute() {}, getAttribute() { return ""; },
      };
    }
    return 칸[id];
  }
  return { 칸, el };
}

function 판() {
  const 화 = 화면();
  const 부른것 = [];
  const ctx = {
    document: {
      getElementById: (id) => 화.el(id),
      createElement: () => ({ type: "", className: "", textContent: "", onclick: null }),
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    window: { addEventListener: () => {} },
    setTimeout: (f) => { f(); return 0; },
    toast: (m) => 부른것.push(["toast", m]),
    부른것,
    화: 화.칸,
  };
  vm.createContext(ctx);
  vm.runInContext(
    ["hbUpEl", "hbUpOpen", "hbUpStep", "hbUpDone", "hbUpClose"].map(grabFn).join("\n") +
    "\nvar HB_UP_BUSY = false;", ctx);
  return ctx;
}

console.log("\n[1] 올리는 동안 팝업이 «막아 선다»");
{
  const c = 판();
  vm.runInContext("hbUpOpen('카드를 올리는 중…', '제목')", c);
  check("팝업이 떴다", c.화.hbUpModal.classList.contains("active"), true);
  check("올리는 중 표시", c.화.hbUpTitle.textContent, "카드를 올리는 중…");
  check("★ 닫지 말라고 적는다", c.화.hbUpWarn.style.display, "");
  check("★ 닫을 단추가 «없다»", c.화.hbUpBtns.className, "hb-up-btns");
  check("★ 올리는 중 표시가 켜진다", vm.runInContext("HB_UP_BUSY", c), true);
  check("몇 개인지 모를 땐 흘러가는 줄무늬", c.화.hbUpFill.className, "hb-up-fill hb-up-idle");
}

console.log("\n[2] 몇 개 중 몇 개인지 보인다");
{
  const c = 판();
  vm.runInContext("hbUpOpen('올리는 중…','')", c);
  vm.runInContext("hbUpStep('사진을 올리는 중…', '2 / 5   a.jpg', 1, 5)", c);
  check("진행 글", c.화.hbUpSub.textContent, "2 / 5   a.jpg");
  check("막대가 찬다", c.화.hbUpFill.style.width, "20%");
  check("줄무늬는 끈다", c.화.hbUpFill.className, "hb-up-fill");
}

console.log("\n[3] 끝은 «사람이 확인»해야 닫힌다");
{
  const c = 판();
  let 확인함 = 0;
  c.확인 = () => 확인함++;
  vm.runInContext("hbUpOpen('올리는 중…','')", c);
  vm.runInContext("hbUpDone(true, '카드와 사진 3개가 다 올라갔습니다', null, 확인)", c);

  check("★ 저절로 안 닫힌다", c.화.hbUpModal.classList.contains("active"), true);
  check("★ 확인을 부르지 않았다", 확인함, 0);
  check("올라갔다고 말한다", c.화.hbUpTitle.textContent, "올라갔습니다");
  check("무엇이 올라갔나", c.화.hbUpSub.textContent, "카드와 사진 3개가 다 올라갔습니다");
  check("닫지 말라는 말은 치운다", c.화.hbUpWarn.style.display, "none");
  check("올리는 중 표시가 꺼진다", vm.runInContext("HB_UP_BUSY", c), false);

  const 단추 = c.화.hbUpBtns.children;
  check("단추는 하나 (확인)", 단추.length, 1);
  check("글씨", 단추[0].textContent, "확인");
  단추[0].onclick();
  check("★ 누르면 닫힌다", c.화.hbUpModal.classList.contains("active"), false);
  check("★ 누르면 뒷일이 돈다", 확인함, 1);
}

console.log("\n[4] 실패가 있으면 «다시 시도»가 생긴다");
{
  const c = 판();
  let 다시함 = 0, 확인함 = 0;
  c.다시 = () => 다시함++;
  c.확인 = () => 확인함++;
  vm.runInContext("hbUpOpen('올리는 중…','')", c);
  vm.runInContext("hbUpDone(false, '사진 3개는 올라갔고 2개가 남았습니다', 다시, 확인)", c);

  check("일부가 안 올라갔다고 말한다", c.화.hbUpTitle.textContent, "일부가 안 올라갔습니다");
  const 단추 = c.화.hbUpBtns.children;
  check("단추는 둘", 단추.length, 2);
  check("첫째는 다시 시도", 단추[0].textContent, "안 올라간 것 다시");
  check("★ 둘째 글씨가 「확인」이 아니다 (다 된 줄 알면 안 된다)",
    단추[1].textContent, "남은 것 포기하고 닫기");

  단추[0].onclick();
  check("다시 시도가 돈다", 다시함, 1);
  check("★ 다시 시도는 팝업을 안 닫는다", c.화.hbUpModal.classList.contains("active"), true);
}

console.log("\n[5] 실패한 첨부를 버리지 않는다");
{
  /*  여태는 다 올렸든 반만 올렸든 hbPendClear 로 비웠다. 두 장이 실패하면
      사람이 사진을 다시 찾아 처음부터 붙여야 했다. */
  check("대기 목록을 갈아 끼우는 길이 있다", html.indexOf("function hbPendSet(scope, list)") >= 0, true);
  check("★ 실패분만 남긴다", html.indexOf("hbPendSet('create', 실패목록)") >= 0, true);
  check("★ 실패 목록을 돌려준다", /done\(ok, 실패\.length, 실패\)/.test(html), true);
  check("왜 실패했는지도 담는다", html.indexOf("a.왜 = String((res && res.error)") >= 0, true);

  //  다 성공했을 때만 비운다 — 아니면 다시 올릴 길이 없다
  const 성공뒤 = html.indexOf("if (!fail) {");
  const 비움 = html.indexOf("hbPendClear('create');", 성공뒤);
  check("★ 다 됐을 때만 비운다", 성공뒤 >= 0 && 비움 > 성공뒤 && 비움 - 성공뒤 < 200, true);
}

console.log("\n[6] 확인을 누르면 작성 창이 닫히고 올라간 글이 보인다");
{
  check("작성 창을 닫는다", /function 마무리\(cardId\)[\s\S]{0,200}closeHbModal\(\)/.test(html), true);
  check("임시저장을 지운다", /function 마무리\(cardId\)[\s\S]{0,260}draftClear\('hb'\)/.test(html), true);
  check("★ 방금 올린 카드를 짚는다",
    /function 마무리\(cardId\)[\s\S]{0,320}HB_JUST_POSTED = String\(cardId/.test(html), true);
  check("보드를 새로 받는다", /function 마무리\(cardId\)[\s\S]{0,360}hbReloadBoards\(\)/.test(html), true);

  check("렌더 끝에서 그 카드를 보여 준다", html.indexOf("hbShowJustPosted();") >= 0, true);
  check("★ 필터를 먼저 푼다 (안 그러면 걸러져 안 보인다)",
    /function hbShowJustPosted[\s\S]{0,700}if \(HB_LEVEL\) setHbLevel\(''\)/.test(html), true);
  check("테두리를 잠깐 물들인다", html.indexOf("hb-just-posted") >= 0, true);
  check("한 번만 한다", /function hbShowJustPosted[\s\S]{0,600}HB_JUST_POSTED = '';/.test(html), true);
}

console.log("\n[7] 창을 닫으려 하면 브라우저가 붙잡는다");
{
  check("beforeunload 를 건다", html.indexOf("window.addEventListener('beforeunload'") >= 0, true);
  check("★ 올리는 중일 때만 붙잡는다",
    /beforeunload[\s\S]{0,200}if \(!HB_UP_BUSY\) return;/.test(html), true);
}

console.log("\n[8] 팝업이 작성 창 «위»에 선다");
{
  /*  작성 창(.modal-overlay)이 z-index 100 이다. 같거나 낮으면 뒤에 깔려
      취소 단추가 그대로 눌린다 — 막아 서는 뜻이 없어진다. */
  const css = html.slice(html.indexOf(".modal-overlay.hb-up-overlay"), html.indexOf(".hb-up-box"));
  const z = (css.match(/z-index:\s*(\d+)/) || [])[1];
  check("z-index 가 적혀 있다", !!z, true);
  check("★ 작성 창(100)보다 위", Number(z) > 100, true);
}

console.log("\n[9] 실행 중엔 등록 단추가 죽어 있다 (두 번 눌러 두 장 올라가지 않게)");
{
  check("누르면 잠근다", /function submitHbCard[\s\S]{0,900}btn\.disabled = true/.test(html), true);
  check("팝업을 연다", /function submitHbCard[\s\S]{0,1100}hbUpOpen\(/.test(html), true);
  check("실패하면 되돌린다", html.indexOf("function 단추되돌리기()") >= 0, true);
}

console.log("");
console.log(fail === 0 ? "다 통과 (" + pass + "건)" : "실패 " + fail + "건 / 통과 " + pass + "건");
process.exit(fail === 0 ? 0 : 1);
