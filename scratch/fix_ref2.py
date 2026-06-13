import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('priceManager.gs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

target_line = 4265
idx = target_line - 1

print(f"Line {target_line}: {repr(lines[idx][:80])}")
# Detect line ending
le = '\r\n' if lines[idx].endswith('\r\n') else '\n'
print(f"Line ending: {repr(le)}")

old_content = '    "          if (String(vData[v][2]).replace(/\\\\s/g, \'\') === inputCode) {",' + le

if lines[idx] == old_content:
    new_lines = [
        '    "          var vCode = String(vData[v][2]).replace(/\\\\s/g, \'\');",' + le,
        '    "          var vName = String(vData[v][3] || \'\');",' + le,
        '    "          if (vCode.indexOf(\'#REF\') !== -1 || vCode.indexOf(\'#N/A\') !== -1) continue;",' + le,
        '    "          if (vName.indexOf(\'#REF\') !== -1 || vName.indexOf(\'#N/A\') !== -1) continue;",' + le,
        '    "          if (vCode === inputCode) {",'+le,
    ]
    lines[idx:idx+1] = new_lines
    print("✅ Replaced successfully")
else:
    print("❌ Mismatch!")
    print(f"Expected: {repr(old_content)}")
    print(f"Got:      {repr(lines[idx])}")

with open('priceManager.gs', 'w', encoding='utf-8') as f:
    f.writelines(lines)

# Verify
with open('priceManager.gs', 'r', encoding='utf-8') as f:
    v = f.readlines()
print(f"\nVerify lines {target_line}-{target_line+5}:")
for i in range(idx, min(idx+6, len(v))):
    print(f"  {i+1}: {v[i].rstrip()}")
