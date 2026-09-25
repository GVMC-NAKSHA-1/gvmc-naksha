"""python -m naksha_data <command>   (inside the `data` container: docker compose --profile data run --rm data <command>)

  fetch                         download OSM, Overture buildings and Copernicus terrain (cached)
  wards                         generate the 98 ward zones → out/wards.geojson
  build [--wards 4,12]          write every ward's layers + manifest.json + answers.json
  load-wards [--file F] [--drop-demo]
                                upsert wards (outline, bbox, storage file) and re-home alerts
  load [--dir D] [--wards …]    upload each ward's manifest through the API (resumable)
  wait                          block until the pipeline queue is empty
  finish [--wards …]            per-ward change detection (2023 survey vs AI extraction)
  status                        sources, jobs, failures, totals
  score [--wards …]             recall of injected topology defects and changes
  all [--wards …]               fetch → wards → build → load-wards → load → wait → finish → wait → score
"""
import argparse
import sys
import time

from . import common


def _wards(s):
    return [w.strip() for w in s.split(",") if w.strip()] if s else None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="naksha_data", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["fetch", "wards", "build", "load-wards", "load", "wait", "finish", "status", "score", "all"])
    ap.add_argument("--wards", type=_wards, help="comma-separated ward ids (default: all)")
    ap.add_argument("--file", default=None, help="wards GeoJSON (id, name properties); default out/wards.geojson")
    ap.add_argument("--dir", default=common.OUT, help="folder with ward-<id>/manifest.json")
    ap.add_argument("--drop-demo", action="store_true", help="delete the hand-made demo layers before loading")
    a = ap.parse_args(argv)
    t0 = time.time()

    if a.command in ("fetch", "all"):
        from . import fetch
        fetch.all_sources()
    if a.command in ("wards", "all"):
        from . import fetch, wards
        wards.build(fetch.osm(), fetch.buildings())
    if a.command in ("build", "all"):
        from . import build, fetch
        ward_list = build.wards_from_file(a.file or common.path("wards.geojson"))
        if a.wards:
            ward_list = [w for w in ward_list if w["id"] in a.wards]
        ctx = build.context(fetch.osm(), fetch.buildings(), fetch.dem())
        for w in ward_list:
            build.build_ward(w, ctx)
    if a.command in ("load-wards", "all"):
        from . import load
        load.load_wards(a.file or common.path("wards.geojson"), drop_demo=a.drop_demo or a.command == "all")
    if a.command in ("load", "all"):
        from . import load
        load.load_dir(a.dir, a.wards)
    if a.command in ("wait", "all"):
        from . import load
        load.wait()
    if a.command in ("finish", "all"):
        from . import load
        load.finish(a.wards)
        if a.command == "all":
            load.wait()
    if a.command == "status":
        from . import load
        load.status()
    if a.command in ("score", "all"):
        from . import load
        load.score(a.dir, a.wards)
    print(f"[naksha_data] {a.command} finished in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
