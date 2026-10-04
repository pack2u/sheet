/**
 * ══════════════════════════════════════════════════════════════
 *  v2 Supabase 이중 기록 (미러)
 *  파일: _partnerSupabaseV2Mirror.gs
 *
 *  ★ 왜 있나 (2026-09-07) ★
 *    시트는 지금 기존 Supabase(bmlbehjt…)로 쓰고, 새 웹앱은 v2
 *    프로젝트(brpven…)를 본다. 서로 다른 곳이라 웹앱 화면이 비어 있었다.
 *
 *    기존 흐름을 끊지 않고 v2 를 실데이터로 검증하려면 **양쪽에 같이**
 *    써야 한다. 그래서 기존 기록은 그대로 두고, 여기서 한 벌 더 보낸다.
 *    v2 쪽이 믿을 만해지면 기존 쓰기를 끊는다.
 *
 *  ★ 절대 원래 흐름을 막지 않는다 ★
 *    미러가 실패해도 마감은 이미 끝났다. 여기서 예외를 올리면
 *    "검증하려고 붙인 것"이 운영을 죽인다. 전부 삼키고 로그만 남긴다.
 *
 *  ★ 끄는 법 ★
 *    스크립트 속성 V2_MIRROR = off  → 즉시 멈춘다. 코드를 안 고쳐도 된다.
 *    키가 없으면 조용히 아무 일도 하지 않는다(설정 전에도 안전).
 *
 *  키: _secrets.gs 의 SUPABASE_V2_SERVICE_KEY
 *      service_role 이어야 한다 — RLS 를 통과해 써야 하므로.
 *      anon 키를 넣으면 전부 거부된다.
 * ══════════════════════════════════════════════════════════════
 */

var _SBV2_URL_ = "https://brpvenvdwlundhlstsuw.supabase.co";
var _SBV2_KEY_CACHE_ = null;
var _SBV2_OFF_PROP_ = "V2_MIRROR";

/** 키를 한 번만 읽는다. 없으면 빈 문자열 — 미러는 조용히 쉰다. */
function _sbv2_key_() {
  if (_SBV2_KEY_CACHE_ !== null) return _SBV2_KEY_CACHE_;
  var k = "";
  try {
    if (typeof SUPABASE_V2_SERVICE_KEY !== "undefined") k = SUPABASE_V2_SERVICE_KEY;
    if (!k) {
      k = PropertiesService.getScriptProperties()
        .getProperty("SUPABASE_V2_SERVICE_KEY") || "";
    }
  } catch (e) {}
  _SBV2_KEY_CACHE_ = String(k || "").trim();
  return _SBV2_KEY_CACHE_;
}

function _sbv2_enabled_() {
  try {
    var v = String(PropertiesService.getScriptProperties()
      .getProperty(_SBV2_OFF_PROP_) || "").trim().toLowerCase();
    if (v === "off" || v === "false" || v === "0") return false;
  } catch (e) {}
  return !!_sbv2_key_();
}

/**
 * v2 로 upsert. 같은 줄을 다시 보내면 덮어쓴다 —
 * 소급 보강으로 과거 행을 다시 보낼 때 중복이 쌓이면 안 된다.
 *
 * @param {string} table
 * @param {Array<Object>} rows
 * @param {string=} onConflict 충돌 판정 컬럼 (쉼표 구분)
 */
function _sbv2_upsert_(table, rows, onConflict) {
  if (!_sbv2_enabled_()) return { ok: true, skipped: true, count: 0 };
  if (!rows || !rows.length) return { ok: true, count: 0 };

  var key = _sbv2_key_();
  var url = _SBV2_URL_ + "/rest/v1/" + table;
  if (onConflict) url += "?on_conflict=" + encodeURIComponent(onConflict);

  var BATCH = 200;   // 기존 동기화와 같은 크기 — 페이로드가 커지면 게이트웨이가 자른다
  var sent = 0, errs = [];
  for (var i = 0; i < rows.length; i += BATCH) {
    var batch = rows.slice(i, i + BATCH);
    try {
      var res = UrlFetchApp.fetch(url, {
        method: "post",
        headers: {
          "apikey": key,
          "Authorization": "Bearer " + key,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        payload: JSON.stringify(batch),
        muteHttpExceptions: true,
      });
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) sent += batch.length;
      else errs.push(code + " " + res.getContentText().substring(0, 160));
    } catch (e) {
      errs.push(String(e.message || e).substring(0, 160));
    }
  }
  if (errs.length) Logger.log("[V2] " + table + " 미러 오류: " + errs.slice(0, 2).join(" | "));
  return { ok: !errs.length, count: sent, errors: errs };
}

/**
 * yyyy-MM-dd 만 통과시킨다. 문자열로도 Date 로도 올 수 있다.
 * ★ 모양이 아니면 빈 문자열 ★ 이상한 값이 그대로 날짜 칸에 들어가면
 *   그 날짜를 통째로 지우는 아래 동작이 엉뚱한 곳을 건드린다.
 */
function _sbv2_ymd_(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, "Asia/Seoul", "yyyy-MM-dd");
  }
  var s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

/**
 * 그 날짜에 지금 들어 있는 행 중 **가장 큰 id**. 없으면 0.
 * id 는 늘기만 하므로, 이 값 이하가 「이번에 넣기 전부터 있던 것」이다.
 * ★ 2026-09-09 신규 ★
 */
function _sbv2_maxIdOfDay_(dateStr) {
  if (!_sbv2_enabled_()) return { ok: true, maxId: 0, skipped: true };
  var key = _sbv2_key_();
  var url = _SBV2_URL_ + "/rest/v1/daily_archive?select=id&archive_date=eq." +
            encodeURIComponent(dateStr) + "&order=id.desc&limit=1";
  try {
    var res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { "apikey": key, "Authorization": "Bearer " + key },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      return { ok: false, error: code + " " + res.getContentText().substring(0, 160) };
    }
    var arr = JSON.parse(res.getContentText() || "[]");
    return { ok: true, maxId: (arr[0] && arr[0].id) || 0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e).substring(0, 160) };
  }
}

/**
 * 그 날짜의 **옛 행만** 지운다 (id 가 beforeId 이하인 것). 0 이면 지울 것이 없다.
 *
 * ★ 「날짜를 통째로 지우는」 함수를 두지 않는다 ★
 *   그런 함수가 있으면 언젠가 넣기 **전에** 불린다. 그러면 넣기가 실패했을 때
 *   그날 자료가 통째로 사라진다. 지우는 길은 **넣은 뒤 옛것만** 하나로 좁혀 둔다.
 */
function _sbv2_deleteDayBefore_(dateStr, beforeId) {
  if (!_sbv2_enabled_()) return { ok: true, skipped: true };
  if (!beforeId) return { ok: true, skipped: true };
  var key = _sbv2_key_();
  var url = _SBV2_URL_ + "/rest/v1/daily_archive?archive_date=eq." +
            encodeURIComponent(dateStr) + "&id=lte." + encodeURIComponent(beforeId);
  try {
    var res = UrlFetchApp.fetch(url, {
      method: "delete",
      headers: {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Prefer": "return=minimal",
      },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true };
    return { ok: false, error: code + " " + res.getContentText().substring(0, 160) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).substring(0, 160) };
  }
}

/**
 * 일일마감 미러. 기존 `_sb_syncDailyArchive_` 와 **같은 행 배열**을 받는다.
 * 보내는 쪽을 고치지 않으려고 모양을 그대로 맞췄다.
 *
 * ══════════════════════════════════════════════════════════════
 *  ★ 2026-09-09 — 「그 날짜를 통째로 갈아 끼운다」로 바꿨다 ★
 *
 *  전에는 중복 방지 키 없이 그냥 INSERT 했다. 그래서 마감이 하루에 두 번
 *  돌면 같은 자료가 두 벌 쌓였고, **시트에서 지워도 여기는 그대로 남았다.**
 *  실제로 2026-09-07 에 411행이 그렇게 쌓여 사람이 손으로 골라냈다
 *  (v2 저장소 sql/41·42).
 *
 *  키를 만들려고도 해 봤지만 안 된다 — 미매칭 행은 송장이 없고, 같은 수취인·
 *  품목·수량이 하루에 두 줄인 경우가 실제로 있다(합배송 #1·#2). 컬럼 조합으로는
 *  행을 구분할 수 없고, 구분하려 들면 진짜 줄이 사라진다.
 *
 *  그래서 행이 아니라 **날짜**를 단위로 삼는다: 그 날짜를 통째로 갈아 끼운다.
 *  몇 번을 돌려도 결과가 같고, 시트를 고친 뒤 다시 돌리면 여기도 따라온다.
 *
 *  ★ 순서는 「넣고 → 옛것 지우기」다 ★
 *    「지우고 → 넣기」로 하면 넣기가 실패했을 때 **그날 자료가 통째로 사라진다.**
 *    돈이 걸린 기록에서 그건 되돌릴 수 없다. 순서를 뒤집으면 실패했을 때
 *    남는 것이 「중복」이고, 중복은 다시 돌리면 없어진다.
 *      ① 지금 들어 있는 것 중 제일 큰 id 를 적어 둔다
 *      ② 새로 넣는다 (새 행은 반드시 그보다 큰 id 를 받는다)
 *      ③ **다 들어갔을 때만** ① 이하를 지운다
 *
 *  ★ 그래서 하루치 **전부**를 넘겨야 한다 ★
 *    일부만 넘기면 나머지가 사라진다. 마감 본체(_pep_archiveUnifiedDaily_)는
 *    그 회차에 처리한 행을 전부 넘기므로 조건을 만족한다.
 *    새로 부르는 곳을 만들 때는 이 약속을 지킬 것.
 *
 *  ★ 날짜는 행이 들고 온다 ★
 *    전에는 모든 행을 「오늘」로 찍었다. 소급 마감이 돌면 지난 날짜 자료가
 *    오늘 날짜로 들어갔다. 이제 row.archive_date 를 먼저 보고, 없을 때만 오늘로 둔다.
 * ══════════════════════════════════════════════════════════════
 *
 * @param {Array<Object>} archiveRows 19열 구조 (+ 선택 archive_date)
 */
function sbv2MirrorDailyArchive(archiveRows) {
  try {
    if (!_sbv2_enabled_()) return { ok: true, skipped: true, count: 0 };
    if (!archiveRows || !archiveRows.length) return { ok: true, count: 0 };

    var today = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    var payload = archiveRows.map(function (row) {
      return {
        // 행이 자기 날짜를 들고 오면 그것을 쓴다 (소급 마감분)
        archive_date: _sbv2_ymd_(row.archive_date) || today,
        recorded_at: row.recorded_at || null,
        source: row.source || null,
        order_type: row.order_type || null,
        // 키에 쓰는 세 열은 null 을 넣지 않는다 — 유일 인덱스가 컬럼 그대로를
        // 보므로 null 이 섞이면 upsert 가 맞물리지 않는다 (sql/08 참고)
        order_no: row.order_no || "",
        recipient: row.recipient || null,
        phone: row.phone || null,
        mobile: row.mobile || null,
        address: row.address || null,
        ecount_code: row.ecount_code || "",
        item_name: row.item_name || "",
        qty: parseInt(row.qty, 10) || 0,
        delivery_msg: row.delivery_msg || null,
        invoice_no: row.invoice_no || null,   // 빈 값이 정상이다 — 미매칭 행
        vendor_or_seller: row.vendor_or_seller || null,
        vendor_name: row.vendor_name || null,
        shipping_fee: parseFloat(row.shipping_fee) || 0,
        unit_price: parseFloat(row.unit_price) || 0,
        settle_amount: parseFloat(row.settle_amount) || 0,
        note: row.note || null,
      };
    });

    /* 날짜별로 나눈다. 보통은 하루치지만, 소급 마감이 돌면 여러 날이 섞여 온다. */
    var byDate = {};
    for (var i = 0; i < payload.length; i++) {
      var d = payload[i].archive_date;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(payload[i]);
    }

    var dates = Object.keys(byDate).sort();
    var total = 0, failed = [];
    for (var di = 0; di < dates.length; di++) {
      var day = dates[di];

      /* ★ 넣고 나서 옛것을 지운다 ★ (2026-09-09 — 순서가 중요하다)
         처음엔 「지우고 넣기」로 짰다. 그런데 지우기는 됐는데 넣기가 실패하면
         **그날 자료가 통째로 사라진다.** 돈이 걸린 기록에서 그건 되돌릴 수 없다.
         순서를 뒤집으면 실패했을 때 남는 것이 「중복」이다 —
         중복은 다시 돌리면 없어지고, 사라진 것은 못 되살린다.

           ① 지금 들어 있는 것 중 제일 큰 id 를 적어 둔다
           ② 새로 넣는다  (새 행은 반드시 그보다 큰 id 를 받는다)
           ③ 넣기가 성공했을 때만 ① 이하를 지운다 */
      var before = _sbv2_maxIdOfDay_(day);
      if (!before.ok) {
        failed.push(day + " 기존 확인 실패: " + before.error);
        Logger.log("[V2] " + day + " 기존 id 확인 실패 → 건드리지 않음: " + before.error);
        continue;
      }

      var out = _sbv2_upsert_("daily_archive", byDate[day], "");
      total += out.count;

      if (!out.ok || out.count < byDate[day].length) {
        /* 다 못 넣었다. 옛것을 지우면 그만큼이 빈다 — 그냥 둔다.
           결과는 「중복이 남음」이고, 다음 마감이나 사람이 다시 돌리면 정리된다. */
        failed.push(day + " 넣기 실패 (" + out.count + "/" + byDate[day].length + ") → 옛 자료 그대로 둠");
        Logger.log("[V2] " + day + " 넣기 실패 " + out.count + "/" + byDate[day].length +
                   " → 옛 행을 안 지웠습니다. 중복이 남습니다 (자료는 안 잃습니다).");
        continue;
      }

      var del = _sbv2_deleteDayBefore_(day, before.maxId);
      if (!del.ok) {
        failed.push(day + " 옛 자료 지우기 실패: " + del.error);
        Logger.log("[V2] " + day + " 옛 행 지우기 실패 → 중복이 남습니다: " + del.error);
      }
      Logger.log("[V2] daily_archive " + day + " 갈아끼움 " +
                 out.count + "/" + byDate[day].length + "건" +
                 (before.maxId ? " (옛 " + before.maxId + " 이하 정리)" : " (처음 넣음)"));
    }

    return { ok: !failed.length, count: total, errors: failed };
  } catch (e) {
    Logger.log("[V2] daily_archive 미러 실패: " + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * [메뉴/편집기] v2 미러 상태 점검 — 키·연결·행수를 본다. 쓰지 않는다.
 * 파일: _partnerSupabaseV2Mirror.gs
 */
function partnerDiagnoseV2Mirror() {
  var L = ["═══ v2 Supabase 미러 점검 ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];
  try {
    L.push("대상: " + _SBV2_URL_);
    var key = _sbv2_key_();
    L.push("키: " + (key ? "있음 (" + key.length + "자)" : "★ 없음 — _secrets.gs 의 SUPABASE_V2_SERVICE_KEY"));
    var offProp = "";
    try { offProp = String(PropertiesService.getScriptProperties().getProperty(_SBV2_OFF_PROP_) || ""); } catch (e) {}
    L.push("스위치(" + _SBV2_OFF_PROP_ + "): " + (offProp || "(미설정 = 켜짐)"));
    L.push("동작 여부: " + (_sbv2_enabled_() ? "✔ 미러 켜짐" : "★ 꺼짐"));
    L.push("");

    if (!key) {
      L.push("키를 넣기 전까지 미러는 조용히 쉽니다 — 기존 흐름에는 영향이 없습니다.");
      return _sbv2_out_(L);
    }

    // 연결·행수 확인 (읽기만)
    var res = UrlFetchApp.fetch(
      _SBV2_URL_ + "/rest/v1/daily_archive?select=archive_date&order=archive_date.desc&limit=1",
      {
        headers: { "apikey": key, "Authorization": "Bearer " + key, "Prefer": "count=exact" },
        muteHttpExceptions: true,
      });
    var code = res.getResponseCode();
    L.push("연결: HTTP " + code);
    if (code === 401 || code === 403) {
      L.push("★ 인증 거부 — 서버 메시지:");
      L.push("  " + res.getContentText().substring(0, 300));
      L.push("");
      L.push("  새 형식(sb_secret_)이 거부되면 Legacy API keys 탭의");
      L.push("  service_role (eyJ… 로 시작) 을 넣어 보세요.");
    }
    if (code === 404 || /schema cache/i.test(res.getContentText())) {
      L.push("★ daily_archive 테이블이 없습니다.");
      L.push("  v2 저장소의 sql/07_daily_archive.sql 을 Supabase SQL Editor 에서 실행하세요.");
    } else if (code >= 200 && code < 300) {
      var range = res.getHeaders()["content-range"] || res.getHeaders()["Content-Range"] || "";
      L.push("행 수: " + (String(range).split("/")[1] || "?"));
      var body = res.getContentText();
      L.push("최근 마감일: " + (JSON.parse(body || "[]")[0] || {}).archive_date || "(없음)");
    } else {
      L.push("★ " + res.getContentText().substring(0, 200));
    }
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _sbv2_out_(L);
}

function _sbv2_out_(L) {
  var text = L.join("\n");
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert("v2 미러 점검", text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (eU) {}
  return text;
}

/**
 * ══════════════════════════════════════════════════════════════
 *  [메뉴] v2 키 넣기 — 대화창으로 받아 스크립트 속성에 저장
 *  파일: _partnerSupabaseV2Mirror.gs
 *
 *  ★ 왜 함수로 넣나 ★
 *    스크립트 속성이 50개를 넘으면 편집기 화면이 읽기 전용이 된다.
 *    거기서는 새 속성을 못 넣는다. 그래서 코드로 넣는다.
 *
 *  ★ 왜 코드에 키를 안 적나 ★
 *    소스에 적으면 clasp 로 오가며 히스토리에 영영 남는다.
 *    대화창으로 받으면 값이 어디에도 안 남고 속성에만 들어간다.
 * ══════════════════════════════════════════════════════════════
 */
function partnerSetV2Key() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); }
  catch (e) {
    Logger.log("★ 시트 메뉴에서 실행하세요. 편집기 ▶ 실행은 대화창을 못 띄웁니다.");
    return "시트 메뉴에서 실행하세요.";
  }

  var res = ui.prompt(
    "v2 Supabase 키 넣기",
    "service_role (또는 sb_secret_…) 키를 붙여넣으세요.\n\n" +
    "★ anon · publishable 키를 넣으면 쓰기가 전부 거부됩니다.\n" +
    "값은 스크립트 속성에만 저장되고 코드에는 남지 않습니다.",
    ui.ButtonSet.OK_CANCEL);

  if (res.getSelectedButton() !== ui.Button.OK) return "취소했습니다.";
  var key = String(res.getResponseText() || "").trim();
  if (!key) { ui.alert("빈 값입니다. 넣지 않았습니다."); return "빈 값"; }

  // ── 넣기 전에 어떤 키인지 본다 — anon 을 넣는 실수가 가장 흔하다 ──
  var kind = _sbv2_keyKind_(key);
  if (kind === "anon") {
    ui.alert("★ anon(공개) 키입니다\n\n" +
      "이 키로는 RLS 에 막혀 쓰기가 전부 거부됩니다.\n" +
      "service_role 또는 sb_secret_ 로 시작하는 키를 넣으세요.");
    return "anon 키 거부";
  }

  try {
    PropertiesService.getScriptProperties().setProperty("SUPABASE_V2_SERVICE_KEY", key);
  } catch (e) {
    ui.alert("저장 실패: " + e.message);
    return "저장 실패";
  }
  _SBV2_KEY_CACHE_ = null;   // 다음 호출이 새 값을 읽게 한다

  // 저장했으면 바로 연결까지 확인한다 — "넣었는데 되나?"를 남기지 않는다
  var check = "";
  try {
    var r = UrlFetchApp.fetch(
      _SBV2_URL_ + "/rest/v1/daily_archive?select=archive_date&limit=1",
      { headers: { "apikey": key, "Authorization": "Bearer " + key }, muteHttpExceptions: true });
    var code = r.getResponseCode();
    if (code >= 200 && code < 300) check = "✔ 연결 확인 (HTTP 200)";
    else if (code === 401 || code === 403) {
      // ★ 서버 메시지를 그대로 보여준다 ★
      //   401 이라고만 하면 무엇이 틀렸는지 알 수 없다. Supabase 는
      //   "Invalid API key" · "JWT expired" 처럼 원인을 적어 보낸다.
      check = "★ 거부됨 (HTTP " + code + ")\n" + r.getContentText().substring(0, 300);
    }
    else if (/schema cache/i.test(r.getContentText())) check = "★ daily_archive 테이블이 아직 없습니다 — SQL 을 먼저 실행하세요";
    else check = "HTTP " + code + " · " + r.getContentText().substring(0, 120);
  } catch (e) { check = "연결 확인 실패: " + e.message; }

  ui.alert("v2 키 저장 완료",
    "종류: " + kind + "\n" +
    "길이: " + key.length + "자  (" + key.substring(0, 6) + "…" + key.slice(-4) + ")\n\n" +
    check,
    ui.ButtonSet.OK);
  return check;
}

/**
 * 키 종류 판별. JWT 면 payload 의 role 을, 새 형식이면 접두를 본다.
 * 판별이 안 되면 "알 수 없음" — 막지는 않는다. 형식은 계속 바뀐다.
 */
function _sbv2_keyKind_(key) {
  var k = String(key || "");
  if (k.indexOf("sb_secret_") === 0) return "secret (새 형식)";
  if (k.indexOf("sb_publishable_") === 0) return "anon";
  if (k.indexOf("eyJ") === 0) {
    try {
      var parts = k.split(".");
      if (parts.length >= 2) {
        var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        var json = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString();
        if (/"role"\s*:\s*"service_role"/.test(json)) return "service_role";
        if (/"role"\s*:\s*"anon"/.test(json)) return "anon";
      }
    } catch (e) {}
    return "JWT (역할 불명)";
  }
  return "알 수 없음";
}

/**
 * ══════════════════════════════════════════════════════════════
 *  [메뉴] 기존 Supabase → v2 이력 복사 (1회성)
 *  파일: _partnerSupabaseV2Mirror.gs
 *
 *  미러는 **앞으로** 들어오는 것만 v2 에 넣는다. 이미 기존 프로젝트에
 *  쌓여 있는 이력은 안 넘어간다. 그래서 화면이 오늘 밤까지 비어 있다.
 *
 *  여기서 기존 daily_archive 를 읽어 v2 로 한 번 옮긴다.
 *    · 읽기만 한다 (기존 프로젝트는 안 건드린다)
 *    · v2 는 upsert 라 몇 번 돌려도 중복이 안 쌓인다
 *    · 6분 제한이 있으므로 날짜를 나눠 돌린다. 중단돼도 이어서 하면 된다.
 *
 *  @param {number=} optDays 최근 며칠치. 기본 30
 * ══════════════════════════════════════════════════════════════
 */
function partnerBackfillV2FromLegacy(optDays) {
  var days = parseInt(optDays, 10) || 30;
  var started = new Date().getTime();
  var BUDGET = 300000; // 5분 — 6분 한도 앞에서 멈춘다
  var L = ["═══ 기존 → v2 이력 복사 (최근 " + days + "일) ═══",
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"), ""];

  try {
    if (!_sbv2_enabled_()) {
      L.push("★ v2 미러가 꺼져 있습니다. 키를 먼저 넣으세요.");
      return _sbv2_out_(L);
    }
    var srcKey = _sb_getKey_();
    if (!srcKey) { L.push("★ 기존 프로젝트 키가 없습니다."); return _sbv2_out_(L); }

    var moved = 0, read = 0, dayDone = 0, stopped = "", upErrs = [];
    for (var d = 0; d <= days; d++) {
      if (new Date().getTime() - started > BUDGET) {
        stopped = "시간이 다 돼 " + dayDone + "일치까지만 옮겼습니다. 다시 실행하면 이어서 합니다.";
        break;
      }
      var dt = new Date();
      dt.setDate(dt.getDate() - d);
      var ds = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd");

      // 하루치를 나눠 읽는다 — 한 번에 다 부르면 응답이 잘린다
      var offset = 0, dayRows = 0;
      while (true) {
        var url = _SB_URL + "/rest/v1/daily_archive?archive_date=eq." + ds +
          "&select=*&limit=1000&offset=" + offset;
        var r = UrlFetchApp.fetch(url, {
          headers: { "apikey": srcKey, "Authorization": "Bearer " + srcKey },
          muteHttpExceptions: true,
        });
        if (r.getResponseCode() !== 200) {
          L.push("  ★ " + ds + " 읽기 실패: " + r.getContentText().substring(0, 120));
          break;
        }
        var rows = JSON.parse(r.getContentText() || "[]");
        if (!rows.length) break;
        read += rows.length;

        // 기존 표의 id·synced_at 은 빼고 넘긴다 — v2 가 자기 것을 만든다
        var payload = rows.map(function (x) {
          return {
            legacy_id: x.id,          // 원본 id — 이력 복사의 유일키
            archive_date: x.archive_date,
            recorded_at: x.recorded_at || null,
            source: x.source || null,
            order_type: x.order_type || null,
            order_no: x.order_no || "",
            recipient: x.recipient || null,
            phone: x.phone || null,
            mobile: x.mobile || null,
            address: x.address || null,
            ecount_code: x.ecount_code || "",
            item_name: x.item_name || "",
            qty: parseInt(x.qty, 10) || 0,
            delivery_msg: x.delivery_msg || null,
            invoice_no: x.invoice_no || null,
            vendor_or_seller: x.vendor_or_seller || null,
            vendor_name: x.vendor_name || null,
            shipping_fee: parseFloat(x.shipping_fee) || 0,
            unit_price: parseFloat(x.unit_price) || 0,
            settle_amount: parseFloat(x.settle_amount) || 0,
            note: x.note || null,
          };
        });
        var out = _sbv2_upsert_("daily_archive", payload, "legacy_id");
        // ★ 실패 사유를 모아 둔다 ★
        //   전에는 옮긴 수만 보여줘서 "읽음 28717 · 옮김 0" 이 왜 그런지
        //   알 수 없었다. 조용한 실패가 제일 나쁘다.
        if (out.errors && out.errors.length) {
          for (var ei = 0; ei < out.errors.length && upErrs.length < 3; ei++) {
            if (upErrs.indexOf(out.errors[ei]) === -1) upErrs.push(out.errors[ei]);
          }
        }
        moved += out.count;
        dayRows += out.count;
        if (rows.length < 1000) break;
        offset += 1000;
      }
      if (dayRows) L.push("  " + ds + "  " + dayRows + "건");
      dayDone = d;
    }

    L.push("");
    L.push("읽음 " + read + "행 · 옮김 " + moved + "행");
    if (upErrs.length) {
      L.push("");
      L.push("★ 적재 거부 사유:");
      for (var ue = 0; ue < upErrs.length; ue++) L.push("  " + upErrs[ue]);
    }
    if (stopped) { L.push(""); L.push("⏳ " + stopped); }
    if (!read) {
      L.push("");
      L.push("기존 프로젝트에도 그 기간 데이터가 없습니다.");
      L.push("daily_archive 동기화는 2026-07-04 부터입니다.");
    }
  } catch (e) {
    L.push("★ 실패: " + e.message);
  }
  return _sbv2_out_(L);
}
