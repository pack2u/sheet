/** 메일 명세서 → v2 — 첨부 고르기 · 시각 창 (2026-10-16)   실행: node _psm_test.js */
var fs = require("fs"), path = require("path");
var src = fs.readFileSync(path.join(__dirname, "_partnerStatementMailV2.gs"), "utf8");
(0, eval)(src.replace(/^var _PSM_/gm, "var _PSM_"));
var 통과 = 0, 실패 = 0;
function ok(n, c, d) { if (c) { 통과++; console.log("  ok   " + n); } else { 실패++; console.log("  FAIL " + n + (d ? " — " + d : "")); } }
console.log("[1] 첨부 고르기");
ok("비즈메일 JPG(octet-stream) 는 명세서", _psm_isStatementFile_("BIZMAIL_4_20261016A00000000083_1.JPG", "application/octet-stream", 180000));
ok("PDF 는 명세서", _psm_isStatementFile_("명세표.pdf", "application/pdf", 50000));
ok("엑셀은 작아도 명세서", _psm_isStatementFile_("9월 팩투유(더조은팩).xlsx", "application/octet-stream", 9000));
ok("서명 그림(작은 png)은 아님", !_psm_isStatementFile_("sign.png", "image/png", 3000));
ok("zip 은 아님", !_psm_isStatementFile_("a.zip", "application/zip", 90000));
ok("JPG 형식 고침", _psm_mimeFor_("X.JPG", "application/octet-stream") === "image/jpeg");
console.log(실패 ? "★ 실패 " + 실패 + " / 통과 " + 통과 : "모두 통과 (" + 통과 + "건)");
process.exit(실패 ? 1 : 0);
