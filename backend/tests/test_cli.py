import pytest

from app.cli import run_seed
from app.core.config import get_settings


def test_cli_seed_lifecycle(temp_db_url, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", temp_db_url)
    get_settings.cache_clear()

    # 1. Invalid date format fails cleanly with code 1
    code_bad_date = run_seed(seed=42, as_of_str="invalid-date", reset=False)
    assert code_bad_date == 1

    # 2. First seed on empty DB succeeds with code 0
    code_first = run_seed(seed=42, as_of_str="2026-03-01", reset=False)
    assert code_first == 0

    # 3. Second seed without --reset refuses and returns non-zero (code 2)
    code_refused = run_seed(seed=42, as_of_str="2026-03-01", reset=False)
    assert code_refused == 2

    # 4. Seed with --reset succeeds with code 0
    code_reset = run_seed(seed=99, as_of_str="2026-03-02", reset=True)
    assert code_reset == 0

    get_settings.cache_clear()
