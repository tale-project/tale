#!/usr/bin/env python3
"""Deterministic verify step for the issue-resolution desk.

Runs the repo's test suite on the implementer's branch (already staged in the
sandbox workspace) and writes a structured pass/fail verdict to
/user/output/result.json — the small result the workflow branches on. Big
output (logs) stays as a harvested file; only the verdict crosses the workflow.

Python (not bash) so it runs on the platform's `run_code` path, which every
sandbox image supports — bash one-shot mode depends on a newer runner image.
"""

import json
import os
import shutil
import subprocess

OUTPUT_DIR = "/user/output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

workdir = "/user/workspace/repo"
if not os.path.isdir(workdir):
    workdir = "/user/workspace" if os.path.isdir("/user/workspace") else "."

code = 0
with open(os.path.join(OUTPUT_DIR, "test.log"), "w") as log:
    if shutil.which("bun") and os.path.exists(os.path.join(workdir, "package.json")):
        code = subprocess.call(
            ["bun", "test"], cwd=workdir, stdout=log, stderr=subprocess.STDOUT
        )
    elif os.path.exists(os.path.join(workdir, "pyproject.toml")) or os.path.exists(
        os.path.join(workdir, "pytest.ini")
    ):
        code = subprocess.call(
            ["python", "-m", "pytest", "-q"],
            cwd=workdir,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    else:
        log.write("no recognized test runner\n")

status = "pass" if code == 0 else "fail"
with open(os.path.join(OUTPUT_DIR, "result.json"), "w") as f:
    json.dump({"check": "tests", "status": status, "exitCode": code}, f)

# Exit 0 regardless: the verdict is in result.json; the workflow branches on it.
