#!/usr/bin/env python3
"""Generalized lane→Google Sheet pusher (replaces the Autoworklet-specific push_lane.py).
Usage: push-sheet.py <sheet_id> <tab_title> <lane-final.csv> [contact-count.json]
Replaces the tab's contents; updates a 'Summary' tab row if one exists with the tab title."""
import csv, json, os, sys

# Auth: gspread + a Google service-account JSON (pip install gspread). Create a service
# account in Google Cloud, download its JSON key, share the target Sheet with the
# service-account email, and set GOOGLE_APPLICATION_CREDENTIALS to the JSON path.
try:
    import gspread
except ImportError:
    sys.exit("push-sheet: pip install gspread")

def client():
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds:
        sys.exit("push-sheet: set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON "
                 "(or omit destination.sheet_id in lane.json for a CSV-only lane)")
    return gspread.service_account(filename=os.path.expanduser(creds))

sheet_id, tab, final_csv = sys.argv[1], sys.argv[2][:30], sys.argv[3]
counts_path = sys.argv[4] if len(sys.argv) > 4 else None

COLS = ["domain", "name", "industry", "employee_count", "employee_range", "revenue_range",
        "founded", "city", "state", "phone", "linkedin", "source_filters", "confidence", "live_reason"]

rows = list(csv.DictReader(open(final_csv)))
sh = client().open_by_key(sheet_id)
try:
    ws = sh.worksheet(tab); ws.clear()
except Exception:
    ws = sh.add_worksheet(tab, rows=len(rows) + 10, cols=len(COLS))
ws.resize(rows=len(rows) + 10, cols=len(COLS))
ws.append_row(COLS)
data = [[r.get(k, "") for k in COLS] for r in rows]
for i in range(0, len(data), 2000):
    ws.append_rows(data[i:i + 2000], value_input_option="RAW")
ws.format("A1:N1", {"textFormat": {"bold": True}})
ws.freeze(rows=1)

counts = None
if counts_path and os.path.exists(counts_path):
    try: counts = json.load(open(counts_path))
    except Exception: pass
try:
    summ = sh.worksheet("Summary")
    for i, row in enumerate(summ.get_all_values(), 1):
        if row and row[0] == tab:
            summ.update(values=[[len(rows)]], range_name=f"B{i}")
            if counts:
                summ.update(values=[[counts.get("total_people", ""), counts.get("total_verified_email", "")]], range_name=f"C{i}:D{i}")
            break
except Exception:
    pass
print(f"{tab}: {len(rows)} rows pushed to {sheet_id}")
