/**
 * ══════════════════════════════════════════════════════════════
 *  v2 업체 화면 → 이 포털 — 문 하나 (doPost)        2026-10-27
 *  파일: prpV2.gs      v2 쪽: app/src/lib/portal-gas.ts · /v/returns
 *
 *  > 사장님: "당장드림 반품 포털도 v2 반품 탭으로 옮겨줘 그리고 기존 데이타와 연동이 될수 있게 해줘"
 *
 *  v2 는 반품관리대장에 쓸 권한이 없다(읽기만). 그래서 v2 업체 화면이 누르는 일은 **이 포털의 함수를 그대로** 부른다.
 *  쓰는 길이 둘이 되지 않는다 — 접수 행 만들기·출처 확인·중복 확인·문의 줄·회수 표시·사진 보관은 전부 여기 있던 코드.
 *  여기는 «문» 만 더한다:
 *    ① 열쇠 — 본문 token 이 _secrets.gs V2_INGEST_TOKEN(= v2 STATEMENT_INGEST_TOKEN)과 같아야 한다 (GAS doPost 는 머리를 못 읽는다)
 *    ② 업체 — v2 가 보낸 업체 이름으로 이 포털 계정(협력업체포털_계정 탭)을 찾는다. 없으면 이름·별칭으로 세션을 만든다
 *       (토큰 링크가 없는 업체도 v2 링크로 들어오면 같은 장부를 본다)
 *    ③ 세션을 만들어 원래 함수에 넘긴다 — 함수 안의 업체 거르기·소유 확인(prpOpenOwnedRow_)이 그대로 돈다
 *  ★ 업체 이름은 v2 가 정한다 ★ — v2 는 자기 업체 링크(토큰)로 업체를 확인한 뒤에만 이 문을 부른다.
 * ══════════════════════════════════════════════════════════════
 */

function prpV2Json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function prpV2TokenOk_(given) {
  var want = "";
  try { if (typeof V2_INGEST_TOKEN !== "undefined" && V2_INGEST_TOKEN) want = String(V2_INGEST_TOKEN); } catch (e) {}
  var g = String(given || "");
  if (!want || !g || want.length !== g.length) return false;
  var diff = 0;
  for (var i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ g.charCodeAt(i);
  return diff === 0;
}

/** v2 업체 → 이 포털 세션 재료 {vendor, key, prefix, aliases} */
function prpV2Account_(v) {
  v = v || {};
  var name = String(v.name || "").trim();
  if (!name) return null;
  var key = prpVendorKey_(name);
  var 별 = (v.aliases || []).map(function (a) { return prpVendorKey_(a); }).filter(function (a) { return a; });
  try {
    var all = prpLoadAccounts_(false) || [];
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      if (a.active === false) {
        if (a.key === key) return null;     // 꺼 둔 계정 — 이름으로 새 세션을 만들어 우회하지 않는다
        continue;
      }
      if (a.key === key || 별.indexOf(a.key) >= 0) return { vendor: a.vendor, key: a.key, prefix: a.prefix, aliases: a.aliases || [] };
    }
  } catch (e) {}
  return { vendor: name, key: key, prefix: String(v.prefix || ""), aliases: 별 };
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (x) { return prpV2Json_({ ok: false, error: "본문을 못 읽었습니다" }); }
  if (!prpV2TokenOk_(body.token)) return prpV2Json_({ ok: false, error: "열쇠가 맞지 않습니다" });
  var acct = prpV2Account_(body.vendor);
  if (!acct) return prpV2Json_({ ok: false, error: "업체가 없습니다" });
  var sid = prpIssueSession_(acct);
  if (!sid) return prpV2Json_({ ok: false, error: "세션을 못 만들었습니다" });
  var d = body.data || {};
  var r;
  try {
    switch (String(body.op || "")) {
      case "bootstrap": r = prpBootstrap(sid); break;
      case "mine": r = prpMyReturns(sid, d); break;
      case "fee": r = prpFeeSummary(sid, d); break;
      case "lookupUid": r = prpLookupByUid(sid, d.uid); break;
      case "lookupInvoice": r = prpLookupByInvoice(sid, d.invoice); break;
      case "submit": r = prpSubmitReturn(sid, d); break;
      case "photos": r = prpAttachPhotos(sid, d); break;
      case "inquiry": r = prpAddInquiry(sid, d); break;
      case "pickup": r = prpRequestPickup(sid, d); break;
      default: r = { ok: false, error: "모르는 일: " + body.op };
    }
  } catch (err) {
    r = { ok: false, error: (err && err.message) || String(err) };
  }
  try { prpLog_(acct.vendor, "v2", String(body.op || "") + (r && r.ok === false ? " ✗ " + String(r.error || "").substring(0, 60) : "")); } catch (eL) {}
  return prpV2Json_(r || { ok: false, error: "빈 답" });
}
