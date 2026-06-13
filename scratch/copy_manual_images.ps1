$srcBase = "C:\Users\x299\.gemini\antigravity\brain\6d3331ee-0103-4cd4-bd3b-025618343c6d\.system_generated\click_feedback"
$dstDir = "f:\Pack2U_상품정보sheet\설명서"

if (!(Test-Path $dstDir)) {
    New-Item -ItemType Directory -Path $dstDir
}

$mapping = @{
    "01_권한승인_메뉴.png" = "click_feedback_1778685547244.png"
    "02_대리발주_푸시_메뉴.png" = "click_feedback_1778685553860.png"
    "03_뉴파츠_전용양식.png" = "click_feedback_1778685504735.png"
    "04_대리발송_초기화_메뉴.png" = "click_feedback_1778685592319.png"
    "05_발주수집_메뉴.png" = "click_feedback_1778685592319.png"
    "06_협력업체_발주허브.png" = "click_feedback_1778685567100.png"
    "07_송장수집배포_메뉴.png" = "click_feedback_1778685592319.png"
    "08_발주및송장조회_탭.png" = "click_feedback_1778685425823.png"
    "09_월별마감이동_메뉴.png" = "click_feedback_1778685592319.png"
    "10_발주마감_탭.png" = "click_feedback_1778685448690.png"
    "11_취소반품접수_탭.png" = "click_feedback_1778685437631.png"
    "12_취소반품수집_메뉴.png" = "click_feedback_1778685592319.png"
}

foreach ($dest in $mapping.Keys) {
    $srcFile = Join-Path $srcBase $mapping[$dest]
    $destFile = Join-Path $dstDir $dest
    if (Test-Path $srcFile) {
        Copy-Item -Path $srcFile -Destination $destFile -Force
        Write-Host "Copied $dest" -ForegroundColor Green
    } else {
        Write-Host "Source not found: $srcFile" -ForegroundColor Red
    }
}
