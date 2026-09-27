"""Climate math tests — aggregation/trends are pure; numbers must derive from input."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from backend.services.climate_service import analyze_series  # noqa: E402


def _synthetic(years=range(2010, 2020)):
    times, tm, rn = [], [], []
    for y in years:
        for m in range(1, 13):
            times.append(f"{y}-{m:02d}-15")
            tm.append(25.0 + 0.1 * (y - 2010))  # +0.1 C/yr exact
            rn.append(100.0)
    return times, tm, rn


def test_trend_recovers_slope():
    out = analyze_series(*_synthetic())
    assert abs(out["temp_trend_c_per_year"] - 0.1) < 0.02, out["temp_trend_c_per_year"]
    assert out["latest_temp_c"] is not None and out["baseline_temp_c"] is not None
    assert len(out["yearly"]) == 10
    print("PASS: test_trend_recovers_slope")


def test_no_invented_stats_on_gaps():
    out = analyze_series([], [], [])
    assert out["yearly"] == [] and out["latest_temp_c"] is None
    print("PASS: test_no_invented_stats_on_gaps")


if __name__ == "__main__":
    test_trend_recovers_slope()
    test_no_invented_stats_on_gaps()
    print("\nAll climate tests passed.")
