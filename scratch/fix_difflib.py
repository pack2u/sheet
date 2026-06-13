"""
Strategy: 
1. Start with backup as the base
2. Find lines that were ADDED in the current version (not in backup) 
3. Those added lines need manual Korean reconstruction
4. Rebuild the file: backup lines + added lines in correct positions

Key insight: The code logic (JS syntax) is the same, only Korean text differs.
So we align by code structure, not by Korean text.
"""
import sys, io, re, difflib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_lines = f.readlines()

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

# Strip all non-ASCII for comparison (this way Korean corruption doesn't affect matching)
def to_ascii(s):
    return ''.join(c for c in s if ord(c) < 128)

current_ascii = [to_ascii(l) for l in current_lines]
backup_ascii = [to_ascii(l) for l in backup_lines]

# Use difflib to find which backup lines map to which current lines
sm = difflib.SequenceMatcher(None, backup_ascii, current_ascii, autojunk=False)
opcodes = sm.get_opcodes()

new_lines = list(current_lines)  # Start with current

replaced = 0
kept_current = 0
for tag, i1, i2, j1, j2 in opcodes:
    if tag == 'equal':
        # Lines match in ASCII - use backup version (has correct Korean)
        for bi, ci in zip(range(i1, i2), range(j1, j2)):
            new_lines[ci] = backup_lines[bi]
            if backup_lines[bi] != current_lines[ci]:
                replaced += 1
    elif tag == 'replace':
        # ASCII differs - might be modified lines. Use backup if sizes match.
        backup_chunk = backup_ascii[i1:i2]
        current_chunk = current_ascii[j1:j2]
        if len(backup_chunk) == len(current_chunk):
            for bi, ci in zip(range(i1, i2), range(j1, j2)):
                # Check if it's just Korean that differs
                if backup_ascii[bi].strip() == current_ascii[ci].strip():
                    new_lines[ci] = backup_lines[bi]
                    replaced += 1
                else:
                    kept_current += 1
        else:
            # Different number of lines - keep current for now
            kept_current += (j2 - j1)
    elif tag == 'insert':
        # Lines added in current - keep them (these are new code)
        kept_current += (j2 - j1)
    elif tag == 'delete':
        # Lines removed from backup - nothing to do
        pass

print(f"Replaced from backup: {replaced}")
print(f"Kept current (new/modified): {kept_current}")

# Write
with open('priceManager.gs', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(new_lines)

print(f"Total lines: {len(new_lines)}")

# Now check what's still corrupted
def has_corruption(line):
    for ch in line:
        cp = ord(ch)
        if 0x20000 <= cp <= 0x2FA1F or cp == 0xFFFD:
            return True
    # Check for CJK chars that shouldn't be in Korean
    cjk_count = sum(1 for c in line if 0x4E00 <= ord(c) <= 0x9FFF)
    if cjk_count > 2:
        return True
    return False

remaining = []
for i, line in enumerate(new_lines):
    if has_corruption(line):
        remaining.append(i+1)

print(f"\nRemaining corrupted lines: {len(remaining)}")
for ln in remaining[:30]:
    print(f"L{ln}: {new_lines[ln-1].strip()[:130]}")
