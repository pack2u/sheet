"""
Final approach:
1. Use backup as base (correct Korean)
2. Find code that exists ONLY in current file (added after backup)
3. Merge: backup base + new code insertions
4. Apply the \\\\s -> \\s fix
"""
import sys, io, re, difflib
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Read the ORIGINAL backup (untouched)
with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_text = f.read()
    backup_lines = backup_text.split('\n')

# Read the CURRENT file to find new code
with open('priceManager.gs', 'r', encoding='utf-8') as f:
    current_text = f.read()
    current_lines = current_text.split('\n')

# ASCII-only lines for alignment
def to_ascii(s):
    return ''.join(c for c in s if ord(c) < 128)

backup_ascii = [to_ascii(l) for l in backup_lines]
current_ascii = [to_ascii(l) for l in current_lines]

# Find the diff
sm = difflib.SequenceMatcher(None, backup_ascii, current_ascii, autojunk=False)

# Build the output: backup lines where they match, current lines where they're inserted
output_lines = []
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == 'equal':
        # Use backup (correct Korean)
        for bi in range(i1, i2):
            output_lines.append(backup_lines[bi])
    elif tag == 'replace':
        # Lines that exist in both but differ
        # If ASCII is the same, use backup (Korean fix)
        # If ASCII differs, it's modified code - keep current
        for ci in range(j1, j2):
            # Try to find matching backup line by ASCII
            found = False
            for bi in range(i1, i2):
                if backup_ascii[bi].strip() == current_ascii[ci].strip():
                    output_lines.append(backup_lines[bi])
                    found = True
                    break
            if not found:
                output_lines.append(current_lines[ci])
    elif tag == 'insert':
        # New code only in current - keep it
        for ci in range(j1, j2):
            output_lines.append(current_lines[ci])
    elif tag == 'delete':
        # Lines removed from backup - skip them
        pass

# Apply the \\\\s -> \\s fix on lines 3785-3824 (approximate)
# The backup has \\\\s which needs to be \\s in the deployed code strings
fixed_regex = 0
for i, line in enumerate(output_lines):
    if '/\\\\\\\\s/g' in line:
        output_lines[i] = line.replace('/\\\\\\\\s/g', '/\\\\s/g')
        fixed_regex += 1

print(f"Output lines: {len(output_lines)}")
print(f"Regex fixes (\\\\\\\\s -> \\\\s): {fixed_regex}")

# Write
result = '\n'.join(output_lines)
with open('priceManager.gs', 'w', encoding='utf-8', newline='\n') as f:
    f.write(result)

# Check remaining corruption
def has_corruption(line):
    for ch in line:
        cp = ord(ch)
        if 0x20000 <= cp <= 0x2FA1F or cp == 0xFFFD:
            return True
    cjk_count = sum(1 for c in line if 0x4E00 <= ord(c) <= 0x9FFF)
    if cjk_count > 2:
        return True
    return False

remaining = sum(1 for l in output_lines if has_corruption(l))
print(f"Remaining corrupted: {remaining}")

count = 0
for i, line in enumerate(output_lines):
    if has_corruption(line) and count < 20:
        count += 1
        print(f"L{i+1}: {line.strip()[:130]}")
