import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

# Manual mapping: current_line_num -> backup_line_num (1-indexed)
manual_fixes = {
    2393: 1881,  # var hubTab = hubSS.getSheetByName("전체 그룹 단가표");
    2760: 2772,  # .setDescription("발주 시트 헤더 락");
    3057: 3069,  # getHubSS(hubId).getSheetByName("전체 그룹 단가표");
    3096: 3108,  # ? " · 부분오류 " + errorLog.length + "건"
    3284: 3298,  # var hubTab = getHubSS(hubId).getSheetByName("전체 그룹 단가표");
    3341: 3355,  # var debugMsg = "추출된이름: [" + vName + "], 수동복구 제외됨";
}

# For 3650: need to find the correct setDescription in backup
# Current context: .protect().setDescription("단가조회 시트보호 락");
# Let's search backup around 3650-121=3529
for i in range(3520, 3560):
    if '.setDescription' in backup_lines[i]:
        print(f"  Candidate backup {i+1}: {backup_lines[i].strip()[:100]}")

# For 3929: need to find the correct line in backup
# Current: "개 → 매핑 시트에 코드 입력 후 재실행"
# Backup line 3927 has this content
print(f"\nBackup 3927: {backup_lines[3926].strip()[:120]}")

# For 5070: "- 오류: " + errors.length + "개";
# Backup 4949 has this
print(f"Backup 4949: {backup_lines[4948].strip()[:120]}")
