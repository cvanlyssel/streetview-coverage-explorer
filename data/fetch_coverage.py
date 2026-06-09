"""Street View coverage pipeline (skeleton).

Will: pull a region's road network with osmnx, sample points along roads,
query the Google Street View metadata endpoint for each, and emit GeoJSON.
See docs/CLAUDE_CODE_KICKOFF.md Step 5.
"""

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Street View coverage metadata for a region.")
    parser.add_argument("--region", required=True, help="Region id, e.g. madison")
    args = parser.parse_args()
    raise SystemExit(f"Pipeline not implemented yet (region={args.region}). See Step 5 of the kickoff doc.")


if __name__ == "__main__":
    main()
