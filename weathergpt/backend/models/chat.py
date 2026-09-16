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
    warning: dict[str, Any] = Field(default_factory=dict)
    advisory: str = ""
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    language: str = "en"
    structured_fallback: bool = False
    generated_at: str = ""
