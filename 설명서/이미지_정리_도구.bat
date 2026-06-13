@echo off
setlocal enabledelayedexpansion

:: 1. 원본 이미지 경로 (이전 대화의 브레인 폴더)
set "SRC_DIR=C:\Users\x299\.gemini\antigravity\brain\6d3331ee-0103-4cd4-bd3b-025618343c6d\.system_generated\click_feedback"
set "DST_DIR=%~dp0"

echo [Pack2U 설명서 이미지 정리 도구]
echo.
echo 원본 경로: !SRC_DIR!
echo 대상 경로: !DST_DIR!
echo.

:: 2. 매핑 리스트 복사 및 이름 변경
call :CopyImage "click_feedback_1778685547244.png" "01_권한승인_메뉴.png"
call :CopyImage "click_feedback_1778685553860.png" "02_대리발주_푸시_메뉴.png"
call :CopyImage "click_feedback_1778685504735.png" "03_뉴파츠_전용양식.png"
call :CopyImage "click_feedback_1778685592319.png" "04_대리발송_초기화_메뉴.png"
call :CopyImage "click_feedback_1778685592319.png" "05_발주수집_메뉴.png"
call :CopyImage "click_feedback_1778685567100.png" "06_협력업체_발주허브.png"
call :CopyImage "click_feedback_1778685592319.png" "07_송장수집배포_메뉴.png"
call :CopyImage "click_feedback_1778685425823.png" "08_발주및송장조회_탭.png"
call :CopyImage "click_feedback_1778685592319.png" "09_월별마감이동_메뉴.png"
call :CopyImage "click_feedback_1778685448690.png" "10_발주마감_탭.png"
call :CopyImage "click_feedback_1778685437631.png" "11_취소반품접수_탭.png"
call :CopyImage "click_feedback_1778685592319.png" "12_취소반품수집_메뉴.png"

echo.
echo [작업 완료] 이미지 파일들이 정리되었습니다.
pause
exit /b

:CopyImage
set "src_file=!SRC_DIR!\%~1"
set "dst_file=!DST_DIR!\%~2"

if exist "!src_file!" (
    copy /y "!src_file!" "!dst_file!" >nul
    echo [성공] %~2
) else (
    echo [실패] 원본 파일을 찾을 수 없음: %~1
)
goto :eof
