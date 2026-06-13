import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Find lines with unclosed string literals in current file
with open('priceManager.gs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

broken_lines = []
for i, line in enumerate(lines):
    s = line.rstrip('\r\n')
    if not s.strip() or s.strip().startswith('//') or s.strip().startswith('*') or s.strip().startswith('/*'):
        continue
    
    # Count unescaped double quotes
    dq_count = 0
    sq_count = 0
    j = 0
    in_dq = False
    in_sq = False
    while j < len(s):
        ch = s[j]
        if ch == '\\' and j + 1 < len(s):
            j += 2
            continue
        if ch == '"' and not in_sq:
            dq_count += 1
            in_dq = not in_dq
        elif ch == "'" and not in_dq:
            sq_count += 1
            in_sq = not in_sq
        j += 1
    
    # If we end inside a string, it's broken
    if in_dq or in_sq:
        # Check next line to see if it's a multi-line string (which JS doesn't support)
        # or a continuation
        next_s = lines[i+1].rstrip('\r\n').strip() if i+1 < len(lines) else ''
        # Skip legitimate multi-line patterns like string concatenation
        if s.rstrip().endswith('+') or s.rstrip().endswith('(') or s.rstrip().endswith(','):
            continue
        if next_s.startswith('+') or next_s.startswith(')') or next_s.startswith('.'):
            continue
        broken_lines.append(i + 1)
        print(f"Line {i+1}: {s.strip()[:200]}")

print(f"\nTotal broken lines: {len(broken_lines)}")
