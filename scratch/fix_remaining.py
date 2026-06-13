import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Read both files
with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

# Remaining broken lines to fix (manually verified as actual breaks)
# Line numbers (1-indexed) from the find_broken output
remaining = [2393, 2760, 3057, 3096, 3284, 3341, 3650, 3929, 4604, 4906, 5070, 5132]

# For these lines, we need to find the backup equivalent
# The offset between current and backup varies
# Current file has ~121 more lines than backup (5136 vs 5015)

import re

def find_backup_match(current_idx, current_lines, backup_lines, search_range=30):
    """Find the best matching backup line for a broken current line"""
    current_line = current_lines[current_idx].strip()
    
    # Extract non-Korean chars as skeleton
    current_ascii = re.sub(r'[^\x00-\x7f]', '', current_line)
    
    # Estimate backup position (offset ~121 lines)
    estimated_backup = current_idx - 121
    start = max(0, estimated_backup - search_range)
    end = min(len(backup_lines), estimated_backup + search_range)
    
    best_match = None
    best_score = 0
    
    for bi in range(start, end):
        backup_line = backup_lines[bi].strip()
        backup_ascii = re.sub(r'[^\x00-\x7f]', '', backup_line)
        
        # Compare ASCII skeletons
        if current_ascii == backup_ascii:
            return bi, 100
        
        # Partial match
        shorter = min(len(current_ascii), len(backup_ascii))
        if shorter == 0:
            continue
        common = sum(1 for a, b in zip(current_ascii, backup_ascii) if a == b)
        score = common / max(len(current_ascii), len(backup_ascii), 1) * 100
        if score > best_score:
            best_score = score
            best_match = bi
    
    return best_match, best_score

fixes = []
for line_num in remaining:
    idx = line_num - 1
    if idx >= len(current_lines):
        continue
    
    backup_idx, score = find_backup_match(idx, current_lines, backup_lines, search_range=50)
    
    if backup_idx is not None and score > 40:
        backup_line = backup_lines[backup_idx].rstrip('\r\n')
        current_line = current_lines[idx].rstrip('\r\n')
        
        # Preserve current indentation
        indent = len(current_line) - len(current_line.lstrip())
        backup_content = backup_line.lstrip()
        fixed_line = ' ' * indent + backup_content
        
        fixes.append((idx, fixed_line))
        print(f"Line {line_num} -> backup line {backup_idx+1} (score={score:.0f}%):")
        print(f"  BROKEN: {current_line.strip()[:120]}")
        print(f"  FIXED:  {backup_line.strip()[:120]}")
        print()
    else:
        print(f"Line {line_num}: NO MATCH FOUND (best score={score:.0f}%)")
        print(f"  BROKEN: {current_lines[idx].strip()[:120]}")
        print()

print(f"Total fixes: {len(fixes)}")

if fixes:
    for idx, fixed_line in fixes:
        current_lines[idx] = fixed_line + '\n'
    
    with open('priceManager.gs', 'w', encoding='utf-8', newline='\n') as f:
        f.writelines(current_lines)
    
    print("\n✅ Applied!")
