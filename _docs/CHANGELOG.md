# 변경 이력 로그

## 2026-06-14 00:48 — Gemini API 키 GitHub 유출 방지 조치

### 변경 내용
1. **`_secrets.gs` 생성**: 모든 API 키를 이 파일에서 중앙 관리. `.gitignore`에 등록하여 GitHub 업로드 차단.
2. **`_secrets.gs.template` 생성**: 신규 클론 시 참고할 수 있는 템플릿 (플레이스홀더 키).
3. **`.gitignore` 생성**: `_secrets.gs`, 백업 폴더, 바이너리 파일 등을 Git 추적에서 제외.
4. **pre-commit hook 설치**: 커밋 시 `AIzaSy...` 또는 `AQ.Ab...` 패턴의 API 키를 자동 감지하여 커밋 차단.
5. **기존 파일에서 하드코딩된 키 제거**:
   - `geminiChat.gs` (5행): 키 제거 → `_secrets.gs` 전역 변수 참조
   - `CS_WebApp/Code.gs` (404행): 키 제거 → `GEMINI_API_KEY` 전역 변수 참조
   - `InvoiceMatch_협력업체용.gs` (239행): 키 제거 → `GEMINI_API_KEY` 전역 변수 참조
   - `카카오챗봇_설치파일/3_협력업체_송장매칭_복사용.gs` (232행): 키 제거 → `GEMINI_API_KEY` 전역 변수 참조
   - `카카오챗봇_설치파일/1_chatbot_gemini_백엔드복사용.txt` (2행): 플레이스홀더로 대체

### 동작 원리
- Google Apps Script에서 모든 `.gs` 파일은 같은 프로젝트에 로드되므로, `_secrets.gs`에 정의된 `GEMINI_API_KEY` 전역 변수를 다른 모든 파일에서 참조 가능.
- `_secrets.gs`는 `.gitignore`에 의해 GitHub에 절대 올라가지 않음.
- pre-commit hook이 실수로 키를 하드코딩한 경우에도 커밋을 자동 차단함.

---

## 2026-06-14 00:42 — Gemini API 키 변경

### 변경 내용
- 이전 키 `AIzaSy****` → 새 키로 5개 파일 교체
