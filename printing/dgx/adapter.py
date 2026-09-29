"""DGX-only Bambu CLI capability probe. No cloud, pairing, upload or print API."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import time
import seccomp_offline
import profiles
import shutil
import zipfile

BASE = Path(__file__).resolve().parent
APP = "com.bambulab.BambuStudio"
EXPECTED_COMMIT = "fa17d48b6e2a3bd367c8a534a651826a5b14b23477d69d823471a215aeda60da"
EXPECTED_BINARY_SHA256 = "00968cb2f8bb385925f3dbeb96f34502594293c32ca2be5e7603718a59802351"
EXPECTED_RUNTIME_COMMIT = "2c2defd356838e7856eaf5edda36d43b4ea14a9b8e485a842a30557f81acd352"

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def environment():
    if platform.machine() != "aarch64":
        raise RuntimeError("Native DGX aarch64 required")
    return {**os.environ, "LD_LIBRARY_PATH": str(BASE / "tools/root/usr/lib/aarch64-linux-gnu"),
            "FLATPAK_USER_DIR": str(BASE / "flatpak"), "FLATPAK_BWRAP": "/usr/bin/bwrap",
            "LIBGL_ALWAYS_SOFTWARE": "1", "GDK_BACKEND": "x11"}

def fp(args, timeout=30):
    return subprocess.run([str(BASE / "tools/root/usr/bin/flatpak"), *args], env=environment(),
                          capture_output=True, text=True, timeout=timeout)

def installed():
    run = fp(["--user", "info", "--show-commit", APP])
    if run.returncode or run.stdout.strip() != EXPECTED_COMMIT:
        raise RuntimeError("Exact pinned app not installed: " + run.stderr.strip())
    run = fp(["--user", "info", "--show-location", APP])
    if run.returncode:
        raise RuntimeError(run.stderr.strip())
    location = Path(run.stdout.strip()).resolve(strict=True)
    if not location.is_relative_to((BASE / "flatpak").resolve()):
        raise RuntimeError("Flatpak location outside dedicated installation")
    if sha(location / "files/bin/bambu-studio") != EXPECTED_BINARY_SHA256:
        raise RuntimeError("Native app binary SHA256 mismatch")
    return location

@contextmanager
def display():
    # Private X server, local Unix socket only; lifetime bounded to the invocation.
    number = next(n for n in range(191, 230) if not Path(f"/tmp/.X11-unix/X{n}").exists())
    logfile = BASE / "evidence/xvfb.log"
    logfile.parent.mkdir(parents=True, exist_ok=True)
    with logfile.open("ab") as stream:
        proc = subprocess.Popen([str(BASE / "tools/root/usr/bin/Xvfb"), f":{number}", "-screen", "0", "1280x720x24", "-nolisten", "tcp", "-noreset"],
                                env=environment(), stdout=stream, stderr=stream)
        try:
            for _ in range(50):
                if proc.poll() is not None:
                    raise RuntimeError("Private Xvfb failed; inspect printing/dgx/evidence/xvfb.log")
                if Path(f"/tmp/.X11-unix/X{number}").exists():
                    break
                time.sleep(.1)
            else:
                raise RuntimeError("Private Xvfb readiness timeout")
            yield f":{number}"
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()

def offline_cli(args, workspace, timeout=120, command="bambu-studio"):
    location = installed()
    workspace = Path(workspace).resolve(strict=True)
    if not workspace.is_relative_to(BASE.resolve()):
        raise ValueError("CLI workspace must be inside printing/dgx")
    with display() as screen:
        cmd = [str(BASE / "tools/root/usr/bin/flatpak"), "run", "--user", "--unshare=network",
               "--nodevice=all", "--nosocket=session-bus", "--nosocket=system-bus", "--nofilesystem=home",
               "--nofilesystem=/media", "--nofilesystem=/run/media", "--nofilesystem=xdg-run/gvfs",
               f"--filesystem={workspace}", "--env=LIBGL_ALWAYS_SOFTWARE=1", "--env=GDK_BACKEND=x11",
               f"--env=DISPLAY={screen}", f"--command={command}", APP, *args]
        env = {**environment(), "DISPLAY": screen}
        trial = subprocess.run(cmd, env=env, cwd=workspace, capture_output=True, text=True, timeout=timeout)
        if trial.returncode == 0 or not ("bwrap:" in trial.stderr and ("Operation not permitted" in trial.stderr or "Permission denied" in trial.stderr)):
            trial.isolation = "flatpak-network-namespace"
            return trial
        # Do not change host security policy. Run the same pinned native binary
        # with a stricter socket-family kernel filter, not an LD_PRELOAD shim.
        (BASE / "evidence/flatpak-namespace-failure.txt").write_text(trial.stderr)
        runtime_run = fp(["--user", "info", "--show-location", "org.gnome.Platform/aarch64/50"])
        if runtime_run.returncode:
            raise RuntimeError(runtime_run.stderr)
        runtime = Path(runtime_run.stdout.strip()).resolve(strict=True) / "files"
        if runtime.parent.name != EXPECTED_RUNTIME_COMMIT:
            raise RuntimeError("Native runtime commit changed; review before execution")
        if not runtime.is_relative_to((BASE / "flatpak").resolve()):
            raise RuntimeError("Unexpected runtime path")
        app = location / "files"
        libraries = ":".join(str(p) for p in [app / "lib", runtime / "lib/aarch64-linux-gnu", runtime / "lib"])
        env.update(LD_LIBRARY_PATH=libraries, XDG_DATA_DIRS=f"{app / 'share'}:{runtime / 'share'}", HOME=str(workspace / "home"),
                   XDG_CONFIG_HOME=str(workspace / "config"), XDG_CACHE_HOME=str(workspace / "cache"))
        env.pop("LD_PRELOAD", None)
        env.pop("DBUS_SESSION_BUS_ADDRESS", None)
        for name in ["home", "config", "cache"]:
            (workspace / name).mkdir(exist_ok=True)
        commandline = [str(runtime / "lib/ld-linux-aarch64.so.1"), "--library-path", libraries, str(app / "bin/bambu-studio"), *args]
        run = seccomp_offline.run(commandline, env=env, cwd=workspace, capture_output=True, text=True, timeout=timeout)
        run.isolation = "seccomp-unix-only-no-new-privileges"
        return run

def probe():
    evidence = BASE / "evidence"
    evidence.mkdir(exist_ok=True)
    report = {"schemaVersion": 1, "at": datetime.now(timezone.utc).isoformat(), "architecture": platform.machine(),
              "appCommit": EXPECTED_COMMIT, "printerConnected": False, "printSent": False,
              "defaultPrinter": None, "sliceVerified": False, "physicalValidation": "UNKNOWN"}
    try:
        location = installed()
        files = location / "files"
        executables = list((files / "bin").glob("*bambu*"))
        profiles = [p for p in files.rglob("BBL/machine") if p.is_dir()]
        if len(profiles) != 1:
            raise RuntimeError("Ambiguous/missing BBL printer profile tree")
        machines = []
        for path in profiles[0].glob("*.json"):
            item = json.loads(path.read_text())
            if str(item.get("instantiation", "")).lower() == "true":
                machines.append({"name": item.get("name", path.stem), "sha256": sha(path), "file": str(path.relative_to(files)), "inherits": item.get("inherits")})
        report.update(profileRoot=str(profiles[0].parent), machineProfiles=machines,
                      h2cProfiles=[p for p in machines if "H2C" in p["name"]],
                      binaries=[{"name": p.name, "sha256": sha(p)} for p in executables if p.is_file()])
        run = offline_cli(["--help"], evidence, timeout=90)
        (evidence / "cli-help.stdout.txt").write_text(run.stdout)
        (evidence / "cli-help.stderr.txt").write_text(run.stderr)
        report["cliExitCode"] = run.returncode
        report["cliHelpSha256"] = sha(evidence / "cli-help.stdout.txt")
        report["networkIsolation"] = run.isolation
        report["networkDisabledByNamespace"] = run.isolation == "flatpak-network-namespace"
        report["versionHeader"] = next((s for s in run.stdout.splitlines() if "BambuStudio-" in s), None)
        report["cliVerified"] = run.returncode == 0 and report["versionHeader"] is not None and "--slice" in run.stdout
        report["status"] = "CLI_VERIFIED_SLICE_NOT_YET_TESTED" if report["cliVerified"] else "CLI_FAILED"
    except Exception as exc:
        report.update(status="CAPABILITY_BLOCKED", error=str(exc), cliVerified=False)
    report.update(available=report.get("cliVerified", False), version=report.get("versionHeader"), arch=report["architecture"],
                  networkDisabled=report.get("cliVerified", False), slicingAvailable=False)
    if report.get("profileRoot"):
        report["profiles"] = __import__("profiles").choices(Path(report["profileRoot"]))
    refresh_slice_evidence(report)
    (evidence / "capability.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0 if report.get("cliVerified") else 1

def status():
    path = BASE / "evidence/capability.json"
    report = json.loads(path.read_text()) if path.is_file() else {"available": False, "status": "NOT_PROBED", "profiles": []}
    try:
        installed()
    except Exception as exc:
        report.update(available=False, slicingAvailable=False, error=str(exc))
    report["evidenceSnapshot"] = True
    refresh_slice_evidence(report)
    print(json.dumps(report))
    return 0

def refresh_slice_evidence(report):
    verified = {}
    for id_, folder in [("h2c-04-pla-standard", "smoke-h2c-02"), ("a1mini-04-pla-standard", "smoke-a1mini-01")]:
        receipt = BASE / "jobs" / folder / "slice-evidence.json"
        if not receipt.is_file():
            continue
        r = json.loads(receipt.read_text())
        target = receipt.parent / "REVIEW-REQUIRED.3mf"
        if (r.get("status") == "SLICED_REVIEW_REQUIRED" and r.get("profileId") == id_
                and target.is_file() and r.get("files", [{}])[0].get("sha256") == sha(target)):
            verified[id_] = {"receiptSha256": sha(receipt), "artifactSha256": sha(target), "fixtureOnly": True}
    for profile in report.get("profiles", []):
        profile["sliceVerified"] = profile.get("id") in verified
    report["sliceVerified"] = bool(verified)
    report["slicingAvailable"] = bool(report.get("available") and verified)
    report["sliceSmokeEvidence"] = verified
    if report["slicingAvailable"]:
        report["status"] = "OFFLINE_NATIVE_SLICE_VERIFIED_REVIEW_REQUIRED"

def slice_part(source, profile_id, output):
    source = Path(source).resolve(strict=True)
    if source.suffix.lower() != ".stl" or source.parent.name != "parts":
        raise ValueError("Input must be a CAD-result-bound per-part STL")
    result_path = source.parent.parent / "result.json"
    result = json.loads(result_path.read_text())
    records = [p for p in result.get("parts", []) if p.get("stl") == "parts/" + source.name]
    if result.get("ok") is not True or len(records) != 1 or records[0].get("kind") != "printed" or records[0].get("valid") is not True:
        raise ValueError("Only valid printed parts from a successful CAD result are accepted")
    expected = records[0].get("sha256", {}).get("stl")
    if sha(source) != expected:
        raise ValueError("Printed STL hash mismatch")
    if not 84 <= source.stat().st_size <= 100 * 1024 * 1024:
        raise ValueError("STL byte limit")
    output = Path(output).resolve()
    if not output.is_relative_to((BASE / "jobs").resolve()) or output == (BASE / "jobs").resolve():
        raise ValueError("Output must be a fresh child directory of printing/dgx/jobs")
    app = installed() / "files"
    profile_root = next(app.rglob("BBL/machine")).parent
    selected, resolved, lineage = profiles.selection(profile_root, profile_id)
    output.mkdir(parents=True, exist_ok=False)
    copied = output / "printed-part.stl"
    shutil.copyfile(source, copied)
    for kind, value in resolved.items():
        (output / (kind + ".json")).write_text(json.dumps(value))
    target = output / "REVIEW-REQUIRED.3mf"
    args = ["--datadir", str(output / "state"), "--load-settings", str(output / "machine.json") + ";" + str(output / "process.json"),
            "--load-filaments", str(output / "filament.json"), "--curr-bed-type", selected["bed"], "--check-preset",
            "--orient", "1", "--arrange", "1", "--outputdir", str(output), "--export-3mf", target.name,
            "--slice", "0", "--mstpp", "120", str(copied)]
    run = offline_cli(args, output, timeout=240)
    (output / "stdout.txt").write_text(run.stdout)
    (output / "stderr.txt").write_text(run.stderr)
    report = {"schemaVersion": 1, "at": datetime.now(timezone.utc).isoformat(), "appCommit": EXPECTED_COMMIT,
              "runtimeCommit": EXPECTED_RUNTIME_COMMIT, "binarySha256": EXPECTED_BINARY_SHA256,
              "profileId": profile_id, "selection": selected, "profileLineage": lineage,
              "inputSha256": expected, "cadResultSha256": sha(result_path), "partId": records[0]["id"],
              "cliExitCode": run.returncode, "networkIsolation": run.isolation, "networkDisabled": True,
              "printerConnected": False, "printSent": False, "physicalValidation": "UNKNOWN", "reviewRequired": True}
    try:
        if run.returncode or not target.is_file():
            raise RuntimeError("Native slicing failed; inspect stdout.txt/stderr.txt")
        with zipfile.ZipFile(target) as archive:
            names = archive.namelist()
            if not any(n.endswith(".model") for n in names) or not any(n.endswith(".gcode") for n in names):
                raise RuntimeError("Sliced3MF missingmodel orG-code")
            settings = json.loads(archive.read("Metadata/project_settings.config"))
            for key, expected_value in [("printer_settings_id", selected["machine"]), ("print_settings_id", selected["process"]),
                                        ("filament_settings_id", [selected["filament"]]), ("curr_bed_type", selected["bed"])]:
                if settings.get(key) != expected_value:
                    raise RuntimeError("3MF selection readback mismatch: " + key)
            report["gcode"] = [{"member": n, "sha256": hashlib.sha256(archive.read(n)).hexdigest()} for n in names if n.endswith(".gcode")]
            if settings.get("nozzle_diameter") != resolved["machine"].get("nozzle_diameter"):
                raise RuntimeError("3MF nozzle readback mismatch")
            for g in report["gcode"]:
                member = g["member"]
                expected_md5 = archive.read(member + ".md5").decode("ascii").strip().lower()
                if hashlib.md5(archive.read(member)).hexdigest() != expected_md5:
                    raise RuntimeError("Native G-code integrity digest mismatch")
            report["readback"] = {k: settings.get(k) for k in ["printer_model", "printer_settings_id", "print_settings_id", "filament_settings_id", "curr_bed_type", "nozzle_diameter"]}
        report.update(status="SLICED_REVIEW_REQUIRED", files=[{"name": target.name, "sha256": sha(target), "bytes": target.stat().st_size}])
    except Exception as exc:
        report.update(status="SLICE_FAILED", error=str(exc))
    (output / "slice-evidence.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
    return 0 if report["status"] == "SLICED_REVIEW_REQUIRED" else 1

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("probe")
    sub.add_parser("status")
    item = sub.add_parser("slice")
    item.add_argument("--input", required=True)
    item.add_argument("--profile", required=True, choices=list(profiles.CHOICES))
    item.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        raise SystemExit(probe() if args.command == "probe" else status() if args.command == "status" else slice_part(args.input, args.profile, args.output))
    except Exception as exc:
        print(json.dumps({"status": "ERROR", "error": str(exc), "printSent": False}))
        raise SystemExit(1)
