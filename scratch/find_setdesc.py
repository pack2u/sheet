import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

# Search ALL setDescription lines in backup
for i, line in enumerate(backup_lines):
    if '.setDescription' in line:
        print(f"Backup {i+1}: {line.strip()[:120]}")
