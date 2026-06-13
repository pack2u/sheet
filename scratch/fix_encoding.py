import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Read both files
with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

# The files may have different line counts due to earlier edits
# We need to find the corresponding backup line for each broken current line

# Find broken lines in current file
def is_broken(line):
    s = line.rstrip('\r\n')
    if not s.strip() or s.strip().startswith('//') or s.strip().startswith('*') or s.strip().startswith('/*'):
        return False
    j = 0
    in_dq = False
    in_sq = False
    while j < len(s):
        ch = s[j]
        if ch == '\\' and j + 1 < len(s):
            j += 2
            continue
        if ch == '"' and not in_sq:
            in_dq = not in_dq
        elif ch == "'" and not in_dq:
            in_sq = not in_sq
        j += 1
    return in_dq or in_sq

# Build a mapping: for each broken line, find the matching backup line
# Strategy: match by surrounding context (the line before and after should be similar)

broken_indices = []
for i, line in enumerate(current_lines):
    if is_broken(line):
        # Check if it's not a legitimate continuation
        s = line.rstrip('\r\n')
        if s.rstrip().endswith('+') or s.rstrip().endswith('(') or s.rstrip().endswith(','):
            continue
        next_s = current_lines[i+1].rstrip('\r\n').strip() if i+1 < len(current_lines) else ''
        if next_s.startswith('+') or next_s.startswith(')') or next_s.startswith('.'):
            continue
        broken_indices.append(i)

print(f"Found {len(broken_indices)} broken lines in current file")
print(f"Current file: {len(current_lines)} lines")
print(f"Backup file: {len(backup_lines)} lines")

# The difference is small (due to onEdit code changes: +3 lines from \\\\s fix)
# But the line offset may vary. Let's use a smarter approach:
# For each broken line, search in backup for a line that has the same non-Korean content pattern

import re

def extract_code_skeleton(line):
    """Extract just the code structure (variable names, operators, etc.) without string contents"""
    s = line.strip()
    # Remove string contents but keep quotes
    result = []
    in_str = False
    quote_char = None
    j = 0
    while j < len(s):
        ch = s[j]
        if ch == '\\' and in_str and j+1 < len(s):
            j += 2
            continue
        if not in_str and ch in '"\'':
            in_str = True
            quote_char = ch
            result.append(ch)
        elif in_str and ch == quote_char:
            in_str = False
            result.append(ch)
        elif not in_str:
            result.append(ch)
        j += 1
    return ''.join(result)

# For each broken line, find the best match in backup
fixes = []
for bi in broken_indices:
    current_skel = extract_code_skeleton(current_lines[bi])
    
    # Search in a window around the same line number
    best_match = None
    best_score = 0
    search_start = max(0, bi - 10)
    search_end = min(len(backup_lines), bi + 10)
    
    for bj in range(search_start, search_end):
        backup_skel = extract_code_skeleton(backup_lines[bj])
        # Compare skeletons
        if current_skel == backup_skel:
            best_match = bj
            best_score = 100
            break
        # Partial match: same function calls, variable names
        common = sum(1 for a, b in zip(current_skel, backup_skel) if a == b)
        total = max(len(current_skel), len(backup_skel), 1)
        score = common / total * 100
        if score > best_score:
            best_score = score
            best_match = bj
    
    if best_match is not None and best_score > 50:
        backup_line = backup_lines[best_match].rstrip('\r\n')
        current_line = current_lines[bi].rstrip('\r\n')
        if backup_line != current_line:
            # Get indentation from current line
            indent = len(current_line) - len(current_line.lstrip())
            backup_content = backup_line.lstrip()
            fixed_line = ' ' * indent + backup_content
            fixes.append((bi, fixed_line, best_match, best_score))
            print(f"\nLine {bi+1} (score={best_score:.0f}%, backup line {best_match+1}):")
            print(f"  BROKEN:  {current_line.strip()[:100]}")
            print(f"  FIXED:   {backup_line.strip()[:100]}")

print(f"\n\nTotal fixes to apply: {len(fixes)}")

# Apply fixes
if fixes:
    for bi, fixed_line, _, _ in fixes:
        current_lines[bi] = fixed_line + '\n'
    
    with open('priceManager.gs', 'w', encoding='utf-8', newline='\n') as f:
        f.writelines(current_lines)
    
    print("\n✅ All fixes applied to priceManager.gs")
else:
    print("\n⚠ No fixes to apply")
