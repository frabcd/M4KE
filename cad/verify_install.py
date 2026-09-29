"""Compare the 3 pinned kernel package wheel hashes to upstream PyPI metadata.

Used after a mirror installation, never required for offline CAD operation.
The pip report supplies the downloaded archive digest, not an inferred filename.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import platform
from urllib.parse import unquote, urlparse
from urllib.request import urlopen

PINS = {"cadquery": "2.8.0", "cadquery-ocp": "7.9.3.1.1", "vtk": "9.6.2"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pip-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--lock", type=Path)
    args = parser.parse_args()
    report = json.loads(args.pip_report.read_text())
    installed = {entry["metadata"]["name"].lower().replace("_", "-"): entry for entry in report["install"]}

    def verify(pair):
        name, version = pair
        url = f"https://pypi.org/pypi/{name}/{version}/json"
        with urlopen(url, timeout=90) as response:
            upstream = json.load(response)
        entry = installed[name]
        download = entry["download_info"]
        filename = unquote(Path(urlparse(download["url"]).path).name)
        expected = next(asset for asset in upstream["urls"] if asset["filename"] == filename)
        digest = download["archive_info"]["hashes"]["sha256"]
        actual_version = importlib.metadata.version(name)
        return {"name": name, "version": actual_version, "expectedVersion": version,
                "filename": filename, "downloadUrl": download["url"], "upstreamMetadata": url,
                "sha256": digest, "upstreamSha256": expected["digests"]["sha256"],
                "pass": actual_version == version and digest == expected["digests"]["sha256"]}

    with ThreadPoolExecutor(max_workers=3) as pool:
        packages = list(pool.map(verify, PINS.items()))
    result = {"checkedAt": datetime.now(timezone.utc).isoformat(), "python": platform.python_version(),
              "machine": platform.machine(), "platform": platform.platform(), "packages": packages,
              "ok": all(p["pass"] for p in packages)}
    if args.lock and result["ok"]:
        dependencies = sorted({f"{dist.metadata['Name']}=={dist.version}" for dist in importlib.metadata.distributions()})
        args.lock.write_text("# Observed isolated DGX Python environment. Linux aarch64 / Python 3.12.\n" + "\n".join(dependencies) + "\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, separators=(",", ":")))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
