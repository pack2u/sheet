/**
 * ██████████████████████████████████████████████████████████████
 *
 *  ⛔ 폐기된 시스템 (DEPRECATED) - 절대 사용/수정 금지 ⛔
 *
 *  파일명: _partnerInvoiceScript.gs
 *  용도: 업체별 독립 바운드 스크립트로 카카오 송장매칭을 배포하던 시스템
 *
 *  ★★★ 이 파일은 "독립배포 시스템"입니다 ★★★
 *  ★★★ 현재 협력업체 시스템과 완전히 별개입니다 ★★★
 *
 *  폐기 이유:
 *    1. Google Apps Script API 별도 활성화 필요 (Cloud Console)
 *    2. 권한 승인 문제 반복 발생
 *    3. 업체별 독립 바운드 스크립트 생성 시 onOpen 충돌 발생
 *    4. 중앙 사이드바 방식으로 완전 대체됨
 *
 *  현재 사용 방식 (중앙 관리):
 *    중앙 시트 메뉴 → "📬 카카오 송장매칭 (중앙 관리용)" → openInvoiceMatchSidebar()
 *    → 업체 선택 → 카카오 텍스트 붙여넣기 → 전용양식에 직접 기입
 *
 *  ★ 정리 이력:
 *    2026-06-13  코드 본체 전량 제거 (stub만 유지)
 *               - 원본 백업: backup_20260613/_partnerInvoiceScript.gs
 *               - 제거 함수: _pt_installInvoiceMatchScript_, _pt_buildInvoiceMatchGsCode_,
 *                            _pt_buildInvoiceMatchHtml_, authTrigger, diagScriptApi,
 *                            simpleAuth, partnerInstallInvoiceMatchSidebarAllDirect
 *               - 검증: 현재 시스템의 어떤 파일에서도 이 함수들을 호출하지 않음 확인
 *
 * ██████████████████████████████████████████████████████████████
 */


/**
 * [DEPRECATED] Script API 배포 방식 — 더 이상 사용하지 않습니다.
 * 중앙 메뉴의 "📬 카카오 송장매칭 (중앙 관리용)"을 사용하세요.
 *
 * ★ 이 함수는 혹시 메뉴에서 직접 호출될 경우를 대비한 안내용 stub입니다.
 */
function partnerInstallInvoiceMatchSidebarAll() {
  SpreadsheetApp.getUi().alert(
    '⚠️ 이 기능은 더 이상 사용하지 않습니다.\n\n' +
    '대신 메뉴에서:\n' +
    '💼 협력업체 관리 → 📦 대리발송 발주시스템(New)\n' +
    '→ 📬 카카오 송장매칭 (중앙 관리용)\n\n' +
    '을 사용하면 업체 선택 후 바로 송장 기입이 가능합니다.'
  );
}