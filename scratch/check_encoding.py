import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    s = line.strip()
    if s.startswith('//'):
        continue
    if '\ufffd' in line:
        print(f'Line {i+1} [REPLACEMENT CHAR]: {repr(s[:100])}')
        continue
    # Look for specific corruption pattern: CJK chars mixed with ? in string literals
    if '"' in s and not s.startswith('"'):
        # Check for suspicious unicode ranges that shouldn't be in Korean/JS code
        for ch in s:
            cp = ord(ch)
            # Ranges that indicate mojibake (corrupted text):
            # CJK Unified Ideographs Extension B (U+20000-U+2A6DF) - unusual for Korean
            # CJK Compatibility Ideographs (U+F900-U+FAFF) 
            if 0x20000 <= cp <= 0x2A6DF or (0x2F00 <= cp <= 0x2FDF):
                print(f'Line {i+1} [SUSPICIOUS CHAR U+{cp:04X}]: {repr(s[:120])}')
                break
