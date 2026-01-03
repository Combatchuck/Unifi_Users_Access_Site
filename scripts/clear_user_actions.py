#!/usr/bin/env python3
import shutil
from pathlib import Path
import datetime

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / "user_actions.log"

def main():
    if not LOG.exists():
        print(f"Log file not found: {LOG}")
        return

    ts = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    backup = ROOT / f"user_actions.log.bak.{ts}"
    shutil.copy2(LOG, backup)
    print(f"Backup created: {backup}")

    with LOG.open("r", encoding="utf-8") as f:
        lines = f.readlines()

    def keep(line: str) -> bool:
        ll = line.lower()
        if "admin@example.com" in ll:
            return False
        if "charles" in ll:
            # remove references to personal name
            return False
        return True

    new_lines = [l for l in lines if keep(l)]

    removed = len(lines) - len(new_lines)
    with LOG.open("w", encoding="utf-8") as f:
        f.writelines(new_lines)

    print(f"Removed {removed} lines containing personal identifiers.")

if __name__ == "__main__":
    main()
