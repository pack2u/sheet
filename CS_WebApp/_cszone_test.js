/**
 * 도서·산간을 로젠에게 물어 외워 두기 — «두 프로젝트가 같은 열쇠를 쓰는가»
 *
 * ★ 이 시험이 지키는 것 ★
 *   > 사장님: "기존거는 죽여 놓고 API를 활용하는게 더 정확할꺼 같아" (2026-09)
 *   > 사장님: "㉮로 해줘" — API 는 «표가 놓친 섬»을 잡는 데만 (2026-10-09)
 *
 *   CS웹앱이 로젠에 묻고 「도서산간_로젠」 탭에 적는다. 세트분리는 그 탭을
 *   읽기만 한다. 프로젝트가 둘이라 **열쇠 만드는 법이 두 벌**이다 —
 *     CS_WebApp/csLogenZoneCache.gs  csLogenZoneKey
 *     세트분리V2/core.js             ssLogenZoneKey
 *   한쪽만 고치면 표를 못 찾아 **조용히 아무 일도 안 일어난다.** 오류도 안 난다.
 *   섬이 일반으로 나가고, 추가운임이 빠지고, 아무도 모른다.
 *
 *   머리글도 둘이 맞아야 한다 — 적는 쪽과 읽는 쪽의 칸 차례다.
 *
 * 실행: node _cszone_test.js
 */
const fs = require("fs");
const vm = require("vm");

const cs = fs.readFileSync("csLogenZoneCache.gs", "utf8");
const core = fs.readFileSync("../세트분리V2/core.js", "utf8");
const masters = fs.readFileSync("../세트분리V2/gasMasters.js", "utf8");
const io = fs.readFileSync("../세트분리V2/gasIO.js", "utf8");

let pass = 0, fail = 0;
function ok(label, cond) {
  cond ? pass++ : fail++;
  console.log((cond ? "  ok   " : "  FAIL ") + label);
}

function 꺼내(s, n) {
  const i = s.indexOf("function " + n + "(");
  if (i < 0) throw new Error(n + " 를 못 찾음");
  let d = 0, seen = false;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "{") { d++; seen = true; }
    else if (s[k] === "}") { d--; if (seen && d === 0) return s.slice(i, k + 1); }
  }
}

const ctx = { console, String, Number, Array, Math, JSON };
vm.createContext(ctx);
vm.runInContext(꺼내(cs, "csLogenZoneKey"), ctx);
vm.runInContext(꺼내(core, "ssLogenZoneKey"), ctx);
const CS열쇠 = (a) => vm.runInContext("csLogenZoneKey(" + JSON.stringify(a) + ")", ctx);
const 세트열쇠 = (a) => vm.runInContext("ssLogenZoneKey(" + JSON.stringify(a) + ")", ctx);

console.log("\n[1] ★ 두 프로젝트의 열쇠가 «글자 하나까지» 같은가");
{
  /*  다르면 표를 못 찾아 조용히 아무 일도 안 일어난다. */
  const 주소들 = [
    "인천광역시 강화군 교동면 대룡리 100",
    "서울특별시 강서구 화곡동 1",
    "제주특별자치도 제주시 연동 1",
    "강원특별자치도 평창군 대관령면 횡계리 1",
    "경기도 평택시 포승읍 성해홍원로 91",
    "경기 부천시 원미구 중동 1234",
    "전라남도 신안군 압해읍 송공리 1",
    "서울 강남구 테헤란로 1",
    "  경기도   김포시  통진읍   귀전리 376-16  ",   // 띄어쓰기가 엉켜도
    "부산",                                          // 토막난 주소
    "",                                              // 빈 주소
  ];
  let 다름 = 0;
  for (const a of 주소들) {
    if (CS열쇠(a) !== 세트열쇠(a)) {
      다름++;
      console.log("       ★ 다름: " + JSON.stringify(a) +
        "\n          CS   " + JSON.stringify(CS열쇠(a)) +
        "\n          세트 " + JSON.stringify(세트열쇠(a)));
    }
  }
  ok("★ " + 주소들.length + "개 주소 모두 같은 열쇠", 다름 === 0);
}

console.log("\n[2] ★ 로젠이 가르는 단위까지 남기는가");
{
  /*  로젠은 «면·리» 단위로 가른다 — 2026-10-09 실측:
        인천 강화군 교동면 대룡리 → 연륙도서 Y
        서울 강서구 화곡동        → 전부 N
        제주 제주시 연동          → 제주 Y
        강원 평창군 대관령면 횡계리 → 산간 Y
      그래서 「시도 시군구 읍면동」 까지, 리가 있으면 리까지 남긴다. */
  ok("★ 「리」까지 남긴다 (같은 면 안에서 갈린다)",
     CS열쇠("인천광역시 강화군 교동면 대룡리 100") === "인천광역시 강화군 교동면 대룡리");
  ok("리가 없으면 읍면동까지", CS열쇠("서울특별시 강서구 화곡동 1") === "서울특별시 강서구 화곡동");
  ok("번지는 버린다", CS열쇠("제주특별자치도 제주시 연동 1") === "제주특별자치도 제주시 연동");
  ok("★ 도로명도 셋까지만 (「…로 91」 은 리가 아니다)",
     CS열쇠("경기도 평택시 포승읍 성해홍원로 91") === "경기도 평택시 포승읍");
  ok("띄어쓰기가 엉켜도 같다",
     CS열쇠("  경기도   김포시  통진읍   귀전리 376-16  ") === "경기도 김포시 통진읍 귀전리");
  ok("토막난 주소는 있는 만큼", CS열쇠("부산") === "부산");
  ok("빈 주소는 빈 열쇠", CS열쇠("") === "");
}

console.log("\n[3] ★ 적는 쪽과 읽는 쪽의 칸이 맞는가");
{
  /*  CS웹앱이 적고 세트분리가 읽는다. 칸 차례가 어긋나면 판정 자리에서
      엉뚱한 값을 읽는다 — 그러면 모든 지역이 「일반」이 되거나 그 반대다. */
  const 머리 = (cs.match(/var _ZC_HEADER_ = \[([^\]]+)\]/) || [])[1] || "";
  const 칸 = 머리.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
  ok("★ 1번째 칸이 지역키", 칸[0] === "지역키");
  ok("★ 2번째 칸이 판정", 칸[1] === "판정");
  ok("읽는 쪽이 0·1번째를 본다",
     /body\[i\]\[0\]/.test(masters) && /body\[i\]\[1\]/.test(masters));
  ok("탭 이름이 같다",
     /var _ZC_TAB_ = "도서산간_로젠"/.test(cs) && /로젠권역: '도서산간_로젠'/.test(io));
}

console.log("\n[4] ★ 올리기만 한다 — 내리지 않는다");
{
  /*  표가 섬이라 한 줄은 애초에 이 함수로 안 온다. 그래도 코드가 그 뜻을
      지키는지 본다 — 「일반」이면 아무것도 안 하고 돌아서야 한다. */
  ok("★ 판정이 「일반」이면 손대지 않는다",
     /if \(!판정 \|\| 판정 === '일반'\) return false;/.test(core));
  ok("★ 산간은 «일반» 로젠으로 (배가 아니라 차로 간다)",
     /u\.route = SS_ROUTE\.LOTTE;\s*\n\s*return true;/.test(core));
  ok("제주·연륙도서만 도서산간 탭으로",
     /u\.route = 위탁 \? SS_ROUTE\.LOTTE_ISLAND_CONSIGN : SS_ROUTE\.LOTTE_ISLAND;\s*\n\s*return true;/.test(core));
  ok("면제·세우기를 위 갈래와 같이 본다",
     /if \(면제\) \{ ssIslandSkipByManual_/.test(core) && /if \(세우기\) \{ ssIslandHoldByManual_/.test(core));
  ok("판정 자국을 남긴다 (나중에 왜 그렇게 갔는지 안다)",
     /u\.도서판정 = '로젠API'/.test(core) && /'산간\(로젠API\)'/.test(core));
}

console.log("\n[5] ★ 세트분리가 로젠을 «직접 부르지 않는다»");
{
  /*  큰 회차는 1,500줄이다. 거기서 10건씩 150번 부르면 6분 한도를 넘는다.
      묻는 일은 CS웹앱 1시간 일감이 한다. 세트분리는 읽기만. */
  ok("★ core 가 로젠을 안 부른다",
     !/integratedInquiry|UrlFetchApp/.test(core));
  ok("★ masters 도 안 부른다", !/integratedInquiry|UrlFetchApp/.test(masters));
  ok("표가 없어도 멎지 않는다", /catch \(e\) \{ return out; \}/.test(masters));
  ok("CS웹앱이 묻는다", /_logen_call_\("integratedInquiry"/.test(cs));
  ok("10건씩 끊는 일은 csLogen 상수를 쓴다", /_LOGEN_BATCH_SIZE_/.test(cs));
}

console.log("\n[6] ★ 엉뚱한 지역을 섬으로 외우지 않는다");
{
  /*  응답에 «보낸 주소»가 안 실려 온다. 보낸 차례로 맞추는데, 그 차례가
      한 번 어긋나면 엉뚱한 지역을 섬으로 외운다. 틀린 판정은 빈칸보다 나쁘다.
      그래서 돌려준 dongNm 이 보낸 주소 안에 있는지 확인한다. */
  ok("★ dongNm 으로 짝이 맞는지 본다", /보낸\.addr\.indexOf\(dong\) === -1\) continue;/.test(cs));
  ok("성공값을 _logen_ok_ 로 본다 (이 API 는 SUCCESS 다)", /_logen_ok_\(d\.resultCd\)/.test(cs));
}

console.log("\n  " + pass + " 통과 / " + fail + " 실패\n");
process.exit(fail ? 1 : 0);
