import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

# Manual verified mapping: current_line_num (1-indexed) -> backup_line_num (1-indexed)
fixes = {
    2393: 1881,  # var hubTab = hubSS.getSheetByName("전체 그룹 단가표");
    2760: 2772,  # .setDescription("발주 시트 헤더 락");
    3057: 3069,  # getHubSS(hubId).getSheetByName("전체 그룹 단가표");
    3096: 3108,  # ? " · 부분오류 " + errorLog.length + "건"
    3284: 3298,  # var hubTab = getHubSS(hubId).getSheetByName("전체 그룹 단가표");
    3341: 3355,  # var debugMsg = "추출된이름: [" + vName + "], 수동복구 제외됨";
    3650: 3665,  # .setDescription("단가조회 무결성 락");
    3657: 3672,  # .setDescription("헤더 완전 잠금");
    3929: 3927,  # "개 → 매핑 시트에 코드 입력 후 재실행"
    5070: 4949,  # "- 오류: " + errors.length + "개";
}

applied = 0
for curr_num, back_num in fixes.items():
    curr_idx = curr_num - 1
    back_idx = back_num - 1
    
    if curr_idx >= len(current_lines) or back_idx >= len(backup_lines):
        print(f"SKIP Line {curr_num}: out of range")
        continue
    
    current_line = current_lines[curr_idx].rstrip('\r\n')
    backup_line = backup_lines[back_idx].rstrip('\r\n')
    
    # Preserve current indentation
    indent = len(current_line) - len(current_line.lstrip())
    backup_content = backup_line.lstrip()
    fixed_line = ' ' * indent + backup_content
    
    print(f"Line {curr_num} <- backup {back_num}:")
    print(f"  OLD: {current_line.strip()[:120]}")
    print(f"  NEW: {fixed_line.strip()[:120]}")
    print()
    
    current_lines[curr_idx] = fixed_line + '\n'
    applied += 1

# Also fix lines 5066-5069, 5072, 3933, 3935 which have corrupted Korean but unbroken quotes
# These won't cause syntax errors but let's fix them too for clean code

# Check lines around 3933-3935 in backup
print("--- Additional corrupted lines (non-syntax-error) ---")
additional_fixes = {
    # 3927 is "개 → 매핑 시트에 코드 입력 후 재실행"  
    # 3933: backup 3931
    # 3935: backup 3933
    5066: 4945,  # "🚨 단가조회 3행 수식 긴급 복구 완료\n\n" +
    5067: 4946,  # "- 전체 파일: " + total + "개\n" +
    5068: 4947,  # "- 수식 복구: " + repaired + "개\n" +
    5069: 4948,  # "- 뷰어탭 없음(스킵): " + skipped + "개\n" +
    5072: 4951,  # msg += "\n\n⚠️ 오류 목록:\n" + errors.slice(0, 5).join("\n");
    3933: 3931,  # "\n\n⏭️ 이어서 처리할 시트가 남아 있습니다.\n다시 실행하면 다음 묶음(" +
    3935: 3933,  # "개)부터 이어서 진행합니다.";
    3927: 3925,  # ? "\n⚠ CUST_CD 미입력으로 스킵: " +
}

for curr_num, back_num in additional_fixes.items():
    curr_idx = curr_num - 1
    back_idx = back_num - 1
    
    if curr_idx >= len(current_lines) or back_idx >= len(backup_lines):
        print(f"SKIP Line {curr_num}: out of range")
        continue
    
    current_line = current_lines[curr_idx].rstrip('\r\n')
    backup_line = backup_lines[back_idx].rstrip('\r\n')
    
    indent = len(current_line) - len(current_line.lstrip())
    backup_content = backup_line.lstrip()
    fixed_line = ' ' * indent + backup_content
    
    print(f"Line {curr_num} <- backup {back_num}:")
    print(f"  OLD: {current_line.strip()[:120]}")
    print(f"  NEW: {fixed_line.strip()[:120]}")
    print()
    
    current_lines[curr_idx] = fixed_line + '\n'
    applied += 1

with open('priceManager.gs', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(current_lines)

print(f"\n✅ Applied {applied} fixes total")
