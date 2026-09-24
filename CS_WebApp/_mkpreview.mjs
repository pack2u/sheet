/**
 * ══════════════════════════════════════════════════════════════
 *  화면을 브라우저로 눈으로 보려고 만드는 미리보기 빌더
 *  2026-09-24
 *
 *  GAS 템플릿(<?!= include(...) ?> · <?= 값 ?>)과 google.script.run 을
 *  그대로는 브라우저에서 못 읽는다. 그 자리를 메워 _preview_*.html 로 뽑는다.
 *  .claspignore 가 _preview_*.html 를 걸러내므로 GAS 에는 올라가지 않는다.
 *
 *  실행:  node _mkpreview.mjs [페이지…]        (없으면 주요 페이지 전부)
 * ══════════════════════════════════════════════════════════════
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const 기본페이지 = [
  "home.html",
  "barcode.html",
  "inventory.html",
  "logistics.html",
  "orders.html",
  "return_intake.html",
  "statement.html",
];

/** 템플릿이 doGet 에서 받는 값들 (Code.gs 의 tpl.* 와 같은 이름이어야 한다) */
const 값 = {
  userEmail: "pack2u@pack2u.co.kr",
  userName: "팩투유",
  webAppUrl: "#preview",
  v2Url: "#preview",
  staff: "",
  startWorkspace: false,
  isLogistics: false,
};

/**
 * <?= 식 ?> 은 이름 하나가 아니라 «식» 이 올 수 있다
 *   <?= startWorkspace ? "true" : "false" ?>
 *   <?= JSON.stringify(userName || staff || "") ?>
 * 그래서 이름만 갈아 끼우면 안 된다 — 값들을 스코프에 넣고 식을 계산한다.
 * 계산이 안 되는 식은 빈 문자열로 두되 «지우지 않고» 따옴표 자리를 지킨다
 * (지우면 `var x = ;` 처럼 깨진 JS 가 나온다).
 */
function 식계산(식) {
  const 이름들 = Object.keys(값);
  try {
    const fn = new Function(...이름들, '"use strict"; return (' + 식 + ');');
    const 답 = fn(...이름들.map((k) => 값[k]));
    return 답 === undefined || 답 === null ? "" : String(답);
  } catch {
    console.log("  계산 못 함 — <?= " + 식 + " ?> → 빈 값");
    return "";
  }
}

/** google.script.run 을 대신한다 — 성공 핸들러에 그럴듯한 빈 값을 넘긴다 */
const 스텁 = `<script>
(function () {
  var 담당자 = ['김진수', '고윤서', '박상식', '강서희'];
  function 만들기() {
    var 통 = { _ok: null, _fail: null };
    var api = new Proxy(통, {
      get: function (t, k) {
        if (k === 'withSuccessHandler') return function (fn) { t._ok = fn; return api; };
        if (k === 'withFailureHandler') return function (fn) { t._fail = fn; return api; };
        if (k === 'withUserObject') return function () { return api; };
        return function () {
          var 답 = null;
          if (String(k).indexOf('StaffList') >= 0) 답 = 담당자;
          else if (/List|All|Search|Rows|Cards|Items/i.test(String(k))) 답 = [];
          else 답 = {};
          if (t._ok) setTimeout(function () { t._ok(답); }, 0);
          return api;
        };
      }
    });
    return api;
  }
  window.google = { script: { run: 만들기(), host: { close: function () {} }, url: { getLocation: function (f) { f({ parameter: {} }); } } } };
})();
</script>`;

const 대상 = process.argv.slice(2).length ? process.argv.slice(2) : 기본페이지;
let 만든수 = 0;

for (const 이름 of 대상) {
  if (!existsSync(이름)) { console.log("없음 — " + 이름); continue; }
  let s = readFileSync(이름, "utf8");

  // <?!= include('X') ?>  →  X.html 내용
  s = s.replace(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g, (_, 파일) => {
    const p = 파일 + ".html";
    return existsSync(p) ? readFileSync(p, "utf8") : "<!-- " + p + " 없음 -->";
  });

  // <?= 식 ?>  — 이름이든 식이든 계산해서 그 자리에 넣는다
  s = s.replace(/<\?=([\s\S]*?)\?>/g, (_, 식) => 식계산(식.trim()));

  // 그래도 남은 스크립틀릿(<? … ?> · <?!= … ?>)은 지운다
  s = s.replace(/<\?[\s\S]*?\?>/g, "");

  s = s.replace("</head>", 스텁 + "\n</head>");

  const 나갈이름 = "_preview_" + 이름;
  writeFileSync(나갈이름, s, "utf8");
  console.log("만듦 — " + 나갈이름 + "  (" + Math.round(s.length / 1024) + "KB)");
  만든수++;
}

console.log("\n" + 만든수 + "개 · 브라우저로 열어 확인한다 (GAS 에는 올라가지 않는다)");
