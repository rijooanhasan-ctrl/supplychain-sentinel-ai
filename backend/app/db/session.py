import sqlite3
from typing import Generator
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable SQLite foreign key enforcement on all connections."""
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def create_engine_and_sessionmaker(database_url: str):
    """Create a SQLAlchemy engine and session factory for the given URL."""
    connect_args = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    engine = create_engine(database_url, connect_args=connect_args)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return engine, session_factory


# Lazy singletons for the default configured database
_engine = None
_session_factory = None


def get_engine() -> Engine:
    global _engine, _session_factory
    if _engine is None:
        settings = get_settings()
        _engine, _session_factory = create_engine_and_sessionmaker(settings.DATABASE_URL)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _engine, _session_factory
    if _session_factory is None:
        get_engine()
    return _session_factory


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency for obtaining a database session."""
    session_cls = get_session_factory()
    db = session_cls()
    try:
        yield db
    finally:
        db.close()
