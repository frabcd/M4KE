#!/usr/bin/env python3
"""One-time DGX aarch64 Bambu setup, user-local only; never printer operations."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "printing/dgx"
APP = "com.bambulab.BambuStudio"
APP_COMMIT = "fa17d48b6e2a3bd367c8a534a651826a5b14b23477d69d823471a215aeda60da"
RECIPE_COMMIT_PREFIX = "25f4f1868caa"
SOURCE_COMMIT = "926a7192574bcb9b3a732e1ec59a46d79cb45466"
RUNTIME_COMMIT = "2c2defd356838e7856eaf5edda36d43b4ea14a9b8e485a842a30557f81acd352"
PACKAGES = {"flatpak": "1.14.6-1ubuntu0.1", "libostree-1-1": "2024.5-1build2",
            "libavahi-glib1": "0.8-13ubuntu6.2", "xvfb": "2:21.1.12-1ubuntu1.8",
            "xserver-common": "2:21.1.12-1ubuntu1.8"}

def command(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    if platform.machine() != "aarch64":
        raise RuntimeError("DGX aarch64 only; no x86 emulation or driver changes")
    debs, tools = BASE / "tools/debs", BASE / "tools/root"
    for folder in (debs, tools, BASE / "evidence"):
        folder.mkdir(parents=True, exist_ok=True)
    records = []
    for name, version in PACKAGES.items():
        metadata = command(["apt-cache", "show", f"{name}={version}"], capture_output=True).stdout
        expected = next(line.split(": ", 1)[1] for line in metadata.splitlines() if line.startswith("SHA256: "))
        candidates = [p for p in debs.glob(f"{name}_*.deb") if sha(p) == expected]
        if not candidates:
            command(["apt-get", "download", f"{name}={version}"], cwd=debs)
            candidates = [p for p in debs.glob(f"{name}_*.deb") if sha(p) == expected]
        if len(candidates) != 1:
            raise RuntimeError("Exact authenticated Ubuntu package SHA not found: " + name)
        path = candidates[0]
        # Extract files only; no maintainer scripts, dpkg installation, sudo or service changes.
        command(["dpkg-deb", "-x", str(path), str(tools)])
        records.append({"package": name, "version": version, "sha256": expected, "file": path.name})
    env = {**os.environ, "LD_LIBRARY_PATH": str(tools / "usr/lib/aarch64-linux-gnu"),
           "FLATPAK_USER_DIR": str(BASE / "flatpak"), "FLATPAK_BWRAP": "/usr/bin/bwrap"}
    flatpak = str(tools / "usr/bin/flatpak")
    command([flatpak, "--version"], env=env)
    command([flatpak, "--user", "remote-add", "--if-not-exists", "m4ke-flathub", "https://dl.flathub.org/repo/flathub.flatpakrepo"], env=env)
    remote = command([flatpak, "--user", "remote-info", "--arch=aarch64", "--show-commit", "m4ke-flathub", APP], env=env, capture_output=True).stdout.strip()
    if remote != APP_COMMIT:
        raise RuntimeError("Flathub current commit differs from reviewed lock; review new source before updating")
    with urllib.request.urlopen("https://api.github.com/repos/flathub/com.bambulab.BambuStudio/commits/" + RECIPE_COMMIT_PREFIX, timeout=30) as response:
        recipe_commit = json.load(response)["sha"]
    recipe_url = f"https://raw.githubusercontent.com/flathub/com.bambulab.BambuStudio/{recipe_commit}/com.bambulab.BambuStudio.yml"
    with urllib.request.urlopen(recipe_url, timeout=30) as response:
        recipe_bytes = response.read(200000)
    if SOURCE_COMMIT.encode() not in recipe_bytes or b"runtime-version: '50'" not in recipe_bytes:
        raise RuntimeError("Recipe does not match reviewed source/runtime")
    (BASE / "evidence/flathub-recipe.yml").write_bytes(recipe_bytes)
    lock = {"schemaVersion": 1, "architecture": "aarch64", "app": APP, "appCommit": APP_COMMIT,
            "sourceCommit": SOURCE_COMMIT, "runtimeCommit": RUNTIME_COMMIT, "recipeCommit": recipe_commit, "recipeUrl": recipe_url,
            "recipeSha256": hashlib.sha256(recipe_bytes).hexdigest(), "ubuntuPackages": records,
            "systemPackagesModified": False, "nvidiaDriversModified": False, "printerOperations": False}
    (BASE / "setup-lock.json").write_text(json.dumps(lock, indent=2))
    command([flatpak, "--user", "install", "--no-related", "--noninteractive", "--assumeyes", "--arch=aarch64", "m4ke-flathub", APP], env=env)
    actual = command([flatpak, "--user", "info", "--show-commit", APP], env=env, capture_output=True).stdout.strip()
    if actual != APP_COMMIT:
        raise RuntimeError("Installed app commit mismatch")
    actual_runtime = command([flatpak, "--user", "info", "--show-commit", "org.gnome.Platform/aarch64/50"], env=env, capture_output=True).stdout.strip()
    if actual_runtime != RUNTIME_COMMIT:
        raise RuntimeError("Runtime commit changed; review before native launch")
    command([flatpak, "--user", "info", APP], env=env)
    print(json.dumps({"status": "APP_INSTALLED_CAPABILITY_PROBE_REQUIRED", "appCommit": actual, "printerConnected": False}))

if __name__ == "__main__":
    main()
