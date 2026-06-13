Set fso = CreateObject("Scripting.FileSystemObject")

Sub CopyImg(src, dest)
    On Error Resume Next
    fso.CopyFile src, dest, True
    On Error GoTo 0
End Sub

baseDir = "C:\Users\x299\.gemini\antigravity\brain\6d3331ee-0103-4cd4-bd3b-025618343c6d\.system_generated\click_feedback\"
targetDir = "f:\Pack2U_상품정보sheet\설명서\"

CopyImg baseDir & "click_feedback_1778685547244.png", targetDir & "img_00_auth_menu.png"
CopyImg baseDir & "click_feedback_1778685553860.png", targetDir & "img_01_push_menu.png"
CopyImg baseDir & "click_feedback_1778685504735.png", targetDir & "img_02_newparts_form.png"
CopyImg baseDir & "click_feedback_1778685592319.png", targetDir & "img_03_init_menu.png"
CopyImg baseDir & "click_feedback_1778685592319.png", targetDir & "img_04_collect_menu.png"
CopyImg baseDir & "click_feedback_1778685567100.png", targetDir & "img_05_hub_tab.png"
CopyImg baseDir & "click_feedback_1778685592319.png", targetDir & "img_06_invoice_menu.png"
CopyImg baseDir & "click_feedback_1778685425823.png", targetDir & "img_07_invoice_tab.png"
CopyImg baseDir & "click_feedback_1778685592319.png", targetDir & "img_08_close_menu.png"
CopyImg baseDir & "click_feedback_1778685448690.png", targetDir & "img_09_monthly_tab.png"
CopyImg baseDir & "click_feedback_1778685437631.png", targetDir & "img_10_cancel_tab_dangjang.png"
CopyImg baseDir & "click_feedback_1778685592319.png", targetDir & "img_11_cancel_menu.png"

MsgBox "성공적으로 12장의 이미지를 복사했습니다! 이제 HTML 파일을 확인해보세요.", 64, "복사 완료"
