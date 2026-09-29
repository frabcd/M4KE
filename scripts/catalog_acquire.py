#!/usr/bin/env python3
"""One-time manufacturer-source acquisition. Runtime geometry does not use network.

Run on the DGX. Only the fixed public URLs below are fetched; no supplier login,
ordering, model inference, executable download, or printer action is available.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import time
import urllib.parse
import urllib.request
import zipfile

COMMIT = "04f6f23f995a4a0c8b944c07b2d74d602898c528"
SOURCES = [
    ("pico-step.zip", "https://pip-assets.raspberrypi.com/categories/610-raspberry-pi-pico/documents/RP-008311-DS-1-Pico-R3-step.zip", "manufacturer STEP archive, Pico R3"),
    ("pico-product-brief.pdf", "https://pip-assets.raspberrypi.com/categories/610-raspberry-pi-pico/documents/RP-008308-DS-1-pico-product-brief.pdf", "manufacturer dimensional drawing, RP-008308-DS-1"),
    ("pico-resources.html", "https://pip.raspberrypi.com/categories/610-raspberry-pi-pico", "manufacturer revisioned resource index"),
    ("pololu-2130.step", "https://www.pololu.com/file/0J1616/drv8833-dual-motor-driver-carrier-step.step", "manufacturer STEP, md17a carrier"),
    ("pololu-2130-dimensions.pdf", "https://www.pololu.com/file/0J1615/drv8833-dual-motor-driver-carrier-dimensions.pdf", "manufacturer drawing, md17a, 2018-10-26"),
    ("pololu-2130-drill.dxf", "https://www.pololu.com/file/0J990/md17a-drill.dxf", "manufacturer hole-coordinate drawing"),
    ("pololu-2130-product.html", "https://www.pololu.com/product/2130", "manufacturer product specifications"),
    ("pololu-micro-motors-step.zip", "https://www.pololu.com/file/0J2042/Pololu%20Micro%20Metal%20Gearmotor%203D%20(STEP)%20Models.zip", "manufacturer motor family STEP archive; variant selection required"),
    ("pololu-micro-motors-dimensions.pdf", "https://www.pololu.com/file/0J949/micro-metal-gearmotors-dimensions.pdf", "manufacturer dimensional drawing family, 2024-04-03"),
    ("pololu-micro-motors-datasheet.pdf", "https://www.pololu.com/file/0J1487/pololu-micro-metal-gearmotors-rev-6-2.pdf", "manufacturer motor family performance datasheet revision 6.2"),
    ("pololu-992-product.html", "https://www.pololu.com/product/992", "manufacturer #992 100:1 LP6V specifications"),
    ("pololu-1098-product.html", "https://www.pololu.com/product/1098", "manufacturer #1098 50:1 LP6V specifications"),
    ("pololu-1086.step", "https://www.pololu.com/file/0J1723/micro-metal-gearmotor-bracket.step", "manufacturer #1086 standalone bracket STEP"),
    ("pololu-1086-product.html", "https://www.pololu.com/product/1086", "manufacturer #1086 bracket and hardware specifications"),
    ("pololu-1420-step.zip", "https://www.pololu.com/file/0J1292/pololu-wheel-60%C3%978mm.zip", "manufacturer 60x8 mm wheel family STEP archive"),
    ("pololu-wheel-dimensions.pdf", "https://www.pololu.com/file/0J1708/pololu-wheel-dimensions.pdf", "manufacturer wheel drawing, 60x8 mm page 3, 2019-09-12"),
    ("pololu-1420-product.html", "https://www.pololu.com/product/1420", "manufacturer #1420 wheel, 3 mm D-shaft compatibility"),
    ("pololu-950.step", "https://www.pololu.com/file/0J1637/pololu-ball-caster-with-0-375in-ball.step", "manufacturer #950 caster STEP"),
    ("pololu-950-dimensions.pdf", "https://www.pololu.com/file/0J1636/pololu-ball-caster-with-0-375in-ball.pdf", "manufacturer 3/8 inch ball caster dimensional drawing"),
    ("pololu-950-product.html", "https://www.pololu.com/product/950", "manufacturer #950 caster and hardware specifications"),
    ("adafruit-1063.brd", f"https://raw.githubusercontent.com/adafruit/Adafruit-MAX4466-Electret-Mic-Amplifier-PCBs/{COMMIT}/Adafruit%20MAX4466%20Mic%20Amp.brd", "manufacturer Eagle board source"),
    ("adafruit-1063.sch", f"https://raw.githubusercontent.com/adafruit/Adafruit-MAX4466-Electret-Mic-Amplifier-PCBs/{COMMIT}/Adafruit%20MAX4466%20Mic%20Amp.sch", "manufacturer Eagle schematic source"),
    ("adafruit-1063-license.txt", f"https://raw.githubusercontent.com/adafruit/Adafruit-MAX4466-Electret-Mic-Amplifier-PCBs/{COMMIT}/license.txt", "upstream design license"),
    ("adafruit-1063-readme.md", f"https://raw.githubusercontent.com/adafruit/Adafruit-MAX4466-Electret-Mic-Amplifier-PCBs/{COMMIT}/README.md", "upstream attribution and design description"),
    ("adafruit-1063-product.html", "https://www.adafruit.com/product/1063", "manufacturer product and height specification"),
]
ALLOWED_HOSTS = {urllib.parse.urlsplit(url).hostname for _, url, _ in SOURCES} | {"a.pololu-files.com"}
MAX_BYTES = 90 * 1024 * 1024


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class PublicRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
            raise ValueError("Unapproved source redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def acquire(root, item, existing):
    name, url, role = item
    target = root / "sources" / name
    old = existing.get(name)
    if old and target.is_file() and sha(target) == old["sha256"]:
        return old
    if target.exists():
        raise ValueError("Existing unverified file will not be overwritten: " + name)
    opener = urllib.request.build_opener(PublicRedirects())
    error = None
    for attempt in range(3):
        temp = target.with_suffix(target.suffix + ".partial")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "M4KE-source-archive/1.0", "Accept": "*/*"})
            with opener.open(req, timeout=45) as response, temp.open("wb") as out:
                total = 0
                header = b""
                while block := response.read(256 * 1024):
                    if not header:
                        header = block[:128]
                    total += len(block)
                    if total > MAX_BYTES:
                        raise ValueError("Source exceeds byte limit")
                    out.write(block)
                if name.endswith(".pdf") and not header.startswith(b"%PDF"):
                    raise ValueError("Expected PDF source")
                if name.endswith(".zip") and not header.startswith(b"PK"):
                    raise ValueError("Expected ZIP source")
                if name.endswith(".step") and b"ISO-10303-21" not in header:
                    raise ValueError("Expected STEP source")
                if not total:
                    raise ValueError("Empty source")
                final_url = response.url
            record = {"name": name, "path": "sources/" + name, "url": url, "finalUrl": final_url,
                      "role": role, "bytes": total, "sha256": sha(temp),
                      "capturedAt": datetime.now(timezone.utc).isoformat()}
            temp.replace(target)
            return record
        except Exception as exc:
            error = exc
            time.sleep(attempt + 1)
    raise RuntimeError(f"Source acquisition failed for {name}: {error}")


def extract_step_archives(root, records):
    """Preserve every variant filename; never choose a variant by first entry."""
    entries = []
    for record in records:
        if not record["name"].endswith(".zip"):
            continue
        archive = root / record["path"]
        folder = {"pico-step.zip": "pico", "pololu-micro-motors-step.zip": "pololu-motors", "pololu-1420-step.zip": "pololu-wheels-60x8"}[record["name"]]
        with zipfile.ZipFile(archive) as z:
            if len(z.infolist()) > 500 or sum(x.file_size for x in z.infolist()) > 350 * 1024 * 1024:
                raise ValueError("Archive expansion limit")
            for info in z.infolist():
                if info.is_dir():
                    continue
                rel = PurePosixPath(info.filename)
                if "__MACOSX" in rel.parts or rel.name.startswith("._"):
                    continue
                if rel.is_absolute() or ".." in rel.parts or "\\" in info.filename or ":" in info.filename:
                    raise ValueError("Unsafe archive path")
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Archive symlink forbidden")
                if rel.suffix.lower() not in {".step", ".stp", ".txt", ".pdf"}:
                    continue
                dest = root / "models" / folder / Path(*rel.parts)
                data = z.read(info)
                digest = hashlib.sha256(data).hexdigest()
                if dest.exists() and sha(dest) != digest:
                    raise ValueError("Existing model differs; refusing overwrite")
                dest.parent.mkdir(parents=True, exist_ok=True)
                if not dest.exists():
                    dest.write_bytes(data)
                entries.append({"path": dest.relative_to(root).as_posix(), "archiveMember": info.filename,
                                "bytes": len(data), "sha256": digest,
                                "parentPath": record["path"], "parentSha256": record["sha256"]})
    return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-root", type=Path, default=Path(__file__).resolve().parents[1] / "catalog")
    args = parser.parse_args()
    root = args.catalog_root.resolve()
    (root / "sources").mkdir(parents=True, exist_ok=True)
    index = root / "source-index.json"
    old = json.loads(index.read_text()) if index.exists() else {"sources": []}
    previous_errors = old.get("previousErrors", []) + old.get("errors", [])
    existing = {r["name"]: r for r in old["sources"]}
    records, errors = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = {pool.submit(acquire, root, item, existing): item for item in SOURCES}
        for task in as_completed(tasks):
            try:
                record = task.result()
                records.append(record)
                print(json.dumps({"source": record["name"], "bytes": record["bytes"], "sha256": record["sha256"]}), flush=True)
            except Exception as exc:
                errors.append({"source": tasks[task][0], "error": str(exc)})
            # A process interruption must not erase provenance for already archived
            # files whose task has not completed in this invocation yet.
            checkpoint = {**existing, **{r["name"]: r for r in records}}
            index.write_text(json.dumps({"schemaVersion": 1, "sources": sorted(checkpoint.values(), key=lambda r: r["name"]), "errors": errors, "previousErrors": previous_errors}, indent=2), encoding="utf-8")
    entries = extract_step_archives(root, records)
    (root / "model-inventory.json").write_text(json.dumps(entries, indent=2), encoding="utf-8")
    print(json.dumps({"sourceCount": len(records), "modelCount": len(entries), "errors": errors, "models": [x["path"] for x in entries]}), flush=True)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
