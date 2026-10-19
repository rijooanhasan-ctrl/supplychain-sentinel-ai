"""app/api/routes/data_import.py

Safe, separate web CSV data import endpoints.
Writes strictly to UPLOAD_DB_PATH (e.g. backend/data/uploaded.db), never sentinel.db.
"""

from __future__ import annotations

from datetime import date
import io
import logging
import os
from pathlib import Path
import re
import tempfile
from typing import Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from app.core.config import Settings, get_settings
from app.db.models import Base, DatasetMeta, Warehouse
from app.db.session import create_engine_and_sessionmaker
from app.integrations.csv_schema import (
    ALL_CSV_FILES,
    CSV_COLUMNS,
    REQUIRED_FILES,
    TEMPLATE_SAMPLES,
)
from app.integrations.file_adapter import FileAdapter
from app.schemas.data_import import (
    AcceptedFile,
    ActivateImportRequest,
    ImportCoverage,
    ImportLimits,
    ImportStatusResponse,
    LoadImportRequest,
    LoadImportResponse,
    ValidateImportRequest,
    ValidateImportResponse,
    ValidationErrorItem,
)
from app.services import ingest

logger = logging.getLogger("app.data_import")

router = APIRouter(prefix="/import", tags=["Data Import"])


def resolve_upload_db_path(settings: Settings) -> Path:
    """Resolve upload DB path safely whether running from repo root or backend dir."""
    p = Path(settings.UPLOAD_DB_PATH)
    if p.is_absolute():
        return p.resolve()
    cwd = Path.cwd().resolve()
    if cwd.name.lower() == "backend" and (
        settings.UPLOAD_DB_PATH.startswith("backend/")
        or settings.UPLOAD_DB_PATH.startswith("backend\\")
    ):
        return (cwd.parent / p).resolve()
    return (cwd / p).resolve()


def resolve_sentinel_db_path(settings: Settings) -> Path:
    """Resolve configured default database path (sentinel.db)."""
    raw = settings.DATABASE_URL
    if raw.startswith("sqlite:///"):
        raw = raw.replace("sqlite:///", "")
    p = Path(raw)
    if p.is_absolute():
        return p.resolve()
    return (Path.cwd().resolve() / p).resolve()


def is_uploaded_available(upload_path: Path) -> bool:
    """Check if uploaded.db exists and contains loaded data."""
    if not upload_path.exists() or upload_path.stat().st_size == 0:
        return False
    try:
        engine, sf = create_engine_and_sessionmaker(f"sqlite:///{upload_path.as_posix()}")
        with sf() as sess:
            meta = sess.scalar(select(DatasetMeta).limit(1))
            wh = sess.scalar(select(Warehouse).limit(1))
            available = meta is not None or wh is not None
        engine.dispose()
        return available
    except Exception:
        return False


def parse_validation_error(err_str: str) -> ValidationErrorItem:
    """Parse raw error string into structured ValidationErrorItem with max 200 char message."""
    clean_err = err_str.strip()[:200]
    pattern = r"^([a-zA-Z0-9_\-\.]+): line (\d+): (.*)$"
    match = re.match(pattern, clean_err)
    if match:
        file_part, line_part, msg_part = match.groups()
        return ValidationErrorItem(file=file_part, line=int(line_part), message=msg_part[:200])

    if clean_err.startswith("Missing required file:"):
        fname = clean_err.split(":", 1)[1].strip()
        return ValidationErrorItem(file=fname, line=None, message=clean_err)

    pattern_file_only = r"^([a-zA-Z0-9_\-\.]+\.csv): (.*)$"
    match2 = re.match(pattern_file_only, clean_err)
    if match2:
        file_part, msg_part = match2.groups()
        return ValidationErrorItem(file=file_part, line=None, message=msg_part[:200])

    return ValidationErrorItem(file="general", line=None, message=clean_err)


def validate_import_payload_constraints(
    as_of_str: str,
    files: Dict[str, str],
    settings: Settings,
    content_length: Optional[int] = None,
) -> date:
    """Validate request size, file counts, filenames, extensions, and date format."""
    # Enforce total size limit
    if content_length is not None and content_length > settings.IMPORT_MAX_TOTAL_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Total upload size exceeds limit of {settings.IMPORT_MAX_TOTAL_BYTES} bytes",
        )

    if len(files) > settings.IMPORT_MAX_FILES:
        raise HTTPException(
            status_code=422,
            detail=f"Too many files: got {len(files)}, maximum allowed is {settings.IMPORT_MAX_FILES}",
        )

    # Validate as_of date
    if not as_of_str or not as_of_str.strip():
        raise HTTPException(status_code=422, detail="Missing required as_of date")
    try:
        as_of_date = date.fromisoformat(as_of_str.strip())
    except Exception:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid as_of date format '{as_of_str}', expected YYYY-MM-DD",
        )

    total_bytes = 0
    for filename, content in files.items():
        # Check path traversal or path separators
        if "/" in filename or "\\" in filename or ".." in filename:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid filename '{filename}': path traversal or separators are forbidden",
            )

        if not filename.endswith(".csv"):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid file extension for '{filename}': only .csv files are accepted",
            )

        if filename not in ALL_CSV_FILES:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown file '{filename}': not in accepted CSV files allowlist",
            )

        # Check binary or null byte content
        if "\x00" in content:
            raise HTTPException(
                status_code=422,
                detail=f"File '{filename}' contains invalid or binary characters",
            )

        # Encode to check UTF-8 and size
        try:
            content_bytes = content.encode("utf-8")
        except Exception:
            raise HTTPException(
                status_code=422,
                detail=f"File '{filename}' contains invalid UTF-8 content",
            )

        file_bytes = len(content_bytes)
        if file_bytes > settings.IMPORT_MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File '{filename}' exceeds maximum size of {settings.IMPORT_MAX_FILE_BYTES} bytes",
            )

        total_bytes += file_bytes

    if total_bytes > settings.IMPORT_MAX_TOTAL_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Total file size ({total_bytes} bytes) exceeds limit of {settings.IMPORT_MAX_TOTAL_BYTES} bytes",
        )

    return as_of_date


def require_web_import_enabled(settings: Settings = Depends(get_settings)) -> None:
    """Dependency that halts request before parsing if web import is disabled."""
    if not settings.ENABLE_WEB_IMPORT:
        raise HTTPException(status_code=403, detail="Web import is disabled")


@router.get("/status", response_model=ImportStatusResponse)
def get_import_status(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ImportStatusResponse:
    """Return status of web CSV import, current active dataset, limits, and accepted files."""
    upload_path = resolve_upload_db_path(settings)
    active = getattr(getattr(request, "app", None), "state", None) and getattr(request.app.state, "active_dataset", "demo") or "demo"
    available = is_uploaded_available(upload_path)

    limits = ImportLimits(
        max_file_bytes=settings.IMPORT_MAX_FILE_BYTES,
        max_files=settings.IMPORT_MAX_FILES,
        max_total_bytes=settings.IMPORT_MAX_TOTAL_BYTES,
    )
    accepted = [
        AcceptedFile(name=fname, required=fname in REQUIRED_FILES)
        for fname in ALL_CSV_FILES
    ]

    return ImportStatusResponse(
        enabled=settings.ENABLE_WEB_IMPORT,
        active=active,
        uploaded_available=available,
        limits=limits,
        accepted_files=accepted,
    )


@router.get("/template", dependencies=[Depends(require_web_import_enabled)])
def get_import_templates(
    settings: Settings = Depends(get_settings),
) -> Dict[str, str]:
    """Return template CSV files with headers and fictional example rows."""
    templates: Dict[str, str] = {}
    import csv

    for fname in ALL_CSV_FILES:
        cols = CSV_COLUMNS[fname]
        samples = TEMPLATE_SAMPLES.get(fname, [])
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
        writer.writeheader()
        for row in samples:
            writer.writerow(row)
        templates[fname] = buf.getvalue()

    return templates


@router.post("/validate", response_model=ValidateImportResponse, dependencies=[Depends(require_web_import_enabled)])
def validate_import(
    req: ValidateImportRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ValidateImportResponse:
    """Validate user-supplied CSV files without touching any database."""

    content_length_header = request.headers.get("content-length")
    content_length = int(content_length_header) if content_length_header and content_length_header.isdigit() else None

    as_of_date = validate_import_payload_constraints(
        req.as_of, req.files, settings, content_length=content_length
    )

    # Logging records filenames and sizes only, never content
    file_sizes = {fname: len(c.encode("utf-8")) for fname, c in req.files.items()}
    logger.info("Validate import requested: %d files, total_bytes=%d", len(req.files), sum(file_sizes.values()))

    # Write files into a fresh temp directory
    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        for filename, content in req.files.items():
            file_path = temp_dir / filename
            file_path.write_text(content, encoding="utf-8")

        adapter = FileAdapter(temp_dir, as_of=as_of_date)
        raw_errors, raw_warnings = adapter.validate()

        parsed_errors = [parse_validation_error(e) for e in raw_errors[:50]]
        cov = adapter.get_coverage_report()
        coverage_obj = ImportCoverage(
            entities_covered=cov.get("entities_covered", []),
            missing=cov.get("entities_missing", []),
            consequences=cov.get("notes", {}),
            entities_missing=cov.get("entities_missing", []),
        )

        return ValidateImportResponse(
            valid=len(raw_errors) == 0,
            errors=parsed_errors,
            warnings=raw_warnings,
            coverage=coverage_obj,
            row_counts=cov.get("row_counts", {}),
            as_of=str(as_of_date),
            label=adapter.label,
        )


@router.post("/load", response_model=LoadImportResponse, dependencies=[Depends(require_web_import_enabled)])
def load_import(
    req: LoadImportRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> LoadImportResponse:
    """Re-validate server-side and atomically load valid dataset into UPLOAD_DB_PATH."""

    content_length_header = request.headers.get("content-length")
    content_length = int(content_length_header) if content_length_header and content_length_header.isdigit() else None

    as_of_date = validate_import_payload_constraints(
        req.as_of, req.files, settings, content_length=content_length
    )

    upload_path = resolve_upload_db_path(settings)
    sentinel_path = resolve_sentinel_db_path(settings)
    if upload_path == sentinel_path:
        raise HTTPException(
            status_code=409,
            detail="Upload database path resolves to sentinel.db; cannot overwrite demo database",
        )

    file_sizes = {fname: len(c.encode("utf-8")) for fname, c in req.files.items()}
    logger.info("Load import requested: %d files, total_bytes=%d", len(req.files), sum(file_sizes.values()))

    # Re-validate in a fresh temp directory
    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        for filename, content in req.files.items():
            file_path = temp_dir / filename
            file_path.write_text(content, encoding="utf-8")

        adapter = FileAdapter(temp_dir, as_of=as_of_date)
        raw_errors, raw_warnings = adapter.validate()

        parsed_errors = [parse_validation_error(e) for e in raw_errors[:50]]
        cov = adapter.get_coverage_report()
        coverage_obj = ImportCoverage(
            entities_covered=cov.get("entities_covered", []),
            missing=cov.get("entities_missing", []),
            consequences=cov.get("notes", {}),
            entities_missing=cov.get("entities_missing", []),
        )

        if raw_errors:
            # Re-validation failed, do not touch database
            return LoadImportResponse(
                valid=False,
                errors=parsed_errors,
                warnings=raw_warnings,
                coverage=coverage_obj,
                row_counts=cov.get("row_counts", {}),
                as_of=str(as_of_date),
                label=adapter.label,
                active="uploaded" if getattr(request.app.state, "active_dataset", "demo") == "uploaded" else "demo",
            )

        source_dataset = adapter.fetch_dataset()

        # Build into a temp SQLite database file first, then atomically replace
        upload_path.parent.mkdir(parents=True, exist_ok=True)
        temp_db_path = upload_path.with_suffix(f".tmp_{uuid.uuid4().hex}.db")

        try:
            temp_engine, temp_sessionmaker = create_engine_and_sessionmaker(
                f"sqlite:///{temp_db_path.as_posix()}"
            )
            Base.metadata.create_all(temp_engine)
            with temp_sessionmaker() as sess:
                ingest.load_dataset(sess, source_dataset, reset=True)
            temp_engine.dispose()

            # Dispose old uploaded engine if any
            if getattr(request.app.state, "uploaded_engine", None) is not None:
                request.app.state.uploaded_engine.dispose()
                request.app.state.uploaded_engine = None
                request.app.state.uploaded_session_factory = None

            # Atomically replace into upload_path
            if upload_path.exists():
                try:
                    upload_path.unlink()
                except Exception:
                    pass
            os.replace(temp_db_path, upload_path)

            # Create new engine & session factory for upload_path
            new_engine, new_sf = create_engine_and_sessionmaker(
                f"sqlite:///{upload_path.as_posix()}"
            )
            request.app.state.uploaded_engine = new_engine
            request.app.state.uploaded_session_factory = new_sf
            request.app.state.active_dataset = "uploaded"

            logger.info("Successfully loaded uploaded dataset into %s and switched active to 'uploaded'", upload_path)

            return LoadImportResponse(
                valid=True,
                errors=[],
                warnings=raw_warnings,
                coverage=coverage_obj,
                row_counts=cov.get("row_counts", {}),
                as_of=str(as_of_date),
                label=adapter.label,
                active="uploaded",
            )
        finally:
            if temp_db_path.exists():
                try:
                    temp_db_path.unlink()
                except Exception:
                    pass


@router.post("/activate", response_model=ImportStatusResponse, dependencies=[Depends(require_web_import_enabled)])
def activate_dataset(
    req: ActivateImportRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ImportStatusResponse:
    """Activate either 'demo' or 'uploaded' dataset."""

    target = req.dataset.strip().lower()
    if target not in ("demo", "uploaded"):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid dataset choice '{req.dataset}'. Must be 'demo' or 'uploaded'",
        )

    upload_path = resolve_upload_db_path(settings)

    if target == "uploaded":
        if not is_uploaded_available(upload_path):
            raise HTTPException(
                status_code=409,
                detail="Uploaded dataset has no data; please import files first",
            )
        if getattr(request.app.state, "uploaded_session_factory", None) is None:
            new_engine, new_sf = create_engine_and_sessionmaker(
                f"sqlite:///{upload_path.as_posix()}"
            )
            request.app.state.uploaded_engine = new_engine
            request.app.state.uploaded_session_factory = new_sf
        request.app.state.active_dataset = "uploaded"
    else:
        request.app.state.active_dataset = "demo"

    return get_import_status(request=request, settings=settings)
