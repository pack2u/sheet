import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Print lines 311-320 (0-indexed: 310-319)
for i in range(310, 321):
    print(f"Line {i+1}: {lines[i].rstrip()}")
