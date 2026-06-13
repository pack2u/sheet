import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('0521_backup/priceManager.gs', 'r', encoding='utf-8') as f:
    backup_lines = f.readlines()

# Print context around backup line that would match 3650's context
# Current line 3647-3651 has .protect().setDescription(...)
# Search for .setDescription in backup around 3650-121=3529

for i in range(3500, 3600):
    line = backup_lines[i].strip()
    if '.setDescription' in line:
        print(f"Backup {i+1}: {line}")

print("\n--- Backup lines 3925-3935 (for line 3929) ---")
for i in range(3920, 3935):
    if i < len(backup_lines):
        print(f"Backup {i+1}: {backup_lines[i].rstrip()}")

print("\n--- Backup lines 4940-4960 (for line 5070) ---")
for i in range(4940, 4960):
    if i < len(backup_lines):
        print(f"Backup {i+1}: {backup_lines[i].rstrip()}")
