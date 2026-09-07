/**
 * ══════════════════════════════════════════════════════════════
 *  사진 저장 현황 — 지금 Drive 에 얼마나 쌓였나
 *  ★ 2026-09-08 신규
 *
 *  왜 필요한가
 *    반품 입고 사진과 보드 첨부는 지금 **Drive 에** 쌓이고 있다.
 *    Supabase 로 옮길지, 옮긴다면 얼마나 드는지를 정하려면 **실제 양**이
 *    있어야 한다. 짐작으로 「몇 GB 쯤」이라고 하면 그 위에 쌓는 결정도 다 짐작이 된다.
 *
 *    그리고 지금 폰 원본이 그대로 올라간다 — 올리기 전에 줄이는 코드가 없다.
 *    장당 평균 크기를 보면 그게 실제로 문제인지 아닌지가 바로 나온다.
 *
 *  쓰는 법
 *    csAuditPhotoStorage 를 ▶ 실행. 읽기만 한다. 아무것도 안 지우고 안 만든다.
 *
 *  ⚠ 파일이 많으면 몇 분 걸린다. 6분을 넘으면 중간까지의 결과를 로그에 남긴다.
 * ══════════════════════════════════════════════════════════════
 */

/** 한 번 실행에서 훑을 최대 파일 수 — 6분 제한에 걸리지 않게 */
var _CSA_MAX_FILES_ = 20000;

function csAuditPhotoStorage() {
  var started = new Date().getTime();
  var out = [];

  out.push("── 사진 저장 현황 (Drive) ──");
  out.push("잰 시각  " + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm"));
  out.push("");

  var targets = [];

  // 반품 입고 사진 — 스크립트 속성에 폴더 ID 가 저장돼 있다
  try {
    var attId = String(PropertiesService.getScriptProperties()
      .getProperty(_CS_ATT_FOLDER_PROP_) || "").trim();
    if (attId) targets.push({ label: _CS_ATT_FOLDER_NAME_, id: attId });
    else targets.push({ label: _CS_ATT_FOLDER_NAME_, name: _CS_ATT_FOLDER_NAME_ });
  } catch (e) {
    targets.push({ label: _CS_ATT_FOLDER_NAME_, name: _CS_ATT_FOLDER_NAME_ });
  }

  // 보드 첨부 — 이름으로 찾는다
  targets.push({ label: _CS_HB_ATT_FOLDER_NAME_, name: _CS_HB_ATT_FOLDER_NAME_ });
  targets.push({ label: _CS_HB_ATT_FOLDER_LEGACY_ + " (옛 이름)", name: _CS_HB_ATT_FOLDER_LEGACY_ });

  var grandFiles = 0, grandBytes = 0;

  for (var t = 0; t < targets.length; t++) {
    var tg = targets[t];
    var folder = null;
    try {
      if (tg.id) {
        folder = DriveApp.getFolderById(tg.id);
      } else {
        var it = DriveApp.getFoldersByName(tg.name);
        if (it.hasNext()) folder = it.next();
      }
    } catch (eF) {}

    if (!folder || folder.isTrashed()) {
      out.push("  " + tg.label + "  — 폴더 없음");
      continue;
    }

    var files = folder.getFiles();
    var n = 0, bytes = 0, oldest = null, newest = null;
    var byMonth = {};

    while (files.hasNext() && n < _CSA_MAX_FILES_) {
      if (new Date().getTime() - started > 5 * 60 * 1000) {
        out.push("  ⚠ 5분이 넘어 중간에 멈췄습니다. 아래는 여기까지의 합계입니다.");
        break;
      }
      var f = files.next();
      n++;
      var sz = 0;
      try { sz = f.getSize(); } catch (eS) {}
      bytes += sz;

      var d = null;
      try { d = f.getDateCreated(); } catch (eD) {}
      if (d) {
        if (!oldest || d < oldest) oldest = d;
        if (!newest || d > newest) newest = d;
        var mk = Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM");
        if (!byMonth[mk]) byMonth[mk] = { n: 0, b: 0 };
        byMonth[mk].n++;
        byMonth[mk].b += sz;
      }
    }

    grandFiles += n;
    grandBytes += bytes;

    out.push("  " + tg.label);
    out.push("    파일   " + n.toLocaleString() + "개");
    out.push("    용량   " + _csa_mb_(bytes));
    out.push("    평균   " + (n ? _csa_mb_(bytes / n) : "-") + " / 장");
    if (oldest && newest) {
      out.push("    기간   " +
        Utilities.formatDate(oldest, "Asia/Seoul", "yyyy-MM-dd") + " ~ " +
        Utilities.formatDate(newest, "Asia/Seoul", "yyyy-MM-dd"));
    }

    var months = [];
    for (var mk2 in byMonth) if (byMonth.hasOwnProperty(mk2)) months.push(mk2);
    months.sort();
    if (months.length) {
      out.push("    월별");
      for (var i = 0; i < months.length; i++) {
        var m = byMonth[months[i]];
        out.push("      " + months[i] + "   " +
          String(m.n).padStart(5) + "장   " + _csa_mb_(m.b));
      }
    }
    out.push("");
  }

  out.push("── 합계 ──");
  out.push("  파일 " + grandFiles.toLocaleString() + "개 · " + _csa_mb_(grandBytes));
  if (grandFiles) {
    var avg = grandBytes / grandFiles;
    out.push("  평균 " + _csa_mb_(avg) + " / 장");
    out.push("");
    out.push("  ※ 올리기 전에 줄이면(긴 변 1600px, 품질 0.8) 장당 0.25MB 안팎이 된다.");
    out.push("     지금 평균이 그보다 크면 그 배수만큼 저장·전송이 낭비되고 있는 것이다.");
    if (avg > 0.5 * 1024 * 1024) {
      out.push("     → 지금은 약 " + (avg / (0.25 * 1024 * 1024)).toFixed(1) + "배.");
    }
  }

  var text = out.join("\n");
  Logger.log(text);
  return text;
}

function _csa_mb_(bytes) {
  if (!bytes) return "0MB";
  var mb = bytes / (1024 * 1024);
  if (mb >= 1024) return (mb / 1024).toFixed(2) + "GB";
  if (mb >= 1) return mb.toFixed(1) + "MB";
  return (bytes / 1024).toFixed(0) + "KB";
}
