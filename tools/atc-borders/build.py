"""Builds public/data/atc-borders.json, the /atc map's border overlay.

India as the Survey of India draws it, from Natural Earth's India point of
view (public domain), plus Natural Earth's other disputed lines so hiding the
basemap's disputed lines leaves no gaps elsewhere. tower-map-style.ts loads it.

    mkdir -p /tmp/ne && cd /tmp/ne
    curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson
    curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_boundary_lines_land.geojson
    python3 -I tools/atc-borders/build.py /tmp/ne public/data/atc-borders.json
"""
import json, sys
src, out = sys.argv[1], sys.argv[2]
countries = json.load(open(src + "/ne_10m_admin_0_countries_ind.geojson"))
lines = json.load(open(src + "/ne_10m_admin_0_boundary_lines_land.geojson"))

def rings(g):
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    return [r for p in polys for r in p]

by = {f["properties"]["ADM0_A3"]: f["geometry"] for f in countries["features"]}
key = lambda c: (round(c[0], 6), round(c[1], 6))
neighbours = set()
for code in ("PAK", "CHN", "NPL", "BTN", "BGD", "MMR", "AFG"):
    for r in rings(by[code]):
        neighbours.update(key(c) for c in r)
china = {key(c) for r in rings(by["CHN"]) for c in r}

BOXES = [(72.0, 32.2, 80.7, 37.2), (91.4, 26.5, 97.6, 29.7)]
inside = lambda c: any(a <= c[0] <= b and lo <= c[1] <= hi for a, lo, b, hi in BOXES)

def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    n = (dx * dx + dy * dy) ** 0.5 or 1e-12
    i, d = max(((i, abs(dy * (p[0] - x1) - dx * (p[1] - y1)) / n) for i, p in enumerate(pts[1:-1], 1)), key=lambda t: t[1])
    if d <= eps: return [pts[0], pts[-1]]
    return rdp(pts[: i + 1], eps)[:-1] + rdp(pts[i:], eps)

def runs(ring, keep):
    out, cur = [], []
    for a, b in zip(ring, ring[1:]):
        if keep(a, b):
            if not cur: cur = [a]
            cur.append(b)
        elif cur:
            out.append(cur); cur = []
    if cur: out.append(cur)
    return out

parts = []
for r in rings(by["IND"]):
    parts += runs(r, lambda a, b: (key(a) in china and key(b) in china)
                  or (key(a) in neighbours and key(b) in neighbours and inside(a) and inside(b)))

# Other disputed lines, so hiding the basemap's doesn't leave gaps elsewhere.
INDIA = {"B00", "B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B45"}
others = []
for f in lines["features"]:
    p = f["properties"]
    if p["FEATURECLA"] == "International boundary (verify)" or p["BRK_A3"] in INDIA: continue
    if (p["FCLASS_IN"] or p["FEATURECLA"]) == "Unrecognized": continue
    g = f["geometry"]
    others += g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]

def clean(ls):
    return [[round(x, 3), round(y, 3)] for x, y in rdp(ls, 0.004)]

feature = lambda kind, ls: {"type": "Feature", "properties": {"kind": kind},
                            "geometry": {"type": "MultiLineString", "coordinates": [clean(l) for l in ls if len(l) > 1]}}
json.dump({"type": "FeatureCollection", "features": [feature("india", parts), feature("disputed", others)]},
          open(out, "w"), separators=(",", ":"))
print(len(parts), "india runs,", sum(len(p) for p in parts), "pts;", len(others), "other lines")
