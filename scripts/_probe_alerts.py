import asyncio, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backend.services import alert_service, district_service
from backend.adapters import cap_adapter
from backend.services.gis_service import alert_text

async def main():
    raw, prov = await cap_adapter.fetch_alerts()
    print(f"feed provenance={prov}  alerts={len(raw)}")
    geom = sum(1 for a in raw if a.get("polygon") or a.get("circle"))
    print(f"alerts carrying geometry: {geom}/{len(raw)}")
    for d in ("Hyderabad", "Kamareddy", "Karimnagar", "Visakhapatnam"):
        got = await alert_service.gather_alerts(lat=17.385, lon=78.4867, district=d, state=district_service.state_of(d))
        rel = got["relevant"]
        print(f"\n=== {d} === relevant={len(rel)} nearby={len(got['nearby'])} prov={got['provenance']}")
        for a in rel:
            print(f"   [{a.get('severity')}] {str(a.get('headline'))[:90]}")
            print(f"      method={a['relevance']['method']} named={a.get('named_districts')}")

asyncio.run(main())
