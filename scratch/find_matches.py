import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

import re

# Remaining broken lines
remaining = [2393, 2760, 3057, 3096, 3284, 3341, 3650, 3929, 5070]

# For each, search the ENTIRE backup file for the best ASCII skeleton match
def get_ascii(line):
    return re.sub(r'[^\x00-\x7f]', '', line.strip())

for line_num in remaining:
    idx = line_num - 1
    current_ascii = get_ascii(current_lines[idx])
    
    best_match = None
    best_score = 0
    
    for bi in range(len(backup_lines)):
        backup_ascii = get_ascii(backup_lines[bi])
        if not backup_ascii or not current_ascii:
            continue
        if current_ascii == backup_ascii:
            best_match = bi
            best_score = 100
            break
        # Use longest common subsequence ratio
        shorter = min(len(current_ascii), len(backup_ascii))
        if shorter < 5:
            continue
        common = sum(1 for a, b in zip(current_ascii, backup_ascii) if a == b)
        score = common / max(len(current_ascii), len(backup_ascii), 1) * 100
        if score > best_score:
            best_score = score
            best_match = bi
    
    print(f"Line {line_num} (best backup: {best_match+1 if best_match else 'NONE'}, score={best_score:.0f}%):")
    print(f"  CURRENT: {current_lines[idx].strip()[:150]}")
    if best_match is not None:
        print(f"  BACKUP:  {backup_lines[best_match].strip()[:150]}")
    print()
