"""Logging middleware — request_id, timestamp, latency tracking."""
import time
import uuid
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware


def generate_request_id() -> str:
    return f"req_{uuid.uuid4().hex[:12]}"


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = generate_request_id()
        start = time.time()
        request.state.request_id = request_id
        response = await call_next(request)
        elapsed = round((time.time() - start) * 1000, 1)
        response.headers["X-Request-ID"] = request_id
        print(f"[{request_id}] {request.method} {request.url.path} -> {response.status_code} ({elapsed}ms)")
        return response
