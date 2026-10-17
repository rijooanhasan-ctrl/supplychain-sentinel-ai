from datetime import date
import pytest
from sqlalchemy import func, select

from app.db.models import DatasetMeta, Product, Warehouse
from app.integrations.demo_adapter import DemoAdapter
from app.services.ingest import load_dataset


def test_loader_all_or_nothing_on_bad_reference(temp_session):
    adapter = DemoAdapter(seed=42, as_of=date(2026, 3, 1))
    dataset = adapter.fetch_dataset()

    # Introduce an invalid reference in BOM lines
    dataset.bom_lines[0].component_sku = "NON-EXISTENT-SKU"

    with pytest.raises(ValueError, match="Unknown component SKU"):
        load_dataset(temp_session, dataset, reset=False)

    # Confirm nothing was committed
    prod_count = temp_session.scalar(select(func.count(Product.id)))
    meta_count = temp_session.scalar(select(func.count(DatasetMeta.id)))
    assert prod_count == 0
    assert meta_count == 0


def test_loader_refuses_to_overwrite_without_reset(temp_session):
    adapter = DemoAdapter(seed=42, as_of=date(2026, 3, 1))
    dataset = adapter.fetch_dataset()

    # First load succeeds
    counts1 = load_dataset(temp_session, dataset, reset=False)
    assert counts1["dataset_meta"] == 1

    # Second load without reset must raise RuntimeError
    with pytest.raises(RuntimeError, match="Database already contains data"):
        load_dataset(temp_session, dataset, reset=False)


def test_loader_reset_replaces_dataset_and_writes_meta(temp_session):
    adapter1 = DemoAdapter(seed=42, as_of=date(2026, 3, 1))
    dataset1 = adapter1.fetch_dataset()
    load_dataset(temp_session, dataset1, reset=False)

    meta1 = temp_session.scalar(select(DatasetMeta).limit(1))
    assert meta1.seed == 42
    assert meta1.as_of == date(2026, 3, 1)
    assert meta1.label == "DEMO DATA"

    # Reset with seed 99 and new date
    adapter2 = DemoAdapter(seed=99, as_of=date(2026, 4, 15))
    dataset2 = adapter2.fetch_dataset()
    counts2 = load_dataset(temp_session, dataset2, reset=True)
    assert counts2["dataset_meta"] == 1

    meta2 = temp_session.scalar(select(DatasetMeta).limit(1))
    assert meta2.seed == 99
    assert meta2.as_of == date(2026, 4, 15)

    # Confirm warehouses count matches fresh dataset
    wh_count = temp_session.scalar(select(func.count(Warehouse.id)))
    assert wh_count == len(dataset2.warehouses)
