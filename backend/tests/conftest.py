import os
# Ensure test suite runs in complete isolation from any local backend/.env
os.environ["ENV_FILE"] = ""

import pytest
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from starlette.testclient import TestClient

from app.core.config import Settings
from app.db.models import Base
from app.db.session import get_db, set_sqlite_pragma
from app.integrations.demo_adapter import DemoAdapter
from app.main import create_app
from app.services.ingest import load_dataset


@pytest.fixture
def temp_db_url(tmp_path):
    """Provides a fresh isolated SQLite file database path for tests."""
    db_file = tmp_path / "test_sentinel.db"
    return f"sqlite:///{db_file.as_posix()}"


@pytest.fixture
def temp_engine(temp_db_url):
    engine = create_engine(temp_db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def temp_session(temp_engine):
    session_factory = sessionmaker(bind=temp_engine, autocommit=False, autoflush=False)
    with session_factory() as session:
        yield session


@pytest.fixture
def seeded_db(temp_engine):
    session_factory = sessionmaker(bind=temp_engine, autocommit=False, autoflush=False)
    adapter = DemoAdapter(seed=42, as_of=date(2026, 3, 1))
    dataset = adapter.fetch_dataset()
    with session_factory() as session:
        load_dataset(session, dataset, reset=True)
    return temp_engine


@pytest.fixture
def app_with_seeded_db(seeded_db, temp_db_url):
    test_settings = Settings(
        APP_NAME="SupplyChain Sentinel AI Test",
        APP_ENV="testing",
        DATABASE_URL=temp_db_url,
        DATA_SOURCE="demo",
    )
    app = create_app(settings=test_settings)

    # Override get_db to connect to seeded_db
    session_factory = sessionmaker(bind=seeded_db, autocommit=False, autoflush=False)

    def override_get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    return app


@pytest.fixture
def client_seeded(app_with_seeded_db):
    with TestClient(app_with_seeded_db) as client:
        yield client


@pytest.fixture
def client_empty(temp_engine, temp_db_url):
    test_settings = Settings(
        APP_NAME="SupplyChain Sentinel AI Test",
        APP_ENV="testing",
        DATABASE_URL=temp_db_url,
        DATA_SOURCE="demo",
    )
    app = create_app(settings=test_settings)
    session_factory = sessionmaker(bind=temp_engine, autocommit=False, autoflush=False)

    def override_get_db():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client
