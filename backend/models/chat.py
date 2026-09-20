"""Chat API contract (§32)."""
from typing import Any, Optional
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str
    latitude: float = 17.385
    longitude: float = 78.4867
    language: str = "en"
    user_type: str = "general"


class ChatResponse(BaseModel):
    answer: str
    location: dict[str, Any] = Field(default_factory=dict)
    weather: dict[str, Any] = Field(default_factory=dict)
    risk: dict[str, Any] = Field(default_factory=dict)
    # The single server-side severity verdict (see services/verdict_service.py).
    # The frontend renders THIS; no component may re-derive severity.
    verdict: dict[str, Any] = Field(default_factory=dict)
    warning: dict[str, Any] = Field(default_factory=dict)
    advisory: str = ""
    caveat: str = ""
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    language: str = "en"
    structured_fallback: bool = False
    # Set when the configured LLM model is invalid: the chat answer below is the
    # honest template fallback and this names the misconfiguration (never a 500).
    model_error: str = ""
    generated_at: str = ""
    response_time_ms: int = 0
