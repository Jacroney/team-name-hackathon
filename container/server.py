from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import geopandas as gpd
from shapely.geometry import Point

MAX_BODY_BYTES = 16_384
JURISDICTION_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
DATA_ROOT = Path("/mnt/r2") / os.environ.get("HAZARD_BUCKET_PREFIX", "jurisdictions")


@dataclass(frozen=True)
class JurisdictionData:
    analysis_version: str
    hazards: gpd.GeoDataFrame
    evacuation_zones: gpd.GeoDataFrame
    shelters: gpd.GeoDataFrame
    blocked_roads: gpd.GeoDataFrame
    loaded_at: float


_cache: dict[str, JurisdictionData] = {}


def _empty_layer() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")


def _load_layer(path: Path) -> gpd.GeoDataFrame:
    if not path.is_file():
        return _empty_layer()
    layer = gpd.read_file(path)
    if layer.crs is None:
        layer = layer.set_crs("EPSG:4326")
    return layer.to_crs("EPSG:4326")


def _load_jurisdiction(jurisdiction_id: str) -> JurisdictionData:
    cached = _cache.get(jurisdiction_id)
    if cached and time.monotonic() - cached.loaded_at < 60:
        return cached

    directory = DATA_ROOT / jurisdiction_id
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError("hazard manifest unavailable")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    analysis_version = manifest.get("analysisVersion")
    if not isinstance(analysis_version, str) or not analysis_version:
        raise ValueError("invalid hazard manifest")

    loaded = JurisdictionData(
        analysis_version=analysis_version,
        hazards=_load_layer(directory / "hazard-zones.geojson"),
        evacuation_zones=_load_layer(directory / "evacuation-zones.geojson"),
        shelters=_load_layer(directory / "shelters.geojson"),
        blocked_roads=_load_layer(directory / "blocked-roads.geojson"),
        loaded_at=time.monotonic(),
    )
    _cache[jurisdiction_id] = loaded
    return loaded


def _property(row: Any, names: tuple[str, ...], default: str) -> str:
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip():
            return str(value)
    return default


def assess(payload: dict[str, Any]) -> dict[str, Any]:
    jurisdiction_id = payload.get("jurisdictionId")
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")
    radius = payload.get("blockedRoadRadiusMeters", 1_000)
    if not isinstance(jurisdiction_id, str) or not JURISDICTION_PATTERN.fullmatch(jurisdiction_id):
        raise ValueError("invalid jurisdiction")
    if not isinstance(latitude, (int, float)) or not -90 <= latitude <= 90:
        raise ValueError("invalid latitude")
    if not isinstance(longitude, (int, float)) or not -180 <= longitude <= 180:
        raise ValueError("invalid longitude")
    if not isinstance(radius, (int, float)) or not 0 <= radius <= 20_000:
        raise ValueError("invalid radius")

    data = _load_jurisdiction(jurisdiction_id)
    point = Point(float(longitude), float(latitude))
    point_frame = gpd.GeoDataFrame({"geometry": [point]}, crs="EPSG:4326")
    projected_crs = point_frame.estimate_utm_crs() or "EPSG:3857"
    projected_point = point_frame.to_crs(projected_crs).geometry.iloc[0]

    hazard_rows = data.hazards[data.hazards.geometry.covers(point)]
    hazard_types = sorted(
        {
            _property(row, ("hazardType", "hazard_type", "type"), "unknown")
            for _, row in hazard_rows.iterrows()
        }
    )

    evacuation_rows = data.evacuation_zones[data.evacuation_zones.geometry.covers(point)]
    evacuation_zone = None
    if not evacuation_rows.empty:
        evacuation_zone = _property(
            evacuation_rows.iloc[0],
            ("zoneId", "zone_id", "name"),
            "unnamed-zone",
        )

    nearest_shelter = None
    if not data.shelters.empty:
        projected_shelters = data.shelters.to_crs(projected_crs)
        distances = projected_shelters.geometry.distance(projected_point)
        nearest_index = distances.idxmin()
        shelter = data.shelters.loc[nearest_index]
        accessible_value = shelter.get("accessible", False)
        nearest_shelter = {
            "id": _property(shelter, ("id", "shelterId", "shelter_id"), str(nearest_index)),
            "distanceMeters": round(float(distances.loc[nearest_index]), 1),
            "accessible": accessible_value is True
            or str(accessible_value).strip().lower() in {"true", "yes", "1"},
        }

    blocked_roads_nearby = 0
    if not data.blocked_roads.empty:
        projected_roads = data.blocked_roads.to_crs(projected_crs)
        blocked_roads_nearby = int((projected_roads.geometry.distance(projected_point) <= radius).sum())

    return {
        "insideHazardZone": bool(hazard_types),
        "hazardTypes": hazard_types,
        "evacuationZone": evacuation_zone,
        "nearestShelter": nearest_shelter,
        "blockedRoadsNearby": blocked_roads_nearby,
        "analysisVersion": data.analysis_version,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "CrisisMeshGeo/1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _json_response(self, status: HTTPStatus, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._json_response(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        self._json_response(HTTPStatus.OK, {"status": "ok"})

    def do_POST(self) -> None:
        if self.path != "/assess":
            self._json_response(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_BODY_BYTES:
                raise ValueError("invalid body size")
            payload = json.loads(self.rfile.read(content_length))
            if not isinstance(payload, dict):
                raise ValueError("invalid body")
            self._json_response(HTTPStatus.OK, assess(payload))
        except (ValueError, json.JSONDecodeError):
            self._json_response(HTTPStatus.BAD_REQUEST, {"error": "invalid_request"})
        except FileNotFoundError:
            self._json_response(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "hazard_data_unavailable"})
        except Exception:
            self._json_response(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "analysis_failed"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
