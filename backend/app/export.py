"""Export the last query's result set to Excel (.xlsx) or CSV, so users can verify dashboard
numbers against the raw pulled rows without leaving the platform."""
import io

import pandas as pd


def to_csv_bytes(rows: list[dict]) -> bytes:
    df = pd.DataFrame(rows)
    return df.to_csv(index=False).encode("utf-8")


def to_excel_bytes(rows: list[dict], sheet_name: str = "dashboard_data") -> bytes:
    df = pd.DataFrame(rows)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=sheet_name)
    return buf.getvalue()
