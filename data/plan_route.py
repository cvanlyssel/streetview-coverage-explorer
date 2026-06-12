"""Plan a gap-filling route for a region's coverage gaps (docs/ROUTE_PLANNER.md).

Usage:
    python plan_route.py --region madison --mode drive
    python plan_route.py --region madison --mode bike

Reads gaps from coverage_samples, clusters them into <= MAX_STOPS visits,
orders the visits with nearest-neighbor + 2-opt over network shortest-path
distances on the cached osmnx drive graph, and upserts the plan (GeoJSON +
GPX) into the route_plans table for the API to serve.

LOCAL feature: unlike load_postgis.py this prefers backend/.env (the local
dev database) over data/.env, which currently points at production.
Set DATABASE_URL explicitly to override.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

import psycopg2
from dotenv import dotenv_values

from regions import REGIONS, RegionConfig

DATA_DIR = Path(__file__).resolve().parent

MAX_STOPS = 250
CLUSTER_RADIUS_M = 150.0
CAPTURE_MINUTES_PER_STOP = 2.0
SPEED_KMH = {"drive": 30.0, "bike": 15.0}  # urban average incl. slowdowns
TWO_OPT_MAX_PASSES = 2000

DDL = """
CREATE TABLE IF NOT EXISTS route_plans (
    region      TEXT NOT NULL,
    mode        TEXT NOT NULL CHECK (mode IN ('drive', 'bike')),
    n_stops     INT  NOT NULL,
    total_km    REAL NOT NULL,
    est_minutes INT  NOT NULL,
    route       JSONB NOT NULL,
    gpx         TEXT NOT NULL,
    created     DATE NOT NULL,
    PRIMARY KEY (region, mode)
);
"""


def local_database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    for env_path in (DATA_DIR.parent / "backend" / ".env", DATA_DIR / ".env"):
        if env_path.exists():
            url = dotenv_values(env_path).get("DATABASE_URL")
            if url:
                return url
    sys.exit("DATABASE_URL not found")


# --- Clustering --------------------------------------------------------------------


def cluster_gaps(
    gaps: list[tuple[float, float, str]], region: RegionConfig
) -> list[dict]:
    """Greedy grid clustering in the region's metric CRS.

    Returns stops: {x, y, lng, lat, road, gap_count}. Radius grows until the
    stop count fits MAX_STOPS (a route past that isn't a day trip).
    """
    from collections import Counter

    from pyproj import Transformer

    to_metric = Transformer.from_crs(4326, region.metric_epsg, always_xy=True)
    to_wgs = Transformer.from_crs(region.metric_epsg, 4326, always_xy=True)
    xs, ys = to_metric.transform([g[0] for g in gaps], [g[1] for g in gaps])

    radius = CLUSTER_RADIUS_M
    while True:
        cell = radius  # grid cell == radius: neighbors live in adjacent cells
        clusters: dict[tuple[int, int], list[int]] = {}
        centers: dict[tuple[int, int], tuple[float, float]] = {}
        for i, (x, y) in enumerate(zip(xs, ys)):
            key = None
            cx, cy = int(x // cell), int(y // cell)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    k = (cx + dx, cy + dy)
                    if k in centers:
                        mx, my = centers[k]
                        if (x - mx) ** 2 + (y - my) ** 2 <= radius * radius:
                            key = k
                            break
                if key:
                    break
            if key is None:
                key = (cx, cy)
                clusters[key] = []
                centers[key] = (x, y)
            clusters[key].append(i)
        if len(clusters) <= MAX_STOPS:
            break
        radius *= 1.4

    stops = []
    for key, members in clusters.items():
        mx = sum(xs[i] for i in members) / len(members)
        my = sum(ys[i] for i in members) / len(members)
        lng, lat = to_wgs.transform(mx, my)
        road = Counter(gaps[i][2] for i in members).most_common(1)[0][0]
        stops.append(
            {"x": mx, "y": my, "lng": lng, "lat": lat, "road": road, "gap_count": len(members)}
        )
    print(f"  {len(gaps):,} gaps -> {len(stops)} stops (radius {radius:.0f} m)")
    return stops


# --- Routing -----------------------------------------------------------------------


def order_stops(matrix: list[list[float]]) -> list[int]:
    """Open-path TSP: best nearest-neighbor start, improved with 2-opt."""
    n = len(matrix)

    def path_len(order: list[int]) -> float:
        return sum(matrix[order[i]][order[i + 1]] for i in range(n - 1))

    best: list[int] | None = None
    for start in range(min(n, 10)):
        unvisited = set(range(n)) - {start}
        order = [start]
        while unvisited:
            cur = order[-1]
            nxt = min(unvisited, key=lambda j: matrix[cur][j])
            order.append(nxt)
            unvisited.remove(nxt)
        if best is None or path_len(order) < path_len(best):
            best = order

    assert best is not None
    improved = True
    passes = 0
    while improved and passes < TWO_OPT_MAX_PASSES:
        improved = False
        passes += 1
        for i in range(n - 2):
            for j in range(i + 2, n):
                a, b = best[i], best[i + 1]
                c = best[j]
                d = best[j + 1] if j + 1 < n else None
                delta = matrix[a][c] - matrix[a][b]
                if d is not None:
                    delta += matrix[b][d] - matrix[c][d]
                if delta < -1e-9:
                    best[i + 1 : j + 1] = reversed(best[i + 1 : j + 1])
                    improved = True
    return best


def build_route(region: RegionConfig, stops: list[dict], mode: str) -> dict:
    """Snap stops to the cached drive graph, order them, stitch leg geometries."""
    import networkx as nx
    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.cache_folder = DATA_DIR / "cache" / "osmnx"

    print("  building graph from osmnx cache ...")
    graph = ox.graph_from_bbox(region.bbox, network_type="drive")
    undirected = ox.convert.to_undirected(graph)  # photographers ignore one-ways

    nodes = ox.distance.nearest_nodes(
        graph, X=[s["lng"] for s in stops], Y=[s["lat"] for s in stops]
    )
    # Merge stops that snapped to the same node
    merged: dict[int, dict] = {}
    for s, node in zip(stops, nodes):
        if node in merged:
            merged[node]["gap_count"] += s["gap_count"]
        else:
            merged[node] = dict(s, node=node)
    stops = list(merged.values())
    n = len(stops)
    print(f"  {n} stops after node merge; computing {n} Dijkstras ...")

    dists = [
        nx.single_source_dijkstra_path_length(undirected, s["node"], weight="length")
        for s in stops
    ]
    big = 10_000_000.0
    matrix = [
        [
            0.0
            if i == j
            else dists[i].get(
                stops[j]["node"],
                # disconnected fallback: euclidean x 1.5
                1.5 * math.hypot(stops[i]["x"] - stops[j]["x"], stops[i]["y"] - stops[j]["y"]) + big,
            )
            for j in range(n)
        ]
        for i in range(n)
    ]

    order = order_stops(matrix)

    features = []
    total_m = 0.0
    full_track: list[tuple[float, float]] = []
    for rank, idx in enumerate(order):
        s = stops[idx]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(s["lng"], 6), round(s["lat"], 6)]},
                "properties": {
                    "kind": "stop",
                    "order": rank + 1,
                    "road": s["road"],
                    "gap_count": s["gap_count"],
                },
            }
        )
    for k in range(n - 1):
        a, b = stops[order[k]], stops[order[k + 1]]
        try:
            node_path = nx.shortest_path(undirected, a["node"], b["node"], weight="length")
        except nx.NetworkXNoPath:
            node_path = [a["node"], b["node"]]
        coords: list[tuple[float, float]] = []
        leg_m = 0.0
        for u, v in zip(node_path[:-1], node_path[1:]):
            data = min(undirected[u][v].values(), key=lambda d: d.get("length", 0))
            leg_m += data.get("length", 0)
            if "geometry" in data:
                seg = list(data["geometry"].coords)
            else:
                seg = [
                    (undirected.nodes[u]["x"], undirected.nodes[u]["y"]),
                    (undirected.nodes[v]["x"], undirected.nodes[v]["y"]),
                ]
            if coords and seg and coords[-1] != seg[0] and coords[-1] == seg[-1]:
                seg = seg[::-1]  # edge geometry stored v->u
            coords.extend(seg if not coords else seg[1:])
        total_m += leg_m
        full_track.extend(coords if not full_track else coords[1:])
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(x, 6), round(y, 6)] for x, y in coords],
                },
                "properties": {"kind": "leg", "order": k + 1, "length_km": float(round(leg_m / 1000, 2))},
            }
        )

    total_km = float(total_m) / 1000  # osmnx lengths can be numpy floats
    est_minutes = int(round(total_km / SPEED_KMH[mode] * 60 + n * CAPTURE_MINUTES_PER_STOP))
    return {
        "n_stops": n,
        "total_km": float(round(total_km, 1)),
        "est_minutes": est_minutes,
        "route": {"type": "FeatureCollection", "features": features},
        "track": full_track,
        "ordered_stops": [stops[i] for i in order],
    }


# --- GPX ---------------------------------------------------------------------------


def to_gpx(region: RegionConfig, mode: str, plan: dict) -> str:
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="streetview-coverage-explorer" '
        'xmlns="http://www.topografix.com/GPX/1/1">',
        f"  <metadata><name>{escape(region.name)} gap route ({mode})</name></metadata>",
    ]
    for i, s in enumerate(plan["ordered_stops"]):
        out.append(
            f'  <wpt lat="{s["lat"]:.6f}" lon="{s["lng"]:.6f}">'
            f"<name>{i + 1}. {escape(s['road'])}</name>"
            f"<desc>{s['gap_count']} gap points</desc></wpt>"
        )
    out.append(f"  <trk><name>{escape(region.name)} gap route</name><trkseg>")
    out.extend(
        f'    <trkpt lat="{lat:.6f}" lon="{lng:.6f}"/>' for lng, lat in plan["track"]
    )
    out.append("  </trkseg></trk>")
    out.append("</gpx>")
    return "\n".join(out)


# --- Main --------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan a gap-filling route.")
    parser.add_argument("--region", required=True, choices=sorted(REGIONS))
    parser.add_argument("--mode", default="drive", choices=("drive", "bike"))
    args = parser.parse_args()
    region = REGIONS[args.region]
    if region.counties:
        sys.exit("Route planning targets city regions, not statewide ones.")

    conn = psycopg2.connect(local_database_url())
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT ST_X(geom), ST_Y(geom), COALESCE(nearest_road, 'Unnamed road')
                FROM coverage_samples WHERE region = %s AND status = 'ZERO_RESULTS'
                """,
                (args.region,),
            )
            gaps = cur.fetchall()
        if not gaps:
            sys.exit(f"No gaps for region {args.region} — nothing to plan.")
        print(f"Planning {args.mode} route for {len(gaps):,} gaps in {region.name}")

        stops = cluster_gaps(gaps, region)
        plan = build_route(region, stops, args.mode)
        gpx = to_gpx(region, args.mode, plan)
        print(
            f"  route: {plan['n_stops']} stops, {plan['total_km']} km, "
            f"~{plan['est_minutes']} min ({args.mode})"
        )

        with conn, conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute(
                """
                INSERT INTO route_plans
                    (region, mode, n_stops, total_km, est_minutes, route, gpx, created)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (region, mode) DO UPDATE SET
                    n_stops = EXCLUDED.n_stops, total_km = EXCLUDED.total_km,
                    est_minutes = EXCLUDED.est_minutes, route = EXCLUDED.route,
                    gpx = EXCLUDED.gpx, created = EXCLUDED.created
                """,
                (
                    args.region,
                    args.mode,
                    plan["n_stops"],
                    plan["total_km"],
                    plan["est_minutes"],
                    json.dumps(plan["route"]),
                    gpx,
                    date.today(),
                ),
            )
        print(f"Stored route_plans[{args.region}, {args.mode}]")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
