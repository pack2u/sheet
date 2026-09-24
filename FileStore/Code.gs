/**
 * ══════════════════════════════════════════════════════════════
 *  팩투유 파일보관소 — 업로드를 «회사 계정»으로 대신 해 준다
 *  ★ 2026-09-10 신규
 *
 *  > "회사 계정의 드라이브에 저장이 되야지..."
 *
 *  ★ 왜 프로젝트를 따로 두나 ★
 *    CS 웹앱은 «접속한 사람» 권한으로 돈다(executeAs USER_ACCESSING).
 *    누가 들어왔는지 알아야 권한을 막을 수 있어서 그건 바꿀 수 없다.
 *    그런데 구글은 **파일을 만든 사람이 곧 소유자**라, 김진수 씨가 올리면
 *    그 사진은 김진수 씨 개인 지메일 소유가 되고 그 사람 15GB 를 쓴다.
 *
 *    실제로 그렇게 쌓여 있었다 (2026-09-10 확인):
 *      반품 사진   — 2주치 전부 jskim721210@gmail.com 소유
 *      보드 첨부   — 폴더 자체가 rkdtjgml486@gmail.com 개인 드라이브,
 *                   안의 파일은 개인 계정 다섯 곳에 흩어짐
 *
 *    직원이 계정을 정리하면 **반품대장의 사진 링크가 통째로 죽는다.**
 *    반품비를 다툴 때 근거로 쓰는 사진이다.
 *
 *    소유권 이전(setOwner)은 구글이 막는다 — 개인 지메일에서 회사 도메인으로는
 *    안 넘어간다. 공유 드라이브가 제일 깔끔한데 요금제에서 만들기가 잠겨 있었다.
 *    그래서 **업로드만 떼어 회사 계정으로 돌린다.**
 *
 *    이 웹앱은 executeAs USER_DEPLOYING — 즉 **언제나 pack2u 권한**으로 돈다.
 *    누가 부르든 만들어지는 파일의 소유자는 pack2u 다.
 *
 *  ★ 문을 여는 열쇠 ★
 *    access 가 ANYONE_ANONYMOUS 라 주소만 알면 누구나 부를 수 있다.
 *    그래서 토큰을 본다. 토큰은 _secrets.gs 에 두고 저장소에는 안 넣는다
 *    (.gitignore). 새어 나가면 남의 드라이브에 파일을 만들 수 있게 된다.
 *    같은 값이 CS_WebApp/_secrets.gs 에도 있다 — 그쪽이 부른다.
 *
 *  ★ 폴더는 코드에 적는다 ★
 *    비밀이 아니고, 어디에 쌓이는지는 읽어서 알 수 있어야 한다.
 *    오늘 세트분리에서 「속성이 코드를 이겨 조용히 딴 데를 보던」 일을 겪었다.
 *    옮길 일이 생기면 FS_ROOT_FOLDER_ID 만 고쳐 다시 올린다.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * 받은 파일을 담는 자리 — 팩투유 「내 드라이브」의 「웹앱_이미지」.
 * 2026-09-10 사장님이 만들어 주신 폴더다.
 *
 * ★ 코드에 적는다 ★
 *   비밀도 아니고, 어디에 쌓이는지는 **읽어서 알 수 있어야** 한다.
 *   오늘 세트분리에서 「속성이 코드를 이겨서 조용히 딴 데를 보던」 일을 겪었다.
 *   폴더를 옮기게 되면(공유 드라이브가 열리면) 여기만 고쳐 다시 올리면 된다.
 */
var FS_ROOT_FOLDER_ID = "1yLoV6oZnPTmu7VY8gDcWrd4iIe7QQGRM";

/** 쓰임새별 하위 폴더. 없으면 처음 쓸 때 만든다 — 사람이 미리 만들 일이 없다. */
var FS_SUBFOLDER = {
  "return": "반품사진",
  "board": "보드첨부"
};
var FS_SUBFOLDER_ETC = "기타";

/** 토큰을 담는 속성 이름 (_secrets.gs 가 없을 때의 뒷길) */
var FS_TOKEN_PROP = "FS_TOKEN";

/** 한 번에 받을 수 있는 크기. CS 웹앱 쪽 제한(12MB)보다 넉넉히 둔다. */
/* ★ 2026-09-11: 20MB → 25MB ★ 송장 사진을 크게 받기로 했다. */
var FS_MAX_BYTES = 25 * 1024 * 1024;

function _fs_json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function _fs_prop_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || "").trim();
}

/** 토큰. _secrets.gs 가 먼저, 없으면 스크립트 속성. */
function _fs_token_() {
  try { if (typeof FS_TOKEN_ !== "undefined" && FS_TOKEN_) return String(FS_TOKEN_); } catch (e) {}
  return _fs_prop_(FS_TOKEN_PROP);
}

/**
 * 쓰임새 → 폴더. 뿌리 폴더 아래 하위 폴더를 쓰고, 없으면 만든다.
 *
 * ★ 못 열면 던진다 ★
 *   조용히 다른 데 만들지 않는다. 엉뚱한 곳에 쌓이면 나중에
 *   「사진이 어디 갔지」가 되고, 그때는 이미 수백 장이다.
 */
function _fs_folder_(kind) {
  var root;
  try {
    root = DriveApp.getFolderById(FS_ROOT_FOLDER_ID);
  } catch (e) {
    throw new Error("보관 폴더를 열 수 없습니다 (" + FS_ROOT_FOLDER_ID + ") — " + e.message);
  }
  if (!root || root.isTrashed()) throw new Error("보관 폴더가 휴지통에 있습니다");

  var name = FS_SUBFOLDER[String(kind || "")] || FS_SUBFOLDER_ETC;
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

/**
 * 파일을 만든다.
 *
 * @param {Object} e  POST 본문 {token, kind, name, mimeType, dataB64, share}
 * @return {{ok:boolean, fileId:string, url:string, owner:string, error:string}}
 */
function doPost(e) {
  try {
    var body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    } catch (eJ) {
      return _fs_json_({ ok: false, error: "본문을 읽지 못했습니다" });
    }

    var want = _fs_token_();
    if (!want) return _fs_json_({ ok: false, error: "보관소에 토큰이 설정되지 않았습니다" });
    if (String(body.token || "") !== want) {
      return _fs_json_({ ok: false, error: "토큰이 맞지 않습니다" });
    }

    var b64 = String(body.dataB64 || "");
    if (!b64) return _fs_json_({ ok: false, error: "파일 내용이 없습니다" });

    var bytes;
    try {
      bytes = Utilities.base64Decode(b64);
    } catch (eD) {
      return _fs_json_({ ok: false, error: "파일을 읽을 수 없습니다" });
    }
    if (bytes.length > FS_MAX_BYTES) {
      return _fs_json_({
        ok: false,
        error: "파일이 너무 큽니다 (" + Math.round(bytes.length / 1024 / 1024 * 10) / 10 + "MB)"
      });
    }

    var folder = _fs_folder_(body.kind);
    var name = String(body.name || "").trim() || ("파일_" +
      Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMdd_HHmmss"));
    var mime = String(body.mimeType || "application/octet-stream");

    var file = folder.createFile(Utilities.newBlob(bytes, mime, name));

    /* 링크를 아는 사람은 보게 — 화면의 썸네일이 그 링크로 뜬다.
       실패해도 파일은 이미 만들어졌으므로 막지 않는다. */
    if (body.share !== false) {
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (eS) {
        Logger.log("[보관소] 공유 설정 실패(무시): " + eS.message);
      }
    }

    return _fs_json_({
      ok: true,
      fileId: file.getId(),
      fileName: file.getName(),
      url: file.getUrl(),
      /* 부르는 쪽이 «정말 회사 소유로 만들어졌는지» 확인할 수 있게 돌려준다.
         이 값이 개인 계정이면 이 프로젝트가 제 일을 못 하고 있는 것이다. */
      owner: Session.getEffectiveUser().getEmail()
    });
  } catch (err) {
    return _fs_json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** 살아 있는지만 본다. 토큰이 필요 없다 — 아무것도 안 알려 주기 때문이다. */
function doGet() {
  return _fs_json_({ ok: true, service: "팩투유 파일보관소" });
}

/**
 * ── 상태 보기 (편집기에서 ▶ 실행) ──────────────────────────
 * 토큰·폴더·실행 계정을 한 번에 본다. 아무것도 바꾸지 않는다.
 *
 * ★ 처음 한 번은 이걸 실행해 주셔야 한다 ★
 *   executeAs USER_DEPLOYING 웹앱은 **소유자가 권한을 승인한 뒤에야** 돈다.
 *   이 함수를 한 번 실행하면 그 승인 창이 뜨고, 승인하면 그다음부터
 *   웹앱이 pack2u 권한으로 파일을 만들 수 있다.
 */
function fsStatus() {
  var out = ["팩투유 파일보관소", ""];
  out.push("실행 계정  " + Session.getEffectiveUser().getEmail());
  out.push("토큰       " + (_fs_token_() ? "있음" : "★ 없음"));
  try {
    var root = DriveApp.getFolderById(FS_ROOT_FOLDER_ID);
    out.push("보관 폴더  " + root.getName() + "  (" + root.getUrl() + ")");
    out.push("  하위      " + _fs_folder_("return").getName() + " · " + _fs_folder_("board").getName());
  } catch (e) {
    out.push("보관 폴더  ★ " + e.message);
  }
  var msg = out.join(String.fromCharCode(10));
  Logger.log(msg);
  return msg;
}
