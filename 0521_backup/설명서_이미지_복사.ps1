# 설명서 파일 정리 스크립트
# PowerShell에서 실행: .\설명서_이미지_복사.ps1

$srcDir = "C:\Users\x299\.gemini\antigravity\brain\efeb8eef-51ed-4bb6-bae3-02a3b7713efd"
$projDir = "f:\Pack2U_상품정보sheet"
$dstDir = "$projDir\설명서"

# 설명서 폴더 생성
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null

# 이미지 복사
Copy-Item "$srcDir\partner_management_menu_open_1778634068843.png" "$dstDir\partner_menu.png"
Copy-Item "$srcDir\partner_order_hub_content_1778634104544.png" "$dstDir\partner_hub.png"
Copy-Item "$srcDir\partner_management_submenu_1_8_1778635349639.png" "$dstDir\partner_submenu.png"

# HTML 파일 이동
Move-Item "$projDir\20260513_협력업체시스템_설명서.html" "$dstDir\20260513_협력업체시스템_설명서.html" -Force

Write-Host ""
Write-Host "완료! 설명서 폴더 구성:" -ForegroundColor Green
Write-Host "  $dstDir\"
Write-Host "    ├── 20260513_협력업체시스템_설명서.html"
Write-Host "    ├── partner_menu.png"
Write-Host "    ├── partner_hub.png"
Write-Host "    └── partner_submenu.png"
Write-Host ""
Write-Host "서버 업로드 시 '설명서' 폴더 전체를 올리면 됩니다." -ForegroundColor Yellow
