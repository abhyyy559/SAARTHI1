"""Render start entrypoint — cwd- and Root-Directory-proof.

Start Command on Render (native Python runtime):
    python /opt/render/project/src/run.py
Render always checks the repo out at /opt/render/project/src, so this
absolute path works no matter what Root Directory is configured.
"""
import os
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))
os.chdir(APP_DIR)

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
    )
