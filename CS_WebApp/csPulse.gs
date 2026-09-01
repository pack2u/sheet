/**
 * CS앱 자동 새로고침용 변경 감지 (pulse)
 * ★ 2026-08-26 신규
 *
 * 대상: CS 커뮤니티 보드 + 진행 중 반품.
 * 주문·송장 검색은 제외한다 — 검색은 사용자가 의도해서 실행하는 화면이고,
 * 자동으로 다시 그리면 보고 있던 결과가 사라진다.
 *
 * 목록 전체를 주기적으로 내려보내지 않는다. 지문(signature)만 비교해
 * 실제로 바뀐 패널만 다시 불러오게 한다. 카드 본문·첨부·담당자 명단이
 * 폴링마다 오가지 않으므로 응답이 수십 바이트로 줄고,
 * 무엇보다 바뀐 게 없을 때 화면을 건드리지 않는다.
 */

/**
 * 배포 빌드 번호.
 *
 * ★ 재배포할 때마다 clasp 버전 번호와 같이 올린다 ★
 *   Apps Script 는 서버에서 브라우저를 깨우지 못한다. 재배포는 그 다음에
 *   페이지를 새로 여는 사람에게만 닿고, 열어둔 화면은 옛 HTML 을 계속 돌린다.
 *   그래서 이 값을 pulse 에 실어 보내 프런트가 스스로 알아채게 한다.
 *   안 올리면 사람들은 옛 화면을 쓰면서 고쳐진 줄 안다.
 */
var CS_BUILD_ = "173";

/** 문자열 → 짧은 지문. djb2 변형, 36진수 */
function _cs_pulse_hash_(s) {
  s = String(s == null ? "" : s);
  var h1 = 5381;
  var h2 = 52711;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    h1 = (h1 * 33 + c) % 4294967296;
    h2 = (h2 * 31 + c) % 4294967296;
  }
  return h1.toString(36) + "." + h2.toString(36);
}

/** 커뮤니티 보드 지문 — 카드 추가·수정·전달내역·읽음·첨부 전부 반영 */
function _cs_pulse_board_() {
  var tab = _cs_hb_getTab_();
  var lr = tab.getLastRow();
  if (lr < 2) return { sig: "0", active: 0, done: 0 };

  var lastCol = Math.min(
    Math.max(tab.getLastColumn(), _CS_HB_HEADERS_.length),
    tab.getMaxColumns(),
  );
  var data = tab.getRange(2, 1, lr - 1, lastCol).getDisplayValues();
  var c = _CS_HB_COL_;
  var parts = [];
  var active = 0;
  var done = 0;

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var id = String(row[c.id] || "").trim();
    var title = String(row[c.title] || "").trim();
    var body = String(row[c.body] || "").trim();
    if (!id && !title && !body) continue; // 빈 행

    var status = String(row[c.status] || "").trim() || _CS_HB_STATUS_OPEN_;
    if (status === _CS_HB_STATUS_DONE_) done++;
    else active++;

    // 행 전체를 지문에 넣는다. 어느 열이 바뀌어도 감지된다.
    parts.push(row.join("\u0001"));
  }

  return {
    sig: _cs_pulse_hash_(parts.join("\u0002")),
    active: active,
    done: done,
  };
}

/** 진행 중 반품 지문 — 캐시를 그대로 쓴다(다른 담당자가 기록하면 캐시가 지워진다) */
function _cs_pulse_returns_() {
  var rows = _cs_loadReturnLedgerCases_(30, true, false);
  var parts = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    // 상태 변경·상담 추가(notice 누적)·행 이동을 모두 잡는다
    parts.push(
      String(r.tab) + "|" + String(r.row) + "|" + String(r.status) + "|" + String(r.notice),
    );
  }

  // 접수 건수(대시보드)는 완료건도 세므로 전체 목록 개수를 함께 본다
  var allCount = -1;
  try {
    allCount = _cs_loadReturnLedgerCases_(30, false, false).length;
  } catch (eA) {}

  return {
    sig: _cs_pulse_hash_(parts.join("\u0002")) + "/" + allCount,
    active: rows.length,
  };
}

/**
 * 프런트 폴링 진입점.
 * 한쪽이 실패해도 다른 쪽은 살린다 — 폴링이 통째로 죽으면 자동 새로고침이 멈춘다.
 * @return {{ok:boolean, board:Object|null, ret:Object|null, errors:string[]}}
 */
function csGetCsPulse(opt) {
  var _acg_ = _cs_ac_guard_();
  if (_acg_) return _acg_;

  var out = { ok: true, build: CS_BUILD_, board: null, ret: null, errors: [] };

  try {
    out.board = _cs_pulse_board_();
  } catch (eB) {
    out.errors.push("보드: " + String((eB && eB.message) || eB));
  }

  try {
    out.ret = _cs_pulse_returns_();
  } catch (eR) {
    out.errors.push("반품: " + String((eR && eR.message) || eR));
  }

  return out;
}
