import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

# Since the pattern replacement approach created hybrid (partially fixed) text,
# the best approach is: for EVERY corrupted line, replace it entirely with the backup version.
# If backup doesn't exist (lines added after backup), keep current.

def has_corruption_v2(line):
    """More aggressive check for any remaining garbled text"""
    for ch in line:
        cp = ord(ch)
        if 0x20000 <= cp <= 0x2FA1F:
            return True
        if cp == 0xFFFD:
            return True
    # Check for specific remaining corruption markers
    # These are individual CJK chars that should NOT appear in Korean code
    markers = [
        '\u8ACB', '\u8ACC', '\u8ACD', '\u8ACE', '\u8ACF',  # 諻 etc
        '\u8C90', '\u8CF0', '\u8CF6',  # 貐賰 etc
        '\u7A08', '\u7A48',  # 穈 etc
        '\u7BE7',  # 篧
        '\u7B4B',  # 筋
        '\u7A46',  # 穆
        '\u9EAE',  # 麮
        '\u9B45',  # 魽
        '\u9F9C',  # 龲
        '\u9D72',  # 鵲
        '\u40BB',  # 䂻
        '\u4081',  # 䂁
        '\u406F',  # 䁯
        '\u4078',  # 䁸
        '\u8AE8',  # 諨
        '\u7AB8',  # 窸
        '\u7AB6',  # 窶
        '\u7AB1',  # 窱
        '\u7AB5',  # 窵
        '\u7AB7',  # 窷
        '\u9AE5',  # 髥
        '\u9B7D',  # 魽
        '\u9F72',  # 龲
        '\u9E7B',  # 鹻
        '\u9EBA',  # 麺
        '\u9E6E',  # 鹮
        '\u9E6D',  # 鹭
        '\u9ECD',  # 麍
        '\u86AB',  # 蚫
        '\u85E5',  # 藥
        '\u8D64',  # 赤
        '\u8D66',  # 赦
        '\u8FEC',  # 迬
        '\u8C48',  # 豈
    ]
    for m in markers:
        if m in line:
            return True
    # Check for partially converted patterns with ? followed by unusual chars  
    import re
    if re.search(r'\?\w*[\u4e00-\u9fff\U00020000-\U0002fa1f]', line):
        return True
    if re.search(r'[\u4e00-\u9fff]{2,}[?\u4e00-\u9fff]*[\u4e00-\u9fff]', line):
        # Check if these are actual Chinese chars being used in the code
        # Korean code should primarily use Hangul (AC00-D7AF), not CJK ideographs
        cjk_count = sum(1 for c in line if 0x4E00 <= ord(c) <= 0x9FFF)
        hangul_count = sum(1 for c in line if 0xAC00 <= ord(c) <= 0xD7AF)
        if cjk_count > 3 and hangul_count < cjk_count:
            return True
    return False

# Strategy: Replace ALL corrupted lines with their backup equivalents
# Step 1: Build a robust mapping between current and backup lines
# Use dynamic programming / longest common subsequence approach for alignment

# Simple alignment: match lines by their ASCII content
def ascii_key(line):
    return ''.join(c for c in line.strip() if 0x20 <= ord(c) <= 0x7e)

# Build mapping
# For backup-range lines (1-5015), find the best alignment
# The current file has ~122 extra lines spread throughout

# Simple approach: for each corrupted current line, find its backup match
# by searching nearby lines with the same ASCII skeleton

fixes = 0
for i in range(len(current_lines)):
    if not has_corruption_v2(current_lines[i]):
        continue
    
    curr_key = ascii_key(current_lines[i])
    if len(curr_key) < 3:
        continue
    
    # Search backup in a proportional range
    ratio = i / len(current_lines)
    estimated_bi = int(ratio * len(backup_lines))
    
    best_match = None
    best_score = 0
    
    for bi in range(max(0, estimated_bi - 50), min(len(backup_lines), estimated_bi + 50)):
        back_key = ascii_key(backup_lines[bi])
        if curr_key == back_key:
            best_match = bi
            best_score = 100
            break
        if not back_key or len(back_key) < 3:
            continue
        common = sum(1 for a, b in zip(curr_key, back_key) if a == b)
        score = common / max(len(curr_key), len(back_key)) * 100
        if score > best_score and score > 60:
            best_score = score
            best_match = bi
    
    if best_match is not None:
        backup_line = backup_lines[best_match].rstrip('\r\n')
        if not has_corruption_v2(backup_line + '\n'):
            # Use backup line with current indentation
            curr_stripped = current_lines[i].rstrip('\r\n')
            indent = len(curr_stripped) - len(curr_stripped.lstrip())
            fixed = ' ' * indent + backup_line.lstrip()
            current_lines[i] = fixed + '\n'
            fixes += 1

print(f"Applied {fixes} fixes from backup")

# Write
with open('priceManager.gs', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(current_lines)

# Count remaining
remaining = sum(1 for l in current_lines if has_corruption_v2(l))
print(f"Remaining corrupted: {remaining}")

# Show first 30 remaining
count = 0
for i, line in enumerate(current_lines):
    if has_corruption_v2(line) and count < 30:
        count += 1
        print(f"L{i+1}: {line.strip()[:140]}")
