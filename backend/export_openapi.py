import json
from pathlib import Path

from app import app

out = Path(__file__).resolve().parent / "openapi.json"
with out.open("w", encoding="utf-8") as f:
    json.dump(app.openapi(), f, indent=2, ensure_ascii=False)

print(f"Wrote OpenAPI schema to: {out}")
