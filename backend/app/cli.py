import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.core.config import get_settings
from app.db.models import Base
from app.db.session import create_engine_and_sessionmaker
from app.integrations.csv_schema import export_templates
from app.integrations.demo_adapter import DemoAdapter
from app.integrations.file_adapter import FileAdapter
from app.integrations.sap_sample_adapter import SapSampleAdapter
from app.services.ingest import load_dataset


def run_seed(
    seed: int,
    as_of_str: Optional[str],
    reset: bool,
    source: str = "demo",
    path: Optional[str] = None,
) -> int:
    settings = get_settings()
    as_of = None
    if as_of_str:
        try:
            as_of = datetime.strptime(as_of_str, "%Y-%m-%d").date()
        except ValueError:
            sys.stderr.write(f"Error: Invalid date format for --as-of: '{as_of_str}'. Expected YYYY-MM-DD.\n")
            return 1
    elif source == "file":
        sys.stderr.write("Error: --as-of YYYY-MM-DD is required when seeding from source 'file'.\n")
        return 1

    if source == "file":
        if not path:
            sys.stderr.write("Error: --path <folder> is required when seeding from source 'file'.\n")
            return 1
        adapter = FileAdapter(path=path, as_of=as_of)
        errors, warnings = adapter.validate()
        if errors:
            sys.stderr.write(f"Validation failed with {len(errors)} error(s):\n")
            for err in errors:
                sys.stderr.write(f"  * {err}\n")
            return 1

        rep = adapter.get_coverage_report()
        print(f"Loading user-supplied CSV dataset using {adapter.name} adapter from '{path}'...")
        print("\n=======================================================")
        print(" User-Supplied CSV File Import Coverage Report")
        print("=======================================================")
        print(f"Source: {rep['source']}")
        print(f"Dataset Label: {rep['label']}")
        print(f"Reference As-Of Date: {rep['as_of']}")
        print(f"Entities Covered: {', '.join(rep['entities_covered'])}")
        print(f"Entities Missing: {', '.join(rep['entities_missing'])}")
        if rep.get("row_counts"):
            print("\nRow Counts by Entity:")
            for ent, count in rep["row_counts"].items():
                print(f"  * {ent}: {count} rows")
        if rep.get("notes"):
            print("\nCoverage Notes:")
            for ent, note in rep["notes"].items():
                print(f"  * {ent}: {note}")
        if rep.get("warnings"):
            print("\nWarnings:")
            for w in rep["warnings"]:
                print(f"  * {w}")
        print("=======================================================\n")

        try:
            dataset = adapter.fetch_dataset()
        except Exception as e:
            sys.stderr.write(f"Error reading dataset files: {e}\n")
            return 1

    elif source == "sap-sample":
        adapter = SapSampleAdapter()
        rep = adapter.get_coverage_report()
        print(f"Loading SAP-style static sample fixture using {adapter.name} adapter...")
        print("\n=======================================================")
        print(" SAP-Style Sample Fixture Coverage Report")
        print("=======================================================")
        print(f"Entities Covered: {', '.join(rep['entities_covered'])}")
        print(f"Entities Missing: {', '.join(rep['entities_missing'])}")
        print("\nCoverage Notes:")
        for ent, note in rep.get("notes", {}).items():
            print(f"  * {ent}: {note}")
        print("\nDisclaimer:")
        print(f"  {rep['disclaimer']}")
        print("=======================================================\n")
        dataset = adapter.fetch_dataset()
    else:
        adapter = DemoAdapter(seed=seed, as_of=as_of)
        print(f"Generating synthetic dataset using {adapter.name} adapter (seed={seed}, as_of={adapter.as_of})...")
        dataset = adapter.fetch_dataset()

    engine, session_factory = create_engine_and_sessionmaker(settings.DATABASE_URL)
    Base.metadata.create_all(engine)

    with session_factory() as session:
        try:
            counts = load_dataset(session, dataset, reset=reset)
        except RuntimeError:
            sys.stderr.write(
                "Error: Database already contains data. Pass the --reset flag to overwrite existing data.\n"
            )
            return 2
        except Exception as e:
            sys.stderr.write(f"Unexpected Seed Failure: {e}\n")
            return 3

    print("\n=======================================================")
    print(f" SupplyChain Sentinel AI — Dataset Seeded ({dataset.meta.label})")
    print("=======================================================")
    print(f"Database: {settings.DATABASE_URL}")
    print(f"Source: {dataset.meta.source}")
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


def run_validate_files(path: str, as_of_str: str) -> int:
    """Validates CSV files in folder and prints coverage report WITHOUT touching any database."""
    try:
        as_of = datetime.strptime(as_of_str, "%Y-%m-%d").date()
    except ValueError:
        sys.stderr.write(f"Error: Invalid date format for --as-of: '{as_of_str}'. Expected YYYY-MM-DD.\n")
        return 1

    folder = Path(path)
    if not folder.exists() or not folder.is_dir():
        sys.stderr.write(f"Error: Path does not exist or is not a directory: '{path}'\n")
        return 1

    adapter = FileAdapter(path=folder, as_of=as_of)
    errors, warnings = adapter.validate()

    if errors:
        sys.stderr.write(f"Validation failed with {len(errors)} error(s):\n")
        for err in errors:
            sys.stderr.write(f"  * {err}\n")
        return 1

    rep = adapter.get_coverage_report()
    print("\n=======================================================")
    print(" User-Supplied CSV File Import Validation & Coverage")
    print("=======================================================")
    print(f"Source Path: {path}")
    print(f"Reference As-Of Date: {rep['as_of']}")
    print(f"Dataset Label: {rep['label']}")
    print(f"Entities Covered: {', '.join(rep['entities_covered'])}")
    print(f"Entities Missing: {', '.join(rep['entities_missing'])}")
    if rep.get("row_counts"):
        print("\nRow Counts by Entity:")
        for ent, count in rep["row_counts"].items():
            print(f"  * {ent}: {count} rows")
    if rep.get("notes"):
        print("\nCoverage Notes:")
        for ent, note in rep["notes"].items():
            print(f"  * {ent}: {note}")
    if rep.get("warnings"):
        print("\nWarnings:")
        for w in rep["warnings"]:
            print(f"  * {w}")
    print("\nValidation passed successfully. Files are ready for import.")
    print("=======================================================\n")
    return 0


def run_export_template(path: str) -> int:
    """Writes blank CSV templates and README.txt into folder, refusing to overwrite."""
    try:
        written = export_templates(path)
        print(f"\nCSV templates exported successfully to: {path}")
        print("Exported files:")
        for p in written:
            print(f"  * {p.name}")
        print("\nSee README.txt in the template directory for guidelines and field definitions.\n")
        return 0
    except FileExistsError as e:
        sys.stderr.write(f"Error: {e}\n")
        return 1
    except Exception as e:
        sys.stderr.write(f"Unexpected export failure: {e}\n")
        return 1


def main() -> None:
    parser = argparse.ArgumentParser(
        description="SupplyChain Sentinel AI CLI",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # 1. seed
    seed_parser = subparsers.add_parser(
        "seed", help="Seed the database with deterministic demo data, SAP-style sample, or user-supplied CSV files"
    )
    seed_parser.add_argument(
        "--source",
        type=str,
        choices=["demo", "sap-sample", "file"],
        default="demo",
        help="Data source adapter to seed from",
    )
    seed_parser.add_argument(
        "--seed", type=int, default=42, help="Seed integer for deterministic generation (demo adapter)"
    )
    seed_parser.add_argument(
        "--path", type=str, default=None, help="Folder path containing CSV files (required for source 'file')"
    )
    seed_parser.add_argument(
        "--as-of", type=str, default=None, help="Reference cutoff date in YYYY-MM-DD format (required for source 'file')"
    )
    seed_parser.add_argument("--reset", action="store_true", help="Reset and overwrite existing database tables")

    # 2. validate-files
    val_parser = subparsers.add_parser(
        "validate-files", help="Validate CSV files and print coverage report WITHOUT touching any database"
    )
    val_parser.add_argument(
        "--path", type=str, required=True, help="Folder path containing CSV files to validate"
    )
    val_parser.add_argument(
        "--as-of", type=str, required=True, help="Reference cutoff date in YYYY-MM-DD format"
    )

    # 3. export-template
    export_parser = subparsers.add_parser(
        "export-template", help="Export CSV template files and README.txt into a directory"
    )
    export_parser.add_argument(
        "--path", type=str, required=True, help="Destination directory for CSV template files"
    )

    args = parser.parse_args()

    if args.command == "seed":
        exit_code = run_seed(
            seed=args.seed,
            as_of_str=args.as_of,
            reset=args.reset,
            source=args.source,
            path=args.path,
        )
        sys.exit(exit_code)
    elif args.command == "validate-files":
        exit_code = run_validate_files(path=args.path, as_of_str=args.as_of)
        sys.exit(exit_code)
    elif args.command == "export-template":
        exit_code = run_export_template(path=args.path)
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
