import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

def has_any_corruption(line):
    """Check if a line has any remaining corrupted characters"""
    for ch in line:
        cp = ord(ch)
        if 0x20000 <= cp <= 0x2FA1F:
            return True
        if cp == 0xFFFD:
            return True
    # Check for specific corrupted multi-byte sequences that survived
    suspicious = ['?𨂃', '?嵸', '?渠', '?科', '?木', '?韒', '?𣕑', '?蛭',
                  '?𨰰', '?渥', '?軤', '?禺', '?嶅', '?趣', '?刮', '?𥔱',
                  '?赭', '?蛙', '?韀', '?欠', '?月', '?到', '?潺', '?潰',
                  '?軎', '?참', '?拘', '?蛟', '?属', '?澎', '?辶', '?圲',
                  '?炣', '?梵', '?梓', '?㗻', '?∫', '?眼', '?版', '?禹',
                  '?吖', '?吣', '?𡥄', '?𩤃', '?𥻗', '?㻂', '?𡢾', '?𡟯',
                  '?𣽁', '穈桿', '穈㻂', '穈?', '穈?', '穇圉', '穇渠', '穇渥',
                  '篣域', '篣圉', '篧到', '篞賈', '諻堅', '諻𨰰', '諻域', '諻䁯',
                  '諻拖', '諻䇹', '諈刺', '諈魁', '諈拘', '諯賈', '諯貲', '諯資',
                  '諰籝', '諰竾', '諡湊', '諡渥', '諤欠', '諤?', '貐虛', '貐渣',
                  '貐�', '貐𣖙', '貒�', '賰域', '窶赭', '窶國', '窶趣', '窶�',
                  '窷龲', '窱科', '窵�', '麮䁪', '麆樺', '麆刺', '麆賄', '鴗炣',
                  '鴔�', '鴥潺', '鮈龲', '鮈', '鴞', '龲', '黺𥯆', '黺𨁈', '黺䇹',
                  '黕�', '黖𨁈', '黖𨰰', '黖嶅', '儠竾', '?刷?', '∫𤟠',
                  '?國', '?龲', '?鹻', '?域', '?陬', '?𠺝', '?㻂𥘵', '?𨰰擪',
                  '?𡡒', '?𧙖', '?韠', '?𨩆', '?𣖙', '?𢩦', '?𦚯', '?䎺',
                  '諴刮', '?停', '?𤟠', '?㫲', '?國盒', '?𠽌', '?𠹻',
                  '?𨁈掠', '?𨁈溢', '?𨁈', '?窵', '?𥇣', '?祭', '?䁪收',
                  '?䁯', '?𦉘', '?頃', '?貲', '?溢', '?尐', '?掠', '?龲',
                  '?停', '?嵸㘚']
    for s in suspicious:
        if s in line:
            return True
    return False

# Strategy: For lines that still have corruption, try to find the matching backup line
# using a sliding window approach with ASCII skeleton matching

def get_ascii_only(s):
    """Get only standard ASCII chars (0x20-0x7E)"""
    return ''.join(c for c in s if 0x20 <= ord(c) <= 0x7e)

# Build backup index with context (line before + after ASCII)
backup_ascii = [get_ascii_only(l) for l in backup_lines]

# For each corrupted current line, try to find matching backup line
fixes = []
for i, line in enumerate(current_lines):
    if not has_any_corruption(line):
        continue
    
    curr_ascii = get_ascii_only(line)
    if len(curr_ascii.strip()) < 3:
        continue
    
    # Search backup
    best_match = None
    best_score = 0
    
    # Estimate offset based on file position
    # Current file is ~122 lines longer than backup
    estimated_offset = int(i * len(backup_lines) / len(current_lines))
    
    search_start = max(0, estimated_offset - 40)
    search_end = min(len(backup_lines), estimated_offset + 40)
    
    for bi in range(search_start, search_end):
        if curr_ascii == backup_ascii[bi]:
            best_match = bi
            best_score = 100
            break
        
        # Partial match
        if not backup_ascii[bi] or not curr_ascii:
            continue
        shorter = min(len(curr_ascii), len(backup_ascii[bi]))
        if shorter < 5:
            continue
        common = sum(1 for a, b in zip(curr_ascii, backup_ascii[bi]) if a == b)
        score = common / max(len(curr_ascii), len(backup_ascii[bi]), 1) * 100
        if score > best_score and score > 70:
            best_score = score
            best_match = bi
    
    if best_match is not None and best_score >= 70:
        backup_line = backup_lines[best_match].rstrip('\r\n')
        current_stripped = current_lines[i].rstrip('\r\n')
        
        if not has_any_corruption(backup_line) and backup_line.strip() != current_stripped.strip():
            # Preserve indentation
            indent = len(current_stripped) - len(current_stripped.lstrip())
            fixed = ' ' * indent + backup_line.lstrip()
            fixes.append((i, fixed, best_match, best_score))

print(f"Found {len(fixes)} fixable lines from backup")

# Apply fixes
for idx, fixed, back_idx, score in fixes:
    current_lines[idx] = fixed + '\n'

with open('priceManager.gs', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(current_lines)

# Count remaining
remaining = sum(1 for l in current_lines if has_any_corruption(l))
print(f"Remaining corrupted: {remaining}")

# Show samples
count = 0
for i, line in enumerate(current_lines):
    if has_any_corruption(line) and count < 20:
        count += 1
        print(f"L{i+1}: {line.strip()[:120]}")
