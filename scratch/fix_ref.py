import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Target: line 4265 (1-indexed), which contains:
# "          if (String(vData[v][2]).replace(/\\s/g, '') === inputCode) {"
# Replace with #REF filtering version

target_line = 4265  # 1-indexed
idx = target_line - 1

print(f"Before edit, line {target_line}:")
print(repr(lines[idx]))

old = '    "          if (String(vData[v][2]).replace(/\\\\s/g, \'\') === inputCode) {",\r\n'
new_lines = [
    '    "          var vCode = String(vData[v][2]).replace(/\\\\s/g, \'\');",\r\n',
    '    "          var vName = String(vData[v][3] || \'\');",\r\n',
    '    "          if (vCode.indexOf(\'#REF\') !== -1 || vCode.indexOf(\'#N/A\') !== -1) continue;",\r\n',
    '    "          if (vName.indexOf(\'#REF\') !== -1 || vName.indexOf(\'#N/A\') !== -1) continue;",\r\n',
    '    "          if (vCode === inputCode) {",\r\n',
]

if lines[idx] == old:
    lines[idx:idx+1] = new_lines
    print("✅ Replaced successfully")
else:
    print("❌ Line doesn't match!")
    print(f"Expected: {repr(old)}")
    print(f"Got:      {repr(lines[idx])}")

with open('priceManager.gs', 'w', encoding='utf-8') as f:
    f.writelines(lines)

# Verify
with open('priceManager.gs', 'r', encoding='utf-8') as f:
    verify = f.readlines()
print(f"\nAfter edit, lines {target_line}-{target_line+4}:")
for i in range(idx, idx+5):
    print(f"  {i+1}: {verify[i].rstrip()}")
