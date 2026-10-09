"""VPS-deploy consistency guards (no server needed — static file checks + registry).

Regression cover for the push-button VPS deploy (43.225.25.133):
1. Port contract: Dockerfile default == compose container port == run.py
   default == 8000 (Caddy reverse-proxies 127.0.0.1:8000, owns 80/443).
   A bare `docker run -p 8000:8000` 502'd when the Dockerfile default was 8003.
2. Healthcheck paths: compose + Dockerfile probe /api/health on $PORT.
3. CAP honesty: the registry's fresh-boot cap state must mirror
   cap_adapter.fetch_alerts() resolution (CAP_FEED_URLS wins, singular
   CAP_FEED_URL is the fallback). .env.example ships the plural feeds with
   the singular empty, so checking only the singular reported a configured
   box UNCONFIGURED.
4. .env.example documents every env var backend/config.py reads (plus
   EMERGENCY_KEY, read via os.environ in emergency_service, and the
   compose-consumed PORT/WGPT_PORT). Placeholders only, never secrets.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

REPO = os.path.join(os.path.dirname(__file__), "..")


def _read(name):
    with open(os.path.join(REPO, name), encoding="utf-8") as fh:
        return fh.read()


def test_dockerfile_default_port_is_8000():
    src = _read("Dockerfile")
    assert "PORT=8000" in src, "Dockerfile ENV default must be PORT=8000"
    assert "EXPOSE 8000" in src, "Dockerfile must EXPOSE 8000"
    assert "${PORT:-8000}" in src, "Dockerfile CMD must fall back to 8000"
    assert "8003" not in src, "stale 8003 default must not survive anywhere"


def test_compose_container_port_and_healthcheck_agree_with_dockerfile():
    src = _read("docker-compose.yml")
    # Container port is hardcoded 8000; only the HOST side is selectable.
    assert '"${WGPT_PORT:-8000}:8000"' in src
    assert "/api/health" in src, "compose healthcheck must probe /api/health"
    assert "'8003'" not in src and '"8003"' not in src


def test_run_py_default_port_is_8000():
    src = _read("run.py")
    assert 'os.environ.get("PORT", "8000")' in src


def test_cap_initial_state_mirrors_adapter_resolution():
    from backend import config
    from backend.adapters import registry

    def fresh_cap_snapshot():
        registry._STATUSES["cap"] = registry.SourceStatus(name="cap")
        return {s["name"]: s for s in registry.snapshot()}["cap"]

    orig_url, orig_urls = config.CAP_FEED_URL, list(config.CAP_FEED_URLS)
    try:
        # The shipped shape: plural feeds set (as in .env.example), singular empty.
        config.CAP_FEED_URL = ""
        config.CAP_FEED_URLS = ["https://example.invalid/cap.xml"]
        snap = fresh_cap_snapshot()
        assert snap["status"] == "READY", snap

        # Nothing configured at all stays honestly UNCONFIGURED.
        config.CAP_FEED_URL = ""
        config.CAP_FEED_URLS = []
        snap = fresh_cap_snapshot()
        assert snap["status"] == "UNCONFIGURED", snap
        assert "CAP_FEED_URL" in snap["detail"], snap
    finally:
        config.CAP_FEED_URL = orig_url
        config.CAP_FEED_URLS = orig_urls
        registry._STATUSES["cap"] = registry.SourceStatus(name="cap")


def test_env_example_documents_every_config_var():
    config_src = _read(os.path.join("backend", "config.py"))
    read_vars = set(re.findall(r'_get\("([A-Z0-9_]+)"', config_src))
    assert read_vars, "config.py must read env via _get(\"VAR\")"
    example_src = _read(".env.example")
    documented = set(re.findall(r"^([A-Z0-9_]+)=", example_src, re.M))
    # Read outside config.py: emergency_service (os.environ) + compose ports.
    extra = {"EMERGENCY_KEY", "PORT", "WGPT_PORT"}
    missing = sorted((read_vars | extra) - documented)
    assert not missing, f".env.example is missing placeholder lines for: {missing}"
