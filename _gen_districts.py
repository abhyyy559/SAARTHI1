"""One-off generator for backend/data/districts_telangana_andhra.json.

Coordinates come from two places, and the file records which:
  - "gadm"   : area-weighted centroid of the district polygon, from the GADM
               level-2 dataset for India (real geometry, not a guess).
  - "hq"     : the district headquarters town. Used for districts created after
               GADM's vintage (Telangana 2016 reorganisation, Andhra 2022), which
               have no polygon in that dataset. Approximate by nature - a district
               HQ is a real place, but it is not the district centroid.

This distinction is kept in the output so nobody later mistakes an HQ pin for
surveyed geometry. Matching alerts to a district is NAME based, so coordinate
precision does not affect whether an alert is shown - only nearest-district
resolution for a GPS fix.
"""
import json
import math

GADM = "C:/Users/home/OneDrive/Documents/work/projects/SAARTHI/_tmp_districts.json"
OUT = "C:/Users/home/OneDrive/Documents/work/projects/SAARTHI/weathergpt/backend/data/districts_telangana_andhra.json"

# Modern Telangana districts (33, 2016 reorganisation) with headquarters town.
TELANGANA = {
    "Adilabad": (19.6640, 78.5320), "Bhadradri Kothagudem": (17.5500, 80.6200),
    "Hanumakonda": (18.0100, 79.5600), "Hyderabad": (17.3850, 78.4867),
    "Jagtial": (18.7900, 78.9100), "Jangaon": (17.7200, 79.1500),
    "Jayashankar Bhupalpally": (18.4300, 79.8600), "Jogulamba Gadwal": (16.2300, 77.8000),
    "Kamareddy": (18.3200, 78.3400), "Karimnagar": (18.4390, 79.1290),
    "Khammam": (17.2470, 80.1510), "Komaram Bheem Asifabad": (19.3600, 79.2800),
    "Mahabubabad": (17.6000, 80.0000), "Mahabubnagar": (16.7400, 77.9800),
    "Mancherial": (18.8700, 79.4400), "Medak": (18.0500, 78.2600),
    "Medchal Malkajgiri": (17.6300, 78.4800), "Mulugu": (18.1900, 79.9400),
    "Nagarkurnool": (16.4800, 78.3200), "Nalgonda": (17.0500, 79.2700),
    "Narayanpet": (16.7400, 77.5000), "Nirmal": (19.1000, 78.3400),
    "Nizamabad": (18.6720, 78.0940), "Peddapalli": (18.6200, 79.3800),
    "Rajanna Sircilla": (18.4000, 78.8100), "Rangareddy": (17.3200, 78.3400),
    "Sangareddy": (17.6200, 78.0800), "Siddipet": (18.1000, 78.8500),
    "Suryapet": (17.1400, 79.6200), "Vikarabad": (17.3400, 77.9000),
    "Wanaparthy": (16.3600, 78.0600), "Warangal": (17.9700, 79.5900),
    "Yadadri Bhuvanagiri": (17.5900, 78.9500),
}

# Modern Andhra Pradesh districts (26, 2022 reorganisation).
ANDHRA = {
    "Alluri Sitharama Raju": (17.8000, 82.0000), "Anakapalli": (17.6900, 82.9900),
    "Anantapur": (14.6800, 77.6000), "Annamayya": (13.8000, 78.5000),
    "Bapatla": (15.9000, 80.4700), "Chittoor": (13.2200, 79.1000),
    "Dr. B.R. Ambedkar Konaseema": (16.6000, 82.0000), "East Godavari": (17.0000, 81.8000),
    "Eluru": (16.7100, 81.1000), "Guntur": (16.3000, 80.4400),
    "Kakinada": (16.9600, 82.2400), "Krishna": (16.1900, 81.1300),
    "Kurnool": (15.8300, 78.0400), "Nandyal": (15.4800, 78.4800),
    "Nellore": (14.4400, 79.9900), "NTR": (16.5100, 80.6300),
    "Palnadu": (16.2400, 79.9800), "Parvathipuram Manyam": (18.7800, 83.4200),
    "Prakasam": (15.5000, 79.9000), "Srikakulam": (18.3000, 83.9000),
    "Sri Sathya Sai": (14.1700, 77.8000), "Tirupati": (13.6300, 79.4200),
    "Visakhapatnam": (17.6900, 83.2200), "Vizianagaram": (18.1100, 83.4100),
    "West Godavari": (16.5400, 81.5200), "YSR Kadapa": (14.4700, 78.8200),
}

# Districts with a sea coast. Drives the "you are inland, sea advice does not
# apply" statement, so it is a safety flag, not a nicety.
COASTAL_AP = {
    "Srikakulam", "Vizianagaram", "Visakhapatnam", "Anakapalli", "Kakinada",
    "Dr. B.R. Ambedkar Konaseema", "East Godavari", "West Godavari", "Krishna",
    "NTR", "Guntur", "Bapatla", "Prakasam", "Nellore", "Tirupati",
}

# The CAP feeds spell some districts differently from the official name. Both
# spellings must match, or an alert naming "Ranga Reddy" misses a user in
# "Rangareddy" - which is exactly the bug this data exists to fix.
ALIASES = {
    "Rangareddy": ["Ranga Reddy", "Rangareddi", "RangaReddy"],
    "Medchal Malkajgiri": ["Medchal", "Malkajgiri"],
    "Mahabubnagar": ["Mahbubnagar"],
    "YSR Kadapa": ["Kadapa", "Cuddapah"],
    "Nellore": ["SPSR Nellore"],
    "NTR": ["Vijayawada"],
    "Kakinada": ["Kakinada Rural", "Samalkota"],
    "Siddipet": ["Siddipeta"],
    "Jangaon": ["Jangoan", "Janagaon"],
    "Yadadri Bhuvanagiri": ["Yadadri", "Bhuvanagiri", "Yadadri Bhongir"],
    "Jayashankar Bhupalpally": ["Jayashankar", "Bhupalpally", "Bhupalpalli"],
    "Komaram Bheem Asifabad": ["Komaram Bheem", "Asifabad", "Kumuram Bheem"],
    "Bhadradri Kothagudem": ["Bhadradri", "Kothagudem"],
    "Rajanna Sircilla": ["Rajanna", "Sircilla"],
    "Jogulamba Gadwal": ["Jogulamba", "Gadwal"],
    "Alluri Sitharama Raju": ["Alluri", "Sitharama Raju", "Paderu"],
    "Parvathipuram Manyam": ["Parvathipuram", "Manyam"],
    "Dr. B.R. Ambedkar Konaseema": ["Konaseema", "Amalapuram"],
    "Sri Sathya Sai": ["Sathya Sai", "Puttaparthi"],
    "Annamayya": ["Rayachoti"],
    "West Godavari": ["Bhimavaram", "Godavari West"],
    "Nandyal": ["Nandyalum"],
    "Palnadu": ["Narasaraopet"],
}


def centroid(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    best, best_area = None, 0.0
    for poly in polys:
        ring = poly[0]
        a = cx = cy = 0.0
        for i in range(len(ring) - 1):
            x0, y0 = ring[i][:2]
            x1, y1 = ring[i + 1][:2]
            cr = x0 * y1 - x1 * y0
            a += cr
            cx += (x0 + x1) * cr
            cy += (y0 + y1) * cr
        a *= 0.5
        if abs(a) > abs(best_area):
            best_area, best = a, (cx / (6 * a), cy / (6 * a))
    return best


def main():
    gadm = json.load(open(GADM, encoding="utf-8"))
    real = {}
    for f in gadm["features"]:
        p = f["properties"]
        if p["NAME_1"] not in ("Telangana", "Andhra Pradesh"):
            continue
        c = centroid(f["geometry"])
        if c:
            real[p["NAME_2"]] = (round(c[1], 4), round(c[0], 4))

    out = []
    for state, table in (("Telangana", TELANGANA), ("Andhra Pradesh", ANDHRA)):
        for name, (lat, lon) in sorted(table.items()):
            src = "hq"
            if name in real:
                lat, lon = real[name]
                src = "gadm"
            out.append({
                "district": name,
                "state": state,
                "latitude": lat,
                "longitude": lon,
                "coastal": name in COASTAL_AP,
                "coord_source": src,
                "aliases": sorted({name, *ALIASES.get(name, [])}),
            })

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    n_hq = sum(1 for r in out if r["coord_source"] == "hq")
    print(f"wrote {len(out)} districts -> {OUT}")
    print(f"  gadm centroids: {len(out) - n_hq}   hq (approximate): {n_hq}")
    print(f"  coastal: {sum(1 for r in out if r['coastal'])}")


if __name__ == "__main__":
    main()
