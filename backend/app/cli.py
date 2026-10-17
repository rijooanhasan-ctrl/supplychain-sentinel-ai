import argparse
import sys
from datetime import datetime
from typing import Optional

from app.core.config import get_settings
from app.db.models import Base
from app.db.session import create_engine_and_sessionmaker
from app.integrations.demo_adapter import DemoAdapter
from app.services.ingest import load_dataset


def run_seed(seed: int, as_of_str: Optional[str], reset: bool) -> int:
    settings = get_settings()
    as_of = None
    if as_of_str:
        try:
            as_of = datetime.strptime(as_of_str, "%Y-%m-%d").date()
        except ValueError:
            sys.stderr.write(f"Error: Invalid date format for --as-of: '{as_of_str}'. Expected YYYY-MM-DD.\n")
            return 1

    engine, session_factory = create_engine_and_sessionmaker(settings.DATABASE_URL)
    Base.metadata.create_all(engine)

    adapter = DemoAdapter(seed=seed, as_of=as_of)
    print(f"Generating synthetic dataset using {adapter.name} adapter (seed={seed}, as_of={adapter.as_of})...")
    dataset = adapter.fetch_dataset()

    with session_factory() as session:
        try:
            counts = load_dataset(session, dataset, reset=reset)
        except RuntimeError as e:
            sys.stderr.write(f"Seed Error: {e}\n")
            return 2
        except Exception as e:
            sys.stderr.write(f"Unexpected Seed Failure: {e}\n")
            return 3

    print("\n=======================================================")
    print(" SupplyChain Sentinel AI — Demo Dataset Seeded")
    print("=======================================================")
    print(f"Database: {settings.DATABASE_URL}")
    print(f"Dataset Label: {dataset.meta.label}")
    print(f"Reference As-Of Date: {dataset.meta.as_of}")
    print("-------------------------------------------------------")
    print(f"{'Table / Entity':<28} | {'Rows Loaded':>10}")
    print("-------------------------------------------------------")
    for entity, count in counts.items():
        print(f"{entity:<28} | {count:>10}")
    print("-------------------------------------------------------")
    print(f"{'Total Entities Loaded':<28} | {sum(counts.values()):>10}")
    print("=======================================================\n")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="SupplyChain Sentinel AI CLI",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    seed_parser = subparsers.add_parser("seed", help="Seed the database with deterministic demo data")
    seed_parser.add_argument("--seed", type=int, default=42, help="Seed integer for deterministic generation")
    seed_parser.add_argument("--as-of", type=str, default=None, help="Reference cutoff date in YYYY-MM-DD format")
    seed_parser.add_argument("--reset", action="store_true", help="Reset and overwrite existing database tables")

    args = parser.parse_args()

    if args.command == "seed":
        exit_code = run_seed(seed=args.seed, as_of_str=args.as_of, reset=args.reset)
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
