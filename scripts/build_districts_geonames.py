"""Build backend/data/districts_india_geonames.json from the GeoNames India dump.

Usage: download IN.zip (unzip to IN.txt) and admin1CodesASCII.txt (saved as
admin1.txt) from https://download.geonames.org/export/dump/ into one folder, then
    python scripts/build_districts_geonames.py <folder> backend/data/districts_india_geonames.json

Data only: reads the tab-separated IN.txt and admin1CodesASCII.txt (CC BY 4.0,
GeoNames). Districts = ADM2 features. Coastal: landlocked states are inland;
in coastal states a district is coastal when GeoNames records shore features
(beach, bay, cape, lagoon, ...) inside it, otherwise unknown (None), never a
guessed "inland".
"""
import collections
import json
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(sys.argv[2])

STATE_FIX = {
    "Andaman and Nicobar": "Andaman and Nicobar Islands",
    "National Capital Territory of Delhi": "Delhi",
    "NCT": "Delhi",
    "Orissa": "Odisha",
    "Pondicherry": "Puducherry",
    "Uttaranchal": "Uttarakhand",
    "Dadra and Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",
    "Daman and Diu": "Dadra and Nagar Haveli and Daman and Diu",
}
COASTAL_STATES = {
    "Gujarat", "Maharashtra", "Goa", "Karnataka", "Kerala", "Tamil Nadu", "Andhra Pradesh",
    "Odisha", "West Bengal", "Puducherry", "Dadra and Nagar Haveli and Daman and Diu",
    "Lakshadweep", "Andaman and Nicobar Islands",
}
# Districts with a sea coast, per state (Census/coastal-district lists). Matched
# loosely within the state because GeoNames spellings vary (Baleshwar/Balasore).
KNOWN_COASTAL = {
    "Odisha": ["Baleshwar", "Balasore", "Bhadrak", "Kendrapara", "Jagatsinghpur", "Puri", "Ganjam"],
    "West Bengal": ["Purba Medinipur", "East Midnapore", "Purba Medinipur", "South 24 Parganas", "South Twenty Four Parganas"],
    "Tamil Nadu": ["Chennai", "Tiruvallur", "Thiruvallur", "Chengalpattu", "Kancheepuram", "Kanchipuram", "Viluppuram", "Villupuram",
                   "Cuddalore", "Mayiladuthurai", "Nagapattinam", "Tiruvarur", "Thiruvarur", "Thanjavur", "Pudukkottai",
                   "Ramanathapuram", "Thoothukudi", "Tuticorin", "Tirunelveli", "Kanniyakumari", "Kanyakumari"],
    "Kerala": ["Thiruvananthapuram", "Trivandrum", "Kollam", "Quilon", "Alappuzha", "Alleppey", "Ernakulam", "Thrissur",
               "Trichur", "Malappuram", "Kozhikode", "Calicut", "Kannur", "Cannanore", "Kasaragod", "Kasargod"],
    "Karnataka": ["Dakshina Kannada", "Dakshin Kannad", "Udupi", "Uttara Kannada", "Uttar Kannand", "Uttar Kannad"],
    "Goa": ["North Goa", "South Goa"],
    "Maharashtra": ["Palghar", "Thane", "Mumbai City", "Mumbai Suburban", "Mumbai", "Raigad", "Ratnagiri", "Sindhudurg"],
    "Gujarat": ["Kachchh", "Kutch", "Jamnagar", "Devbhumi Dwarka", "Dwarka", "Porbandar", "Junagadh", "Gir Somnath",
                "Amreli", "Bhavnagar", "Bharuch", "Surat", "Navsari", "Valsad", "Ahmedabad", "Morbi", "Anand"],
    "Puducherry": ["Puducherry", "Pondicherry", "Karaikal", "Mahe", "Yanam"],
    "Dadra and Nagar Haveli and Daman and Diu": ["Daman", "Diu"],
    "Lakshadweep": ["Lakshadweep"],
    "Andaman and Nicobar Islands": ["Nicobar", "North and Middle Andaman", "South Andaman", "Andaman"],
}


def _known_coastal(state, name):
    import difflib
    n = name.lower()
    for k in KNOWN_COASTAL.get(state, []):
        k = k.lower()
        if n == k or n.startswith(k) or k.startswith(n) or difflib.SequenceMatcher(None, n, k).ratio() >= 0.82:
            return True
    return False


SHORE = {"BCH", "BCHS", "CAPE", "BAY", "BAYS", "COVE", "LGN", "LGNS", "INLT", "ESTY", "SEA", "HBR", "PT", "PTS", "GULF", "CRKT"}

admin1 = {}
for line in (src / "admin1.txt").read_text(encoding="utf-8").splitlines():
    code, name, *_ = line.split("\t")
    if code.startswith("IN."):
        admin1[code[3:]] = STATE_FIX.get(name, name)

adm2 = []
shore = collections.Counter()
with (src / "IN.txt").open(encoding="utf-8") as f:
    for line in f:
        p = line.rstrip("\n").split("\t")
        if len(p) < 13:
            continue
        fcode, a1, a2 = p[7], p[10], p[11]
        if fcode == "ADM2":
            adm2.append(p)
        elif fcode in SHORE and a2:
            shore[(a1, a2)] += 1

rows, seen = [], set()
for p in adm2:
    # ASCII name: diacritics ("Bijāpur") broke the name matcher and search.
    name = (p[2] or p[1]).removesuffix(" District").removesuffix(" district").strip()
    state = admin1.get(p[10])
    if not name or not state or (state, name) in seen:
        continue
    seen.add((state, name))
    if state not in COASTAL_STATES:
        coastal = False
    else:
        coastal = True if (_known_coastal(state, name) or shore[(p[10], p[11])] > 0) else None
    aliases = [name]
    rows.append({
        "district": name, "state": state,
        "latitude": round(float(p[4]), 4), "longitude": round(float(p[5]), 4),
        "coastal": coastal, "coord_source": "geonames", "aliases": aliases,
    })

rows.sort(key=lambda r: (r["state"], r["district"]))
out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
by_state = collections.Counter(r["state"] for r in rows)
print(len(rows), "districts,", len(by_state), "states/UTs")
print("coastal True:", sum(r["coastal"] is True for r in rows),
      "unknown:", sum(r["coastal"] is None for r in rows),
      "inland:", sum(r["coastal"] is False for r in rows))
print(sorted(by_state.items()))
print([r["district"] for r in rows if r["state"] == "Odisha" and r["coastal"]][:20])
