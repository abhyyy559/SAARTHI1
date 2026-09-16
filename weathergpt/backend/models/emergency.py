"""Emergency, community-report and impact models (§38). Provenance preserved on all relations."""
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field

from .weather import Location

EMERGENCY_TYPES = [
    "NEED_HELP", "IM_HERE", "MEDICAL_HELP", "NEED_WATER", "NEED_FOOD",
    "DANGER_HERE", "PEOPLE_TRAPPED", "ROAD_BLOCKED", "IM_SAFE",
]


class EmergencyMessage(BaseModel):
    message_id: str
    sender_id: str
    timestamp: datetime
    message_type: str = "NEED_HELP"
    location: Optional[Location] = None
    people_count: int = 1
    medical_required: bool = False
    text: str = ""
    # E2E envelope: ciphertext + nonce/iv metadata; relays forward without reading.
    ciphertext: str = ""
    nonce: str = ""
    signature: str = ""
    hops: int = 0
    provenance: str = "P2P-LOCAL"


class QueuedPacket(BaseModel):
    packet_id: str
    received_at: datetime
    forwarded: bool = False
    payload: dict[str, Any] = Field(default_factory=dict)


class CommunityReport(BaseModel):
    report_id: str
    report_type: str  # road_blocked|flooding|fallen_tree|damage|waterlogging
    latitude: float
    longitude: float
    district: str = ""
    text: str = ""
    reporter_id: str = "anonymous"
    created_at: datetime
    status: str = "COMMUNITY"  # NEVER 'official'
    provenance: str = "USER-REPORT"


class ImpactAssessment(BaseModel):
    hazard: str = ""
    severity: str = "GREEN"
    affected: bool = False
    method: str = "none"  # polygon|circle|district|route|none
    risk_level: str = "LOW"
    reason: str = ""
    advisory: str = ""
    provenance: str = "DEMO"


class EvidenceItem(BaseModel):
    source: str
    type: str = ""
    timestamp: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    location: str = ""
    provenance: str = "DEMO"
    processing_steps: list[str] = Field(default_factory=list)
