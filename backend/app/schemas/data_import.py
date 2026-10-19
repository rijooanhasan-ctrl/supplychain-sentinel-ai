from typing import Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ImportLimits(BaseModel):
    max_file_bytes: int
    max_files: int
    max_total_bytes: int


class AcceptedFile(BaseModel):
    name: str
    required: bool


class ImportStatusResponse(BaseModel):
    enabled: bool
    active: str  # "demo" | "uploaded"
    uploaded_available: bool
    limits: ImportLimits
    accepted_files: List[AcceptedFile]


class ValidateImportRequest(BaseModel):
    as_of: str
    files: Dict[str, str]


class LoadImportRequest(BaseModel):
    as_of: str
    files: Dict[str, str]
    replace_uploaded: bool = True


class ActivateImportRequest(BaseModel):
    dataset: str  # "demo" | "uploaded"


class ValidationErrorItem(BaseModel):
    file: str
    line: Optional[int] = None
    message: str


class ImportCoverage(BaseModel):
    entities_covered: List[str] = Field(default_factory=list)
    missing: List[str] = Field(default_factory=list)
    consequences: Dict[str, str] = Field(default_factory=dict)
    entities_missing: List[str] = Field(default_factory=list)


class ValidateImportResponse(BaseModel):
    valid: bool
    errors: List[ValidationErrorItem] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    coverage: ImportCoverage
    row_counts: Dict[str, int] = Field(default_factory=dict)
    as_of: str
    label: str


class LoadImportResponse(ValidateImportResponse):
    active: str = "uploaded"
