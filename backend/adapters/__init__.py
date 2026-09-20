"""Live source adapters — each reports LIVE/CACHED/DEMO/UNCONFIGURED/OFFLINE to the registry.

Honesty rule: adapters raise Unavailable errors on failure. Only demo mode may
use fixtures, and only labelled DEMO. Nothing is ever presented as live when not.
"""
from .registry import report, snapshot, get_status  # noqa: F401
