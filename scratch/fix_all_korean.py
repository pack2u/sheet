import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

def has_corruption(line):
    """Check if a line has corrupted Korean (CJK Unified Ideographs Extension B, etc.)"""
    for ch in line:
        cp = ord(ch)
        # CJK Extension B (U+20000-U+2A6DF) - almost never used in normal Korean
        if 0x20000 <= cp <= 0x2FA1F:
            return True
        # CJK Compatibility Ideographs Supplement
        if 0x2F800 <= cp <= 0x2FA1F:
            return True
        # Replacement character
        if cp == 0xFFFD:
            return True
    # Also check for specific corrupted patterns
    # Characters like 篞賈 諻堅 穈 etc. that are rare CJK chars not used in Korean
    suspicious_ranges = [
        (0x7A00, 0x7AFF),  # 篞篣等
        (0x8AC8, 0x8AFF),  # 諈諻諝etc
        (0x8C88, 0x8CFF),  # 賈賱etc
        (0x9EAE, 0x9EFF),  # 麮麆
        (0x7A46, 0x7A46),  # 穈
        (0x9B45, 0x9B45),  # 魽
        (0x9F9C, 0x9FFF),  # 龲
    ]
    suspicious_count = 0
    for ch in line:
        cp = ord(ch)
        for start, end in suspicious_ranges:
            if start <= cp <= end:
                suspicious_count += 1
                break
    # If more than 2 suspicious chars in a string literal, it's likely corrupted
    if suspicious_count >= 2:
        return True
    return False

def get_ascii_skeleton(line):
    """Get only ASCII chars from a line for matching"""
    return re.sub(r'[^\x00-\x7f]', '', line.strip())

# Build index of backup lines by ASCII skeleton for fast lookup
backup_index = {}
for i, line in enumerate(backup_lines):
    skel = get_ascii_skeleton(line)
    if skel and len(skel) > 10:
        if skel not in backup_index:
            backup_index[skel] = []
        backup_index[skel].append(i)

# Find all corrupted lines
corrupted = []
for i, line in enumerate(current_lines):
    s = line.strip()
    if not s or s.startswith('//') or s.startswith('*') or s.startswith('/*'):
        # Comments are OK to fix too
        pass
    if has_corruption(line):
        corrupted.append(i)

print(f"Found {len(corrupted)} corrupted lines")

# Match each corrupted line to backup
fixes = []
unmatched = []

for idx in corrupted:
    current_line = current_lines[idx]
    current_skel = get_ascii_skeleton(current_line)
    
    # Try exact skeleton match first
    best_match = None
    best_score = 0
    
    if current_skel in backup_index:
        candidates = backup_index[current_skel]
        # Pick the one closest to the expected position
        for bi in candidates:
            # Score based on position proximity
            dist = abs(bi - (idx - 120))  # approximate offset
            score = 100 - min(dist, 50)
            if score > best_score:
                best_score = score
                best_match = bi
    
    # If no exact match, try fuzzy matching in a window
    if best_match is None or best_score < 60:
        # Search in a wider window
        for offset in [120, 110, 130, 100, 140, 90, 150, 80, 160]:
            estimated = idx - offset
            search_start = max(0, estimated - 20)
            search_end = min(len(backup_lines), estimated + 20)
            
            for bi in range(search_start, search_end):
                backup_skel = get_ascii_skeleton(backup_lines[bi])
                if not current_skel or not backup_skel:
                    continue
                
                # Compare
                if current_skel == backup_skel:
                    best_match = bi
                    best_score = 95
                    break
                
                # Partial match
                shorter = min(len(current_skel), len(backup_skel))
                if shorter < 5:
                    continue
                common = sum(1 for a, b in zip(current_skel, backup_skel) if a == b)
                score = common / max(len(current_skel), len(backup_skel), 1) * 100
                if score > best_score:
                    best_score = score
                    best_match = bi
            
            if best_score >= 80:
                break
    
    if best_match is not None and best_score >= 50:
        backup_line = backup_lines[best_match].rstrip('\r\n')
        current_stripped = current_lines[idx].rstrip('\r\n')
        
        # Only fix if backup line is different and not corrupted itself
        if backup_line.strip() != current_stripped.strip() and not has_corruption(backup_line):
            # Preserve indentation
            indent = len(current_stripped) - len(current_stripped.lstrip())
            fixed = ' ' * indent + backup_line.lstrip()
            fixes.append((idx, fixed, best_match))
    else:
        unmatched.append(idx)

print(f"Matched fixes: {len(fixes)}")
print(f"Unmatched: {len(unmatched)}")

# Show all fixes
for idx, fixed, back_idx in fixes:
    old = current_lines[idx].rstrip('\r\n').strip()
    new = fixed.strip()
    if old != new:
        print(f"\nL{idx+1} <- B{back_idx+1}: {old[:100]}")
        print(f"         => {new[:100]}")

# Show unmatched
if unmatched:
    print(f"\n--- UNMATCHED ({len(unmatched)}) ---")
    for idx in unmatched:
        print(f"L{idx+1}: {current_lines[idx].strip()[:120]}")

# Apply
for idx, fixed, _ in fixes:
    current_lines[idx] = fixed + '\n'

with open('priceManager.gs', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(current_lines)

print(f"\n✅ Applied {len(fixes)} fixes")
