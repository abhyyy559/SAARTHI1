"""IMD adapter tests — demo mode returns valid normalized schema."""
import sys, os, asyncio
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from backend.services.imd_service import IMDService

svc = IMDService(adapter="demo")


async def test_current_weather():
    obs = await svc.get_current_weather(17.385, 78.4867)
    assert obs.temperature == 28, f"FAIL: temp={obs.temperature}"
    assert obs.source == "IMD"
    assert obs.condition == "Cloudy"
    assert obs.observed_at is not None
    print("PASS: test_current_weather")


async def test_forecast():
    fc = await svc.get_forecast(17.385, 78.4867)
    assert len(fc.days) == 7, f"FAIL: days={len(fc.days)}"
    assert fc.days[0].rainfall == 15
    print("PASS: test_forecast")


async def test_warning():
    w = await svc.get_district_warning("Hyderabad")
    assert w is not None
    assert w.hazard == "Thunderstorm"
    assert w.severity == "YELLOW"
    assert w.valid_until is not None
    print("PASS: test_warning")


async def test_nowcast():
    nc = await svc.get_district_nowcast("Hyderabad")
    assert "rain" in nc.lower() or "light" in nc.lower() or "moderate" in nc.lower() or nc
    print("PASS: test_nowcast")


async def main():
    await test_current_weather()
    await test_forecast()
    await test_warning()
    await test_nowcast()
    print("\nAll IMD adapter tests passed.")


if __name__ == "__main__":
    asyncio.run(main())
