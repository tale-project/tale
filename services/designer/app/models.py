"""Request/response models for Tale Designer service."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    version: str
    initialized: bool


class ErrorResponse(BaseModel):
    error: str
    message: str
    details: dict | None = None
