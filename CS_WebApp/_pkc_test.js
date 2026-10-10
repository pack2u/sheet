/**
 * csLogenPickupCheck.gs 시험 — 「스캔 없음」과 「못 물음」을 가르는 자리.
 *
 * 왜 여기만 시험하나: 이 판정 하나가 헛경보의 갈림길이다.
 *   못 물은 것을 「집하 안 됨」으로 읽으면 날마다 수백 건을 겁주게 되고,
 *   집하 안 된 것을 「못 물음」으로 읽으면 박스가 창고에 남은 채 조용하다.
 *   둘 다 로젠이 ok:false 로 주기 때문에 ok 로는 못 가린다.
 *
 * 돌리기:  node CS_WebApp/_pkc_test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const 소스 = fs.readFileSync(path.join(__dirname, "csLogenPickupCheck.gs"), "utf8");

/*  _pkc_judge_ 만 꺼내 돈다. 시트·네트워크를 안 건드리는 함수라
    통째로 흉내 낼 필요가 없다.                                          */
const 시작 = 소스.indexOf("function _pkc_judge_");
const 끝 = 소스.indexOf("/* ──", 시작);
if (시작 < 0 || 끝 < 0) {
  console.error("✘ _pkc_judge_ 를 못 찾았습니다 — 파일이 바뀌었으면 이 시험도 고쳐야 합니다");
  process.exit(1);
}
// eslint-disable-next-line no-eval
const _pkc_judge_ = eval(소스.slice(시작, 끝) + "\n_pkc_judge_");

let 실패 = 0;
function 같나(이름, 받은것, 바란것) {
  if (받은것 === 바란것) { console.log("  ✔ " + 이름); return; }
  console.log("  ✘ " + 이름 + " — 바란 것 「" + 바란것 + "」 받은 것 「" + 받은것 + "」");
  실패++;
}

console.log("── 로젠이 「스캔 없음」으로 주는 꼴 (운영계 실응답) ──");
/*  _cslogen_test.js FIXTURE_NODATA 와 같은 글. csLogenTrackMany 가
    resultCd FALSE 를 걸러 error 에 resultMsg 를 담아 준다.              */
같나("스캔정보가 없습니다",
  _pkc_judge_({ ok: false, error: "화물추적 조회 결과 없음 - 스캔정보가 없습니다." }), "누락");
같나("조회 결과 없음만 있을 때",
  _pkc_judge_({ ok: false, error: "조회 결과 없음" }), "누락");
같나("처리결과 0건",
  _pkc_judge_({ ok: false, error: "응답에 없습니다 (처리결과 0건)" }), "누락");
/*  ★ 부름은 성공했는데 statNm 이 빈 꼴 ★ _logen_buildLast_ 가
    「이력 없음」으로 채워 ok:true 로 준다. 이것도 집하 안 된 것이다.      */
같나("ok 인데 이력 없음", _pkc_judge_({ ok: true, statusName: "이력 없음" }), "누락");
같나("ok 인데 상태가 빈 칸", _pkc_judge_({ ok: true, statusName: "" }), "누락");

console.log("── 걷어간 꼴 ──");
같나("집하완료", _pkc_judge_({ ok: true, statusName: "집하완료" }), "스캔됨");
같나("터미널출고", _pkc_judge_({ ok: true, statusName: "터미널출고" }), "스캔됨");
같나("배송완료", _pkc_judge_({ ok: true, statusName: "배송완료" }), "스캔됨");
/*  ★ 처음 보는 상태 이름 ★ 로젠은 통보 없이 단계를 늘릴 수 있다.
    모르는 이름을 「집하 안 됨」으로 읽으면 이름이 하나 바뀌는 날
    하루치가 통째로 겁주게 된다. 스캔이 찍혔으면 걷어간 것이다.           */
같나("처음 보는 상태", _pkc_judge_({ ok: true, statusName: "간선상차" }), "스캔됨");

console.log("── ★ 못 물은 꼴 — 겁주면 안 되는 자리 ★ ──");
같나("시간 예산에 걸림",
  _pkc_judge_({ ok: false, error: "한 번에 다 조회하지 못했습니다 — 나눠서 다시 눌러 주세요." }), "못물음");
같나("하루 호출 한도",
  _pkc_judge_({ ok: false, error: "일일 호출 한도(9000)에 도달했습니다." }), "못물음");
같나("호출 실패", _pkc_judge_({ ok: false, error: "호출 실패: timeout" }), "못물음");
같나("응답을 해석 못 함",
  _pkc_judge_({ ok: false, error: "응답을 해석하지 못했습니다 (HTTP 502)" }), "못물음");
같나("응답에 아예 없음", _pkc_judge_({ ok: false, error: "응답에 없습니다 ()" }), "못물음");
같나("답이 없음", _pkc_judge_(undefined), "못물음");
같나("까닭도 모름", _pkc_judge_({ ok: false }), "못물음");

console.log("── 코호트·자리표가 출고 지연과 섞이지 않나 ──");
const ost = fs.readFileSync(path.join(__dirname, "csLogenOutStale.gs"), "utf8");
const 내자리 = (소스.match(/_PKC_SRCKEY_ = "([^"]+)"/) || [])[1];
const 저자리 = (ost.match(/_OST_SRCKEY_ = "([^"]+)"/) || [])[1];
같나("공지 자리표가 다르다", 내자리 !== 저자리 && !!내자리 && !!저자리, true);
/*  머리말에 「OST_FOUND 와 섞지 않는다」고 적어 두었으므로 글에는 나온다.
    ★ 실제로 그 칸을 «쓰는지»를 본다 ★ 섞이면 출고 지연 점검이 어디까지
    봤는지를 서로 덮어 둘 다 헛돈다.                                      */
같나("OST 속성을 안 건드린다", /(set|get)Property\s*\(\s*"OST_/.test(소스), false);
같나("내 속성 이름을 쓴다", /_PKC_PROP_ = "PKC_STATE"/.test(소스), true);
/*  ★ 오늘 회차를 집으면 안 된다 ★ 집하는 그날 저녁에 일어난다.
    오늘 것을 물으면 하루치가 통째로 「집하 안 됨」으로 나온다.           */
같나("오늘 회차를 뺀다", /m\[1\] >= 오늘/.test(소스), true);

console.log(실패 ? "\n✘ " + 실패 + "개 틀렸습니다" : "\n✔ 다 맞았습니다");
process.exit(실패 ? 1 : 0);
