"""Safely integrate AuditStock.jsx into the current KitchenSync MobilePantry.jsx.

Run from KitchenSync project root with: .\\.venv\\Scripts\\python.exe apply_audit_stock.py
Edits only frontend/src/components/MobilePantry.jsx; backs up original into .git.
"""
from datetime import datetime
from pathlib import Path
import os
import sys

ROOT = Path.cwd()
TARGET = ROOT / 'frontend' / 'src' / 'components' / 'MobilePantry.jsx'
AUDIT = ROOT / 'frontend' / 'src' / 'components' / 'AuditStock.jsx'
GIT_DIR = ROOT / '.git'

if not TARGET.is_file() or not GIT_DIR.exists():
    sys.exit('ERROR: Run this script from the KitchenSync repository root (the folder containing frontend/ and .git/).')
if not AUDIT.is_file():
    sys.exit('ERROR: Create frontend/src/components/AuditStock.jsx using the component code supplied earlier before applying this integration.')

original_bytes = TARGET.read_bytes()
try:
    original = original_bytes.decode('utf-8')
except UnicodeDecodeError:
    sys.exit('ERROR: MobilePantry.jsx is not UTF-8. File left unchanged.')
newline = '\r\n' if b'\r\n' in original_bytes else '\n'
src = original.replace('\r\n', '\n')

markers = [
    'import AuditStock from "./AuditStock.jsx";',
    '  ClipboardCheck,',
    'const [auditItem, setAuditItem] = useState(null);',
    'const handleAuditSaved = async () => {',
    'aria-label={`Audit stock for ${item.name}`}',
    '<AuditStock',
]
if all(m in src for m in markers):
    print('Audit Stock integration is already present. No changes made.')
    sys.exit(0)
if any(m in src for m in markers):
    sys.exit('ERROR: Partial Audit Stock integration detected. No changes made; inspect the file first.')


def once(old, new, purpose):
    global src
    count = src.count(old)
    if count != 1:
        sys.exit(f'ERROR: Expected exactly one {purpose} anchor; found {count}. File left unchanged.')
    src = src.replace(old, new, 1)

once(
    '  Save,\n} from "lucide-react";',
    '  Save,\n  ClipboardCheck,\n} from "lucide-react";',
    'lucide-react import',
)
once(
    'import ExpiryScanner from "./ExpiryScanner.jsx";\n',
    'import ExpiryScanner from "./ExpiryScanner.jsx";\nimport AuditStock from "./AuditStock.jsx";\n',
    'ExpiryScanner import',
)
once(
    '  const [selected, setSelected] = useState(null);\n',
    '  const [selected, setSelected] = useState(null);\n  const [auditItem, setAuditItem] = useState(null);\n',
    'selected state',
)
once(
    '  const closeBatchManager = () => {',
    '''  // Keep the local Pantry view in sync after a confirmed stock audit.
  const handleAuditSaved = async () => {
    setHasChanged(true);
    const updated = await api("/inventory");
    setLiveInventory(updated);
    setNotice("Pantry stock reconciled successfully.");
  };

  const closeAudit = () => {
    setAuditItem(null);
    // Refresh Dashboard, Planner and Shopping after a stock correction.
    if (hasChanged) {
      window.location.reload();
    }
  };

  const closeBatchManager = () => {''',
    'closeBatchManager handler',
)
once(
    '                        <div className="mt-2 flex flex-wrap gap-2">\n',
    '''                        <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setAuditItem(item)}
                          className="flex items-center gap-1 rounded-xl bg-[#dff0e4] px-3 py-2 text-xs font-bold text-[#216d48]"
                          aria-label={`Audit stock for ${item.name}`}
                        >
                          <ClipboardCheck size={14} />
                          Audit Stock
                        </button>
''',
    'Pantry item actions',
)
once(
    '       {selected && (\n         <PurchaseBatchManager',
    '''       {auditItem && (
         <AuditStock
           key={auditItem.id}
           ingredient={auditItem}
           onClose={closeAudit}
           onSaved={handleAuditSaved}
         />
       )}
       {selected && (
         <PurchaseBatchManager''',
    'PurchaseBatchManager render',
)

# Verify all changes before writing anything.
assert all(m in src for m in markers)
backup_dir = GIT_DIR / 'kitchensync-backups'
backup_dir.mkdir(parents=True, exist_ok=True)
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
backup = backup_dir / f'MobilePantry.jsx.{stamp}.bak'
backup.write_bytes(original_bytes)

edited = src.replace('\n', newline).encode('utf-8')
temporary = TARGET.with_suffix('.jsx.audit-tmp')
try:
    temporary.write_bytes(edited)
    os.replace(temporary, TARGET)
finally:
    if temporary.exists():
        temporary.unlink()
print(f'UPDATED: {TARGET}')
print(f'BACKUP:  {backup}')
print('Existing scanner, batch manager, inventory cards and handlers were preserved.')
print('Next: git diff --check; cd frontend; npm.cmd run build')
