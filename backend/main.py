import os
import json
import sys
import base64
import csv
import hmac
import hashlib
import io
import secrets
import time
from pathlib import Path
from functools import lru_cache

import h5py
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text

try:
    import shapefile
except ImportError:  # pragma: no cover - depends on runtime environment
    shapefile = None

try:
    from shapely.geometry import box, mapping, shape as shapely_shape
    from shapely.validation import make_valid as shapely_make_valid
except ImportError:  # pragma: no cover - depends on runtime environment
    box = mapping = shapely_shape = shapely_make_valid = None

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

load_dotenv(Path(__file__).with_name(".env"))

MUNICIPALITY_BOUNDARY_PATH = (
    PROJECT_ROOT
    / "data"
    / "raw"
    / "southern_leyte"
    / "boundary"
    / "gadm41_PHL_2.shp"
)
BARANGAY_BOUNDARY_PATH = (
    PROJECT_ROOT
    / "data"
    / "raw"
    / "southern_leyte"
    / "boundary"
    / "gadm41_PHL_3.shp"
)
PROVINCE_BOUNDARY_PATH = (
    PROJECT_ROOT
    / "data"
    / "raw"
    / "southern_leyte"
    / "boundary"
    / "gadm41_PHL_1.shp"
)

from model.inference import (
    MODEL_CHECKPOINT,
    MODEL_NAME,
    run_baseline_hazard_predictions,
    run_landslide_predictions,
    run_live_rainfall_prediction,
    run_rainfall_simulation,
    run_sample_inference,
)

app = FastAPI(title="Landslide Prediction API")

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
JWT_SECRET = os.getenv("JWT_SECRET", "sl-lps-local-development-secret")
JWT_EXPIRES_SECONDS = 60 * 60 * 8


EXPOSURE_DIR = PROJECT_ROOT / "data" / "raw" / "southern_leyte" / "exposure"
LOSS_ESTIMATION_DIR = (
    PROJECT_ROOT / "data" / "processed" / "southern_leyte" / "loss_estimation"
)
BARANGAY_POPULATION_PATH = EXPOSURE_DIR / "barangay_population.csv"
ASSET_VALUES_PATH = EXPOSURE_DIR / "asset_values.csv"
VULNERABILITY_RATES_PATH = EXPOSURE_DIR / "vulnerability_rates.csv"
LOSS_EXPOSURE_SUMMARY_PATH = LOSS_ESTIMATION_DIR / "loss_exposure_summary.csv"

FALLBACK_LOSS_ASSUMPTIONS = {
    "province_area_sq_km": 1798.61,
    "population_total": 429_573,
    "estimated_total_asset_value_php": 42_887_219_240,
    "population_per_sq_km": 330,
    "asset_value_php_per_sq_km": 18_000_000,
    "damage_ratio": 0.45,
    "casualty_rate": 0.0075,
}

RISK_BREAKDOWN_LEVELS = ["15%", "30%", "50%", "75%", "100%"]
BASELINE_HAZARD_MASK_PATH = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "southern_leyte"
    / "masks"
    / "southern_leyte_osm_manual_noah_5level_target.h5"
)
BASELINE_HAZARD_OVERLAY_BOUNDS = {
    "min_lon": 124.62,
    "min_lat": 9.88,
    "max_lon": 125.35,
    "max_lat": 10.55,
}


class RainfallSimulationRequest(BaseModel):
    rainfall_mm_per_hr: float = Field(ge=0, le=300)
    duration_hours: float = Field(ge=0, le=168)
    saturation_factor: float = Field(default=1.0, ge=0, le=5)


class RainfallSimulationLogRequest(BaseModel):
    timestamp: str | None = None
    started_at: str | None = None
    ended_by: str | None = None
    rainfall_rate: float = Field(ge=0)
    duration_hours: float = Field(ge=0)
    saturation_factor: float = Field(ge=0)
    step_percent: float = Field(ge=0, le=100)
    affected_people: float = Field(default=0, ge=0)
    possible_casualties: float = Field(default=0, ge=0)
    economic_loss: float = Field(default=0, ge=0)
    mapped_area: float = Field(default=0, ge=0)
    hotspot: str | None = None
    risk_level: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class SystemSettingsRequest(BaseModel):
    theme_mode: str | None = None
    export_format: str | None = None
    data_scope: str | None = None
    default_municipality: str | None = None
    default_rainfall: float | None = Field(default=None, ge=0, le=300)
    default_duration: float | None = Field(default=None, ge=0, le=168)
    map_interaction: str | None = None


class GenerateReportRequest(BaseModel):
    municipality: str = "Southern Leyte"
    report_type: str = "Risk Summary"
    format: str = "PDF"


DEFAULT_SYSTEM_SETTINGS = {
    "theme_mode": "light",
    "export_format": "GeoJSON",
    "data_scope": "Risk Zones",
    "default_municipality": "Bontoc",
    "default_rainfall": 120,
    "default_duration": 6,
    "map_interaction": "Locked by default",
}


def bootstrap_admin_user():
    email = os.getenv("BOOTSTRAP_ADMIN_EMAIL")
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD")

    if not email or not password:
        return

    salt = secrets.token_hex(16)
    password_hash = hash_password(password, salt)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO users (
                    email,
                    password_hash,
                    salt,
                    first_name,
                    middle_name,
                    last_name,
                    role
                )
                VALUES (
                    :email,
                    :password_hash,
                    :salt,
                    :first_name,
                    :middle_name,
                    :last_name,
                    :role
                )
                ON CONFLICT (email) DO NOTHING;
                """
            ),
            {
                "email": email.strip().lower(),
                "password_hash": password_hash,
                "salt": salt,
                "first_name": os.getenv("BOOTSTRAP_ADMIN_FIRST_NAME", "Admin"),
                "middle_name": os.getenv("BOOTSTRAP_ADMIN_MIDDLE_NAME") or None,
                "last_name": os.getenv("BOOTSTRAP_ADMIN_LAST_NAME", "User"),
                "role": os.getenv("BOOTSTRAP_ADMIN_ROLE", "admin"),
            },
        )


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        260_000,
    ).hex()


def verify_password(password: str, salt: str, password_hash: str) -> bool:
    return secrets.compare_digest(hash_password(password, salt), password_hash)


def user_response(row):
    return {
        "id": row["id"],
        "email": row["email"],
        "firstName": row["first_name"],
        "middleName": row["middle_name"],
        "lastName": row["last_name"],
        "role": row["role"],
    }


def base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def create_access_token(user: dict) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "iat": now,
        "exp": now + JWT_EXPIRES_SECONDS,
    }
    signing_input = ".".join(
        [
            base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        ]
    )
    signature = hmac.new(
        JWT_SECRET.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{signing_input}.{base64url_encode(signature)}"


@app.on_event("startup")
def prepare_auth_users():
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    salt TEXT NOT NULL,
                    first_name TEXT NOT NULL,
                    middle_name TEXT NULL,
                    last_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'admin',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
        )

    bootstrap_admin_user()
    ensure_rainfall_simulation_logs_table()
    ensure_system_settings_table()
    ensure_alerts_table()
    ensure_generated_reports_table()


@app.get("/")
def root():
    return {"message": "Landslide Prediction API running"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/db-health")
def db_health():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT postgis_full_version();"))
        postgis_version = result.scalar()

    return {
        "database": "connected",
        "postgis": postgis_version,
    }


def ensure_system_settings_table():
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS system_settings (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
        )

        for key, value in DEFAULT_SYSTEM_SETTINGS.items():
            conn.execute(
                text(
                    """
                    INSERT INTO system_settings (key, value)
                    VALUES (:key, CAST(:value AS JSONB))
                    ON CONFLICT (key) DO NOTHING;
                    """
                ),
                {"key": key, "value": json.dumps(value)},
            )


def read_system_settings():
    ensure_system_settings_table()

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT key, value FROM system_settings;")
        ).mappings().all()

    settings = dict(DEFAULT_SYSTEM_SETTINGS)
    for row in rows:
        settings[row["key"]] = row["value"]

    return settings


@app.get("/system-settings")
def system_settings():
    return {"settings": read_system_settings()}


@app.put("/system-settings")
def update_system_settings(request: SystemSettingsRequest):
    ensure_system_settings_table()
    updates = request.dict(exclude_none=True)

    with engine.begin() as conn:
        for key, value in updates.items():
            conn.execute(
                text(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES (:key, CAST(:value AS JSONB), NOW())
                    ON CONFLICT (key) DO UPDATE SET
                        value = EXCLUDED.value,
                        updated_at = NOW();
                    """
                ),
                {"key": key, "value": json.dumps(value)},
            )

    return {"settings": read_system_settings()}


def build_settings_metadata():
    ensure_system_settings_table()
    ensure_rainfall_simulation_logs_table()

    with engine.connect() as conn:
        risk_zone_count = conn.execute(text("SELECT COUNT(*) FROM risk_zones;")).scalar()
        simulation_log_count = conn.execute(
            text("SELECT COUNT(*) FROM rainfall_simulation_logs;")
        ).scalar()
        settings_updated_at = conn.execute(
            text("SELECT MAX(updated_at) FROM system_settings;")
        ).scalar()

    barangay_count = sum(
        len(features) for features in load_southern_leyte_barangay_boundaries().values()
    )
    municipality_count = len(load_southern_leyte_municipality_boundaries())

    return {
        "risk_zones": risk_zone_count,
        "simulation_logs": simulation_log_count,
        "municipality_boundaries": municipality_count,
        "barangay_boundaries": barangay_count,
        "settings_updated_at": settings_updated_at.isoformat()
        if settings_updated_at
        else None,
    }


@app.get("/system-settings/metadata")
def system_settings_metadata():
    return build_settings_metadata()


@app.post("/system-controls/{action}")
def run_system_control(action: str):
    normalized_action = action.strip().lower()

    if normalized_action == "reload-risk-zones":
        return {
            "message": "Risk zones reloaded from database",
            "metadata": build_settings_metadata(),
        }

    if normalized_action == "check-model-health":
        return {
            "message": "Model health check complete",
            "model": model_health(),
        }

    if normalized_action == "backup-configuration":
        settings = read_system_settings()

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO system_settings (key, value, updated_at)
                    VALUES ('last_configuration_backup', CAST(:value AS JSONB), NOW())
                    ON CONFLICT (key) DO UPDATE SET
                        value = EXCLUDED.value,
                        updated_at = NOW();
                    """
                ),
                {"value": json.dumps(settings)},
            )

        return {
            "message": "Configuration backup saved in database",
            "settings": settings,
        }

    raise HTTPException(status_code=404, detail="Unknown system control.")


def csv_response(filename, rows):
    output = io.StringIO()
    fieldnames = sorted({key for row in rows for key in row.keys()}) if rows else ["message"]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    if rows:
        writer.writerows(rows)
    else:
        writer.writerow({"message": "No rows available"})

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
    )


def json_export_response(filename, payload):
    return Response(
        content=json.dumps(payload, default=str),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}.json"'},
    )


@app.get("/system-export")
def system_export(scope: str = "Risk Zones", format: str = "GeoJSON"):
    normalized_scope = scope.strip().lower()
    normalized_format = format.strip().lower()

    if normalized_scope == "risk zones":
        payload = risk_zones()
        filename = "risk-zones"
        csv_rows = [
            {
                "id": feature["properties"].get("id"),
                "name": feature["properties"].get("name"),
                "risk_level": feature["properties"].get("risk_level"),
                "probability": feature["properties"].get("probability"),
            }
            for feature in payload.get("features", [])
        ]
    elif normalized_scope == "municipality boundaries":
        payload = municipality_boundaries()
        filename = "municipality-boundaries"
        csv_rows = [
            feature.get("properties", {}) for feature in payload.get("features", [])
        ]
    elif normalized_scope == "barangay boundaries":
        payload = barangay_boundaries()
        filename = "barangay-boundaries"
        csv_rows = [
            feature.get("properties", {}) for feature in payload.get("features", [])
        ]
    elif normalized_scope == "simulation logs":
        payload = rainfall_simulation_logs(limit=100)
        filename = "simulation-logs"
        csv_rows = payload.get("logs", [])
    else:
        raise HTTPException(status_code=404, detail="Unknown export scope.")

    if normalized_format == "csv":
        return csv_response(filename, csv_rows)

    if normalized_format == "sql dump":
        return Response(
            content=(
                f"-- {scope} export\n"
                f"-- Generated by Southern Leyte Landslide Prediction System\n"
                f"-- Rows: {len(csv_rows)}\n"
                f"/* JSON payload:\n{json.dumps(payload, default=str)}\n*/\n"
            ),
            media_type="application/sql",
            headers={"Content-Disposition": f'attachment; filename="{filename}.sql"'},
        )

    if normalized_format == "pdf summary":
        return Response(
            content=(
                f"{scope} Summary\n"
                f"Generated by Southern Leyte Landslide Prediction System\n"
                f"Records: {len(csv_rows)}\n"
            ),
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename="{filename}-summary.txt"'},
        )

    return json_export_response(filename, payload)


@lru_cache(maxsize=1)
def load_southern_leyte_province_boundary():
    if shapefile is None or not PROVINCE_BOUNDARY_PATH.exists():
        return None

    reader = shapefile.Reader(str(PROVINCE_BOUNDARY_PATH))
    fields = [field[0] for field in reader.fields[1:]]

    for shape_record in reader.iterShapeRecords():
        record = dict(zip(fields, shape_record.record))

        if record.get("NAME_1") != "Southern Leyte":
            continue

        min_lon, min_lat, max_lon, max_lat = shape_record.shape.bbox
        return {
            "type": "Feature",
            "properties": {
                "name": "Southern Leyte",
                "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
            },
            "geometry": shape_record.shape.__geo_interface__,
        }

    return None


def load_prediction_tile_boundary():
    province = load_southern_leyte_province_boundary()

    if (
        province is None
        or shapely_shape is None
        or box is None
        or mapping is None
        or shapely_make_valid is None
    ):
        return province

    min_lon = BASELINE_HAZARD_OVERLAY_BOUNDS["min_lon"]
    min_lat = BASELINE_HAZARD_OVERLAY_BOUNDS["min_lat"]
    max_lon = BASELINE_HAZARD_OVERLAY_BOUNDS["max_lon"]
    max_lat = BASELINE_HAZARD_OVERLAY_BOUNDS["max_lat"]

    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT
                        ST_XMin(bounds) AS min_lon,
                        ST_YMin(bounds) AS min_lat,
                        ST_XMax(bounds) AS max_lon,
                        ST_YMax(bounds) AS max_lat
                    FROM (
                        SELECT ST_Extent(geom)::box2d AS bounds
                        FROM risk_zones
                    ) AS risk_bounds
                    WHERE bounds IS NOT NULL;
                    """
                )
            ).mappings().first()

        if row:
            min_lon = float(row["min_lon"])
            min_lat = float(row["min_lat"])
            max_lon = float(row["max_lon"])
            max_lat = float(row["max_lat"])
    except Exception:
        pass

    tile_bounds = box(
        min_lon,
        min_lat,
        max_lon,
        max_lat,
    )
    clipped = shapely_make_valid(
        shapely_shape(province["geometry"]).intersection(tile_bounds)
    )

    if clipped.is_empty:
        return province

    min_lon, min_lat, max_lon, max_lat = clipped.bounds
    return {
        "type": "Feature",
        "properties": {
            "name": "Southern Leyte prediction tile",
            "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
        },
        "geometry": mapping(clipped),
    }


def clip_feature_to_prediction_tile(feature):
    if (
        not feature
        or shapely_shape is None
        or box is None
        or mapping is None
        or shapely_make_valid is None
    ):
        return feature

    try:
        tile_bounds = box(
            BASELINE_HAZARD_OVERLAY_BOUNDS["min_lon"],
            BASELINE_HAZARD_OVERLAY_BOUNDS["min_lat"],
            BASELINE_HAZARD_OVERLAY_BOUNDS["max_lon"],
            BASELINE_HAZARD_OVERLAY_BOUNDS["max_lat"],
        )
        clipped = shapely_make_valid(
            shapely_shape(feature["geometry"]).intersection(tile_bounds)
        )
    except Exception:
        return feature

    if clipped.is_empty:
        return None

    min_lon, min_lat, max_lon, max_lat = clipped.bounds
    clipped_feature = {
        **feature,
        "properties": {
            **feature.get("properties", {}),
            "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
        },
        "geometry": mapping(clipped),
    }
    return clipped_feature


@app.post("/auth/login")
def login(request: LoginRequest):
    email = request.email.strip().lower()

    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT
                    id,
                    email,
                    password_hash,
                    salt,
                    first_name,
                    middle_name,
                    last_name,
                    role
                FROM users
                WHERE lower(email) = :email
                LIMIT 1;
                """
            ),
            {"email": email},
        ).mappings().first()

    if row is None or not verify_password(
        request.password,
        row["salt"],
        row["password_hash"],
    ):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    return {
        "message": "Login successful",
        "accessToken": create_access_token(user_response(row)),
        "user": user_response(row),
    }


@lru_cache(maxsize=1)
def load_southern_leyte_municipality_boundaries():
    if shapefile is None or not MUNICIPALITY_BOUNDARY_PATH.exists():
        return {}

    reader = shapefile.Reader(str(MUNICIPALITY_BOUNDARY_PATH))
    fields = [field[0] for field in reader.fields[1:]]
    boundaries = {}

    for shape_record in reader.iterShapeRecords():
        record = dict(zip(fields, shape_record.record))

        if record.get("NAME_1") != "Southern Leyte":
            continue

        name = record.get("NAME_2")
        min_lon, min_lat, max_lon, max_lat = shape_record.shape.bbox
        feature = {
            "type": "Feature",
            "properties": {
                "name": name,
                "province": record.get("NAME_1"),
                "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
            },
            "geometry": shape_record.shape.__geo_interface__,
        }
        feature = clip_feature_to_prediction_tile(feature)

        if feature is not None:
            boundaries[name.lower()] = feature

    return boundaries


def _normalize_place_name(value):
    return " ".join(str(value or "").strip().lower().replace("city", "").split())


def calculate_barangay_risk_breakdown(geometry):
    if not geometry:
        return []

    if active_risk_surface() == "baseline":
        return calculate_baseline_barangay_risk_breakdown(geometry)

    return calculate_barangay_risk_breakdown_from_json(json.dumps(geometry))


def active_risk_surface():
    with engine.connect() as conn:
        names = [
            row["name"]
            for row in conn.execute(
                text("SELECT name FROM risk_zones ORDER BY name LIMIT 10;")
            ).mappings().all()
        ]

    if names and all(name.startswith("Baseline Hazard") for name in names):
        return "baseline"

    return "vector"


def baseline_hazard_classes():
    with h5py.File(BASELINE_HAZARD_MASK_PATH, "r") as f:
        mask = f["mask"][:].astype("float32")

    classes = np.zeros(mask.shape, dtype=np.uint8)
    class_specs = [
        (1, mask <= 0.151),
        (2, (mask > 0.151) & (mask < 0.49)),
        (3, (mask >= 0.49) & (mask < 0.74)),
        (4, (mask >= 0.74) & (mask < 0.99)),
        (5, mask >= 0.99),
    ]

    for class_value, selector in class_specs:
        classes[selector] = class_value

    classes = np.asarray(
        Image.fromarray(classes, mode="L").filter(ImageFilter.ModeFilter(size=3))
    ).copy()
    classes[classes == 0] = 1
    return classes


def calculate_baseline_barangay_risk_breakdown(geometry):
    classes = baseline_hazard_classes()

    barangay_mask = Image.new("L", classes.shape[::-1], 0)
    draw = ImageDraw.Draw(barangay_mask)

    def to_pixel(coordinate):
        lon, lat = coordinate[:2]
        x = (
            (lon - BASELINE_HAZARD_OVERLAY_BOUNDS["min_lon"])
            / (
                BASELINE_HAZARD_OVERLAY_BOUNDS["max_lon"]
                - BASELINE_HAZARD_OVERLAY_BOUNDS["min_lon"]
            )
            * (classes.shape[1] - 1)
        )
        y = (
            (BASELINE_HAZARD_OVERLAY_BOUNDS["max_lat"] - lat)
            / (
                BASELINE_HAZARD_OVERLAY_BOUNDS["max_lat"]
                - BASELINE_HAZARD_OVERLAY_BOUNDS["min_lat"]
            )
            * (classes.shape[0] - 1)
        )
        return (x, y)

    def draw_polygon_rings(rings):
        if not rings:
            return

        draw.polygon([to_pixel(point) for point in rings[0]], fill=255)
        for hole in rings[1:]:
            draw.polygon([to_pixel(point) for point in hole], fill=0)

    if geometry.get("type") == "Polygon":
        draw_polygon_rings(geometry.get("coordinates", []))
    elif geometry.get("type") == "MultiPolygon":
        for polygon in geometry.get("coordinates", []):
            draw_polygon_rings(polygon)

    selected = np.asarray(barangay_mask) > 0
    total_pixels = int(selected.sum())

    if total_pixels == 0:
        return []

    specs = [
        ("15%", "Low", classes == 1),
        ("30%", "Slightly Low", classes == 2),
        ("50%", "Moderate", classes == 3),
        ("75%", "High", classes == 4),
        ("100%", "Very High", classes == 5),
    ]
    barangay_area_sq_km = approximate_barangay_area_sq_km(geometry)
    breakdown = []

    for risk_level, label, selector in specs:
        pixel_count = int((selected & selector).sum())
        percent = round(pixel_count / total_pixels * 100.0, 1)
        breakdown.append(
            {
                "risk_level": risk_level,
                "label": label,
                "area_sq_km": round(barangay_area_sq_km * percent / 100.0, 4),
                "barangay_area_sq_km": round(barangay_area_sq_km, 4),
                "percent": percent,
            }
        )

    total_percent = sum(item["percent"] for item in breakdown)
    if breakdown and total_percent:
        adjustment = round(100.0 - total_percent, 1)
        dominant_index = max(
            range(len(breakdown)),
            key=lambda index: breakdown[index]["percent"],
        )
        breakdown[dominant_index]["percent"] = round(
            breakdown[dominant_index]["percent"] + adjustment,
            1,
        )

    return breakdown


def approximate_barangay_area_sq_km(geometry):
    query = text(
        """
        SELECT ST_Area(
            ST_Transform(
                ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326),
                32651
            )
        ) / 1000000.0 AS area_sq_km;
        """
    )

    with engine.connect() as conn:
        return float(
            conn.execute(
                query,
                {"geometry": json.dumps(geometry)},
            ).scalar()
            or 0
        )


@lru_cache(maxsize=1024)
def calculate_barangay_risk_breakdown_from_json(geometry_json):
    if not geometry_json:
        return []

    query = text(
        """
        WITH
        barangay AS (
            SELECT
                ST_MakeValid(
                    ST_Transform(
                        ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326),
                        32651
                    )
                ) AS geom
        ),
        levels(label, level_order) AS (
            VALUES
                ('15%', 1),
                ('30%', 2),
                ('50%', 3),
                ('75%', 4),
                ('100%', 5)
        ),
        risk_geometries AS (
            SELECT
                CASE risk_level
                    WHEN 'Low' THEN '30%'
                    WHEN 'Medium' THEN '50%'
                    WHEN 'High' THEN '75%'
                    ELSE risk_level
                END AS label,
                ST_MakeValid(ST_Transform(geom, 32651)) AS geom
            FROM risk_zones
            WHERE risk_level IN ('15%', '30%', '50%', '75%', '100%', 'Low', 'Medium', 'High')
        ),
        risk_unions AS (
            SELECT
                levels.label,
                levels.level_order,
                ST_UnaryUnion(ST_Collect(risk_geometries.geom)) AS geom
            FROM levels
            JOIN risk_geometries ON risk_geometries.label = levels.label
            GROUP BY levels.label, levels.level_order
        ),
        visible_risk AS (
            SELECT
                risk_unions.label,
                risk_unions.level_order,
                ST_Difference(
                    risk_unions.geom,
                    COALESCE(
                        (
                            SELECT ST_UnaryUnion(ST_Collect(higher.geom))
                            FROM risk_unions higher
                            WHERE higher.level_order > risk_unions.level_order
                        ),
                        ST_SetSRID(ST_GeomFromText('GEOMETRYCOLLECTION EMPTY'), 32651)
                    )
                ) AS geom
            FROM risk_unions
        ),
        barangay_area AS (
            SELECT GREATEST(ST_Area(geom), 1.0) AS area_m2 FROM barangay
        ),
        intersected AS (
            SELECT
                visible_risk.label,
                visible_risk.level_order,
                ST_Area(ST_Intersection(visible_risk.geom, barangay.geom)) AS area_m2
            FROM visible_risk
            CROSS JOIN barangay
            WHERE ST_Intersects(visible_risk.geom, barangay.geom)
        )
        SELECT
            levels.label,
            COALESCE(SUM(intersected.area_m2), 0) / 1000000.0 AS area_sq_km,
            barangay_area.area_m2 / 1000000.0 AS barangay_area_sq_km,
            COALESCE(SUM(intersected.area_m2), 0) / barangay_area.area_m2 * 100.0 AS percent
        FROM levels
        CROSS JOIN barangay_area
        LEFT JOIN intersected ON intersected.label = levels.label
        GROUP BY levels.label, levels.level_order, barangay_area.area_m2
        ORDER BY levels.level_order;
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(
            query,
            {"geometry": geometry_json},
        ).mappings().all()

    breakdown = [
        {
            "risk_level": row["label"],
            "label": {
                "15%": "Low",
                "30%": "Slightly Low",
                "50%": "Moderate",
                "75%": "High",
                "100%": "Very High",
            }.get(row["label"], row["label"]),
            "area_sq_km": round(float(row["area_sq_km"] or 0), 4),
            "barangay_area_sq_km": round(float(row["barangay_area_sq_km"] or 0), 4),
            "percent": round(float(row["percent"] or 0), 1),
        }
        for row in rows
    ]
    covered_percent = sum(item["percent"] for item in breakdown)

    if breakdown and 0 <= covered_percent < 99.9:
        remainder = round(100.0 - covered_percent, 1)
        barangay_area_sq_km = breakdown[0].get("barangay_area_sq_km", 0)
        breakdown[0]["percent"] = round(breakdown[0]["percent"] + remainder, 1)
        breakdown[0]["area_sq_km"] = round(
            breakdown[0]["area_sq_km"] + barangay_area_sq_km * remainder / 100.0,
            4,
        )

    total_percent = sum(item["percent"] for item in breakdown)
    if breakdown and total_percent:
        adjustment = round(100.0 - total_percent, 1)
        breakdown[-1]["percent"] = round(breakdown[-1]["percent"] + adjustment, 1)

    return breakdown


@lru_cache(maxsize=1)
def load_barangay_population_lookup():
    population_rows = _read_csv_rows(BARANGAY_POPULATION_PATH)
    lookup = {}

    for row in population_rows:
        municipality = _normalize_place_name(row.get("municipality"))
        barangay = _normalize_place_name(row.get("barangay"))

        if not municipality or not barangay:
            continue

        lookup[(municipality, barangay)] = {
            "population": int(round(_to_float(row.get("population")))),
            "households": row.get("households") or None,
            "year": int(round(_to_float(row.get("year"))))
            if row.get("year")
            else None,
            "source": row.get("source") or None,
            "source_url": row.get("source_url") or None,
        }

    return lookup


@app.get("/municipality-boundary/{municipality_name}")
def municipality_boundary(municipality_name: str):
    boundaries = load_southern_leyte_municipality_boundaries()
    boundary = boundaries.get(municipality_name.lower())

    if boundary is None:
        return {
            "type": "FeatureCollection",
            "features": [],
        }

    return boundary


@app.get("/municipality-boundaries")
def municipality_boundaries():
    boundaries = load_southern_leyte_municipality_boundaries()

    return {
        "type": "FeatureCollection",
        "features": list(boundaries.values()),
    }


@app.get("/province-boundary")
def province_boundary():
    boundary = load_prediction_tile_boundary()

    if boundary is None:
        return {
            "type": "FeatureCollection",
            "features": [],
        }

    return boundary


@lru_cache(maxsize=1)
def load_southern_leyte_barangay_boundaries():
    if shapefile is None or not BARANGAY_BOUNDARY_PATH.exists():
        return {}

    reader = shapefile.Reader(str(BARANGAY_BOUNDARY_PATH))
    fields = [field[0] for field in reader.fields[1:]]
    barangays_by_municipality = {}
    population_lookup = load_barangay_population_lookup()

    for shape_record in reader.iterShapeRecords():
        record = dict(zip(fields, shape_record.record))

        if record.get("NAME_1") != "Southern Leyte":
            continue

        municipality_name = record.get("NAME_2")
        barangay_name = record.get("NAME_3")
        population = population_lookup.get(
            (
                _normalize_place_name(municipality_name),
                _normalize_place_name(barangay_name),
            ),
            {},
        )
        min_lon, min_lat, max_lon, max_lat = shape_record.shape.bbox
        feature = {
            "type": "Feature",
            "properties": {
                "name": barangay_name,
                "municipality": municipality_name,
                "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
                "population": population.get("population"),
                "population_year": population.get("year"),
                "population_source": population.get("source"),
                "population_source_url": population.get("source_url"),
            },
            "geometry": shape_record.shape.__geo_interface__,
        }
        feature = clip_feature_to_prediction_tile(feature)

        if feature is None:
            continue

        barangays_by_municipality.setdefault(municipality_name.lower(), []).append(
            feature
        )

    return barangays_by_municipality


@app.get("/municipality-boundary/{municipality_name}/barangays")
def municipality_barangays(municipality_name: str):
    barangays_by_municipality = load_southern_leyte_barangay_boundaries()

    return {
        "type": "FeatureCollection",
        "features": barangays_by_municipality.get(municipality_name.lower(), []),
    }


@app.get("/barangay-boundaries")
def barangay_boundaries():
    barangays_by_municipality = load_southern_leyte_barangay_boundaries()

    return {
        "type": "FeatureCollection",
        "features": [
            feature
            for features in barangays_by_municipality.values()
            for feature in features
        ],
    }


@app.get("/municipality-boundary/{municipality_name}/barangay/{barangay_name}/risk-breakdown")
def barangay_risk_breakdown(municipality_name: str, barangay_name: str):
    barangays_by_municipality = load_southern_leyte_barangay_boundaries()
    normalized_barangay_name = _normalize_place_name(barangay_name)
    barangay = next(
        (
            feature
            for feature in barangays_by_municipality.get(municipality_name.lower(), [])
            if _normalize_place_name(feature["properties"].get("name"))
            == normalized_barangay_name
        ),
        None,
    )

    if barangay is None:
        raise HTTPException(status_code=404, detail="Barangay not found.")

    return {
        "municipality": municipality_name,
        "barangay": barangay["properties"].get("name"),
        "risk_breakdown": calculate_barangay_risk_breakdown(
            barangay.get("geometry")
        ),
    }


@app.get("/model-health")
def model_health():
    return {
        "model": MODEL_NAME,
        "checkpoint": MODEL_CHECKPOINT,
        "status": "loaded",
        "inference_check": run_sample_inference(),
    }


def _read_first_csv_row(path):
    if not path.exists():
        return None

    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return next(csv.DictReader(f), None)


def _read_csv_rows(path):
    if not path.exists():
        return []

    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def _to_float(value, fallback=0.0):
    try:
        if value in (None, ""):
            return fallback
        return float(value)
    except (TypeError, ValueError):
        return fallback


@lru_cache(maxsize=1)
def load_loss_exposure_data():
    summary = _read_first_csv_row(LOSS_EXPOSURE_SUMMARY_PATH) or {}
    barangay_rows = _read_csv_rows(BARANGAY_POPULATION_PATH)
    asset_rows = _read_csv_rows(ASSET_VALUES_PATH)
    vulnerability_rows = _read_csv_rows(VULNERABILITY_RATES_PATH)

    population_total = _to_float(
        summary.get("population_total"),
        sum(_to_float(row.get("population")) for row in barangay_rows),
    )
    total_asset_value = _to_float(
        summary.get("estimated_total_asset_value_php"),
        sum(_to_float(row.get("estimated_total_value_php")) for row in asset_rows),
    )
    province_area_sq_km = _to_float(
        summary.get("province_area_sq_km"),
        FALLBACK_LOSS_ASSUMPTIONS["province_area_sq_km"],
    )

    vulnerability_by_level = {
        row.get("risk_level"): {
            "damage_ratio": _to_float(row.get("damage_ratio")),
            "casualty_rate": _to_float(row.get("casualty_rate")),
            "source": row.get("source") or "vulnerability_rates.csv",
        }
        for row in vulnerability_rows
        if row.get("risk_level")
    }

    return {
        "province_area_sq_km": province_area_sq_km
        or FALLBACK_LOSS_ASSUMPTIONS["province_area_sq_km"],
        "population_total": population_total
        or FALLBACK_LOSS_ASSUMPTIONS["population_total"],
        "estimated_total_asset_value_php": total_asset_value
        or FALLBACK_LOSS_ASSUMPTIONS["estimated_total_asset_value_php"],
        "population_rows": len(barangay_rows),
        "asset_rows": asset_rows,
        "vulnerability_by_level": vulnerability_by_level,
        "summary_path": str(LOSS_EXPOSURE_SUMMARY_PATH),
        "population_path": str(BARANGAY_POPULATION_PATH),
        "asset_values_path": str(ASSET_VALUES_PATH),
        "vulnerability_rates_path": str(VULNERABILITY_RATES_PATH),
        "loaded_from_files": all(
            [
                BARANGAY_POPULATION_PATH.exists(),
                ASSET_VALUES_PATH.exists(),
                VULNERABILITY_RATES_PATH.exists(),
                LOSS_EXPOSURE_SUMMARY_PATH.exists(),
            ]
        ),
    }


def vulnerability_for_risk_level(risk_level, probability):
    exposure_data = load_loss_exposure_data()
    normalized_level = {
        "Low": "30%",
        "Medium": "50%",
        "High": "75%",
    }.get(risk_level, risk_level)

    if normalized_level in exposure_data["vulnerability_by_level"]:
        return normalized_level, exposure_data["vulnerability_by_level"][normalized_level]

    probability_value = max(min(float(probability or 0), 1.0), 0.0)
    fallback_level = (
        "100%"
        if probability_value >= 0.75
        else "75%"
        if probability_value >= 0.50
        else "50%"
        if probability_value >= 0.30
        else "30%"
        if probability_value >= 0.15
        else "15%"
    )

    return fallback_level, exposure_data["vulnerability_by_level"].get(
        fallback_level,
        {
            "damage_ratio": FALLBACK_LOSS_ASSUMPTIONS["damage_ratio"],
            "casualty_rate": FALLBACK_LOSS_ASSUMPTIONS["casualty_rate"],
            "source": "fallback backend assumptions",
        },
    )


@app.get("/loss-exposure-summary")
def loss_exposure_summary():
    return load_loss_exposure_data()


def baseline_hazard_overlay_png():
    if not BASELINE_HAZARD_MASK_PATH.exists():
        raise FileNotFoundError(BASELINE_HAZARD_MASK_PATH)

    with h5py.File(BASELINE_HAZARD_MASK_PATH, "r") as f:
        mask = f["mask"][:].astype("float32")

    classes = np.zeros(mask.shape, dtype=np.uint8)
    class_specs = [
        (1, mask <= 0.151),
        (2, (mask > 0.151) & (mask < 0.49)),
        (3, (mask >= 0.49) & (mask < 0.74)),
        (4, (mask >= 0.74) & (mask < 0.99)),
        (5, mask >= 0.99),
    ]

    for class_value, selector in class_specs:
        classes[selector] = class_value

    classes = np.asarray(
        Image.fromarray(classes, mode="L").filter(ImageFilter.ModeFilter(size=3))
    ).copy()
    classes[classes == 0] = 1

    rgba = np.zeros((*classes.shape, 4), dtype=np.uint8)
    fill_colors = {
        1: (74, 222, 128, 142),
        2: (163, 230, 53, 154),
        3: (253, 224, 71, 168),
        4: (251, 146, 60, 178),
        5: (239, 68, 68, 188),
    }

    for class_value, color in fill_colors.items():
        rgba[classes == class_value] = color

    class_edges = np.zeros(classes.shape, dtype=bool)
    class_edges[:-1, :] |= classes[:-1, :] != classes[1:, :]
    class_edges[1:, :] |= classes[:-1, :] != classes[1:, :]
    class_edges[:, :-1] |= classes[:, :-1] != classes[:, 1:]
    class_edges[:, 1:] |= classes[:, :-1] != classes[:, 1:]

    edge_colors = {
        1: (47, 125, 50, 220),
        2: (95, 138, 24, 220),
        3: (180, 116, 16, 230),
        4: (176, 78, 12, 230),
        5: (127, 29, 29, 235),
    }
    for class_value, color in edge_colors.items():
        rgba[class_edges & (classes == class_value)] = color

    image_size = 1024
    image = Image.fromarray(rgba, mode="RGBA")
    image = image.resize((image_size, image_size), Image.Resampling.NEAREST)
    rgba = np.asarray(image).copy()

    boundary_mask = Image.new("L", (image_size, image_size), 0)
    draw = ImageDraw.Draw(boundary_mask)
    province = load_southern_leyte_province_boundary()

    def to_pixel(coordinate):
        lon, lat = coordinate[:2]
        x = (
            (lon - BASELINE_HAZARD_OVERLAY_BOUNDS["min_lon"])
            / (
                BASELINE_HAZARD_OVERLAY_BOUNDS["max_lon"]
                - BASELINE_HAZARD_OVERLAY_BOUNDS["min_lon"]
            )
            * (image_size - 1)
        )
        y = (
            (BASELINE_HAZARD_OVERLAY_BOUNDS["max_lat"] - lat)
            / (
                BASELINE_HAZARD_OVERLAY_BOUNDS["max_lat"]
                - BASELINE_HAZARD_OVERLAY_BOUNDS["min_lat"]
            )
            * (image_size - 1)
        )
        return (x, y)

    def draw_polygon_rings(rings):
        if not rings:
            return

        draw.polygon([to_pixel(point) for point in rings[0]], fill=255)
        for hole in rings[1:]:
            draw.polygon([to_pixel(point) for point in hole], fill=0)

    geometry = province.get("geometry") if province else None
    if geometry:
        if geometry.get("type") == "Polygon":
            draw_polygon_rings(geometry.get("coordinates", []))
        elif geometry.get("type") == "MultiPolygon":
            for polygon in geometry.get("coordinates", []):
                draw_polygon_rings(polygon)

    rgba[:, :, 3] = (
        rgba[:, :, 3].astype("float32")
        * (np.asarray(boundary_mask).astype("float32") / 255.0)
    ).astype("uint8")

    image = Image.fromarray(rgba, mode="RGBA")

    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


@app.get("/baseline-risk-overlay.png")
def baseline_risk_overlay():
    try:
        image_bytes = baseline_hazard_overlay_png()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Baseline hazard mask not found.")

    return Response(
        content=image_bytes,
        media_type="image/png",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


def estimate_loss(probability, risk_level, area_sq_km):
    exposure_data = load_loss_exposure_data()
    vulnerability_level, vulnerability = vulnerability_for_risk_level(
        risk_level,
        probability,
    )
    province_area_sq_km = max(exposure_data["province_area_sq_km"], 1)
    area_fraction = max(min(float(area_sq_km or 0) / province_area_sq_km, 1.0), 0.0)
    exposed_population = exposure_data["population_total"] * area_fraction
    exposed_asset_value = (
        exposure_data["estimated_total_asset_value_php"] * area_fraction
    )
    damage_ratio = max(min(vulnerability["damage_ratio"], 1.0), 0.0)
    casualty_rate = max(vulnerability["casualty_rate"], 0.0)
    economic_loss = exposed_asset_value * damage_ratio
    possible_casualties = exposed_population * casualty_rate

    if damage_ratio >= 0.45 or casualty_rate >= 0.0075:
        recommendation = "Evacuate exposed households, close unsafe roads, and pre-position rescue and medical teams."
    elif damage_ratio >= 0.25 or casualty_rate >= 0.003:
        recommendation = "Prepare evacuation centers, inspect slopes and drainage, and issue barangay-level warnings."
    elif damage_ratio >= 0.10 or casualty_rate >= 0.001:
        recommendation = "Increase monitoring, clear drainage, and advise residents to avoid steep or saturated slopes."
    else:
        recommendation = "Maintain routine monitoring and keep residents informed through local advisories."

    return {
        "estimated_area_sq_km": round(area_sq_km, 3),
        "estimated_affected_people": round(exposed_population),
        "estimated_economic_loss_php": round(economic_loss),
        "estimated_possible_casualties": round(possible_casualties, 1),
        "exposure_area_fraction": round(area_fraction, 6),
        "exposed_asset_value_php": round(exposed_asset_value),
        "damage_ratio": damage_ratio,
        "casualty_rate": casualty_rate,
        "vulnerability_level": vulnerability_level,
        "recommendation": recommendation,
        "basis": "Planning estimate using generated barangay population, OSM asset exposure, vulnerability rates, and mapped risk area. Validate with LGU field reports before operational decisions.",
        "data_sources": {
            "population": str(BARANGAY_POPULATION_PATH),
            "asset_values": str(ASSET_VALUES_PATH),
            "vulnerability_rates": str(VULNERABILITY_RATES_PATH),
            "summary": str(LOSS_EXPOSURE_SUMMARY_PATH),
        },
    }


def clip_geometry_to_southern_leyte(geometry):
    province = load_southern_leyte_province_boundary()

    if (
        not geometry
        or province is None
        or shapely_shape is None
        or mapping is None
        or shapely_make_valid is None
    ):
        return geometry

    try:
        clipped = shapely_make_valid(
            shapely_shape(geometry).intersection(
                shapely_shape(province["geometry"])
            )
        )
    except Exception:
        return geometry

    if clipped.is_empty:
        return None

    return mapping(clipped)


def risk_label_for_level(risk_level):
    return {
        "15%": "Low",
        "30%": "Slightly Low",
        "50%": "Moderate",
        "75%": "High",
        "100%": "Very High",
        "Low": "Low",
        "Medium": "Moderate",
        "High": "High",
    }.get(risk_level, risk_level)


def alert_severity(risk_level, probability):
    label = risk_label_for_level(risk_level)
    probability_value = float(probability or 0)

    if label == "Very High" or probability_value >= 0.85:
        return "Critical"

    if label == "High" or probability_value >= 0.7:
        return "High"

    if label == "Moderate" or probability_value >= 0.45:
        return "Monitoring"

    return "Watch"


def alert_priority(probability, loss_estimate):
    probability_value = float(probability or 0)
    affected_people = loss_estimate.get("estimated_affected_people", 0)
    exposure_score = min(float(affected_people or 0) / 150000, 1)
    return round((probability_value * 0.72 + exposure_score * 0.28) * 100)


def automatic_alert_status(severity, priority):
    if severity in {"Critical", "High"} or priority >= 70:
        return "Immediate Response"

    if severity == "Monitoring" or priority >= 45:
        return "Monitoring"

    return "Watch"


def alert_source_metadata(name):
    alert_name = str(name or "")

    if alert_name.startswith("Live Rainfall Prediction"):
        return {
            "data_source": "Model + live rainfall",
            "model_name": MODEL_NAME,
            "source_detail": "Attention U-Net prediction adjusted with live rainfall forecast data.",
        }

    if alert_name.startswith("Rainfall Simulation"):
        return {
            "data_source": "Model + rainfall scenario",
            "model_name": MODEL_NAME,
            "source_detail": "Attention U-Net prediction adjusted with the selected rainfall scenario.",
        }

    if alert_name.startswith("Baseline Hazard"):
        return {
            "data_source": "Baseline hazard layer",
            "model_name": "Curated 5-level baseline hazard",
            "source_detail": "Curated 5-level Southern Leyte hazard mask.",
        }

    return {
        "data_source": "Model prediction",
        "model_name": MODEL_NAME,
        "source_detail": f"{MODEL_NAME} using the latest saved prediction layer.",
    }


def ensure_alerts_table():
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS alerts (
                    id SERIAL PRIMARY KEY,
                    risk_zone_id INTEGER UNIQUE,
                    name TEXT NOT NULL,
                    risk_level TEXT NOT NULL,
                    risk_label TEXT NOT NULL,
                    probability DOUBLE PRECISION NOT NULL DEFAULT 0,
                    severity TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'Watch',
                    loss_estimate JSONB NOT NULL DEFAULT '{}'::jsonb,
                    location_summary TEXT,
                    municipalities JSONB NOT NULL DEFAULT '[]'::jsonb,
                    barangays JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    classification_basis TEXT,
                    resolved_at TIMESTAMPTZ NULL
                );
                """
            )
        )
        conn.execute(text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS location_summary TEXT;"))
        conn.execute(
            text(
                "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS municipalities JSONB NOT NULL DEFAULT '[]'::jsonb;"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS barangays JSONB NOT NULL DEFAULT '[]'::jsonb;"
            )
        )
        conn.execute(text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS classification_basis TEXT;"))


def risk_zones_table_exists():
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text("SELECT to_regclass('public.risk_zones') IS NOT NULL;")
            ).scalar()
        )


def summarize_alert_locations(risk_geometry, loss_estimate):
    if shapely_shape is None or shapely_make_valid is None or not risk_geometry:
        return {
            "location_summary": "Southern Leyte risk zone",
            "municipalities": [],
            "barangays": [],
        }

    try:
        risk_shape = shapely_make_valid(shapely_shape(risk_geometry))
    except Exception:
        return {
            "location_summary": "Southern Leyte risk zone",
            "municipalities": [],
            "barangays": [],
        }

    if risk_shape.is_empty:
        return {
            "location_summary": "Southern Leyte risk zone",
            "municipalities": [],
            "barangays": [],
        }

    impacted_barangays = []
    total_overlap_area = 0.0

    for barangay_features in load_southern_leyte_barangay_boundaries().values():
        for feature in barangay_features:
            geometry = feature.get("geometry")
            properties = feature.get("properties", {})

            if not geometry:
                continue

            try:
                barangay_shape = shapely_make_valid(shapely_shape(geometry))
                if not risk_shape.intersects(barangay_shape):
                    continue

                overlap = risk_shape.intersection(barangay_shape)
            except Exception:
                continue

            if overlap.is_empty:
                continue

            overlap_area = float(overlap.area or 0)
            barangay_area = float(barangay_shape.area or 0)

            if overlap_area <= 0 or barangay_area <= 0:
                continue

            coverage_percent = min(overlap_area / barangay_area * 100.0, 100.0)
            if coverage_percent < 0.1:
                continue

            total_overlap_area += overlap_area
            impacted_barangays.append(
                {
                    "municipality": properties.get("municipality"),
                    "barangay": properties.get("name"),
                    "coverage_percent": round(coverage_percent, 1),
                    "population": properties.get("population"),
                    "_overlap_area": overlap_area,
                }
            )

    impacted_barangays.sort(
        key=lambda item: (item["_overlap_area"], item.get("coverage_percent", 0)),
        reverse=True,
    )

    total_affected_people = float(loss_estimate.get("estimated_affected_people") or 0)
    total_economic_loss = float(loss_estimate.get("estimated_economic_loss_php") or 0)
    total_possible_casualties = float(
        loss_estimate.get("estimated_possible_casualties") or 0
    )

    for item in impacted_barangays:
        fraction = item["_overlap_area"] / total_overlap_area if total_overlap_area else 0
        item["estimated_affected_people"] = round(total_affected_people * fraction)
        item["estimated_economic_loss_php"] = round(total_economic_loss * fraction)
        item["estimated_possible_casualties"] = round(
            total_possible_casualties * fraction,
            1,
        )
        del item["_overlap_area"]

    municipality_counts = {}
    for item in impacted_barangays:
        municipality = item.get("municipality")
        if not municipality:
            continue
        municipality_counts[municipality] = municipality_counts.get(municipality, 0) + 1

    municipalities = [
        {"name": name, "barangay_count": count}
        for name, count in sorted(
            municipality_counts.items(),
            key=lambda entry: entry[1],
            reverse=True,
        )
    ]

    top_barangays = impacted_barangays[:10]
    if municipalities:
        location_summary = ", ".join(item["name"] for item in municipalities[:3])
        if len(municipalities) > 3:
            location_summary = f"{location_summary} + {len(municipalities) - 3} more"
    else:
        location_summary = "Southern Leyte risk zone"

    return {
        "location_summary": location_summary,
        "municipalities": municipalities,
        "barangays": top_barangays,
    }


def sync_alerts_from_risk_zones():
    ensure_alerts_table()

    if not risk_zones_table_exists():
        return

    query = text(
        """
        SELECT
            id,
            name,
            risk_level,
            probability,
            ST_Area(geom::geography) / 1000000.0 AS area_sq_km
            ,
            ST_AsGeoJSON(geom)::json AS geometry
        FROM risk_zones;
        """
    )

    upsert_query = text(
        """
        INSERT INTO alerts (
            risk_zone_id,
            name,
            risk_level,
            risk_label,
            probability,
            severity,
            priority,
            loss_estimate,
            location_summary,
            municipalities,
            barangays,
            status,
            classification_basis,
            updated_at
        )
        VALUES (
            :risk_zone_id,
            :name,
            :risk_level,
            :risk_label,
            :probability,
            :severity,
            :priority,
            CAST(:loss_estimate AS JSONB),
            :location_summary,
            CAST(:municipalities AS JSONB),
            CAST(:barangays AS JSONB),
            :status,
            :classification_basis,
            NOW()
        )
        ON CONFLICT (risk_zone_id) DO UPDATE SET
            name = EXCLUDED.name,
            risk_level = EXCLUDED.risk_level,
            risk_label = EXCLUDED.risk_label,
            probability = EXCLUDED.probability,
            severity = EXCLUDED.severity,
            priority = EXCLUDED.priority,
            loss_estimate = EXCLUDED.loss_estimate,
            location_summary = EXCLUDED.location_summary,
            municipalities = EXCLUDED.municipalities,
            barangays = EXCLUDED.barangays,
            status = EXCLUDED.status,
            classification_basis = EXCLUDED.classification_basis,
            resolved_at = NULL,
            updated_at = NOW();
        """
    )

    with engine.begin() as conn:
        rows = conn.execute(query).mappings().all()
        risk_zone_ids = [row["id"] for row in rows]

        if risk_zone_ids:
            conn.execute(
                text(
                    """
                    DELETE FROM alerts
                    WHERE risk_zone_id IS NULL
                       OR risk_zone_id <> ALL(:risk_zone_ids);
                    """
                ),
                {"risk_zone_ids": risk_zone_ids},
            )
        else:
            conn.execute(text("DELETE FROM alerts;"))

        for row in rows:
            probability = float(row["probability"] or 0)
            risk_level = row["risk_level"]
            loss_estimate = estimate_loss(
                probability,
                risk_level,
                float(row["area_sq_km"] or 0),
            )
            geometry = row["geometry"] if isinstance(row["geometry"], dict) else json.loads(row["geometry"])
            locations = summarize_alert_locations(geometry, loss_estimate)
            severity = alert_severity(risk_level, probability)
            priority = alert_priority(probability, loss_estimate)
            status = automatic_alert_status(severity, priority)
            conn.execute(
                upsert_query,
                {
                    "risk_zone_id": row["id"],
                    "name": row["name"],
                    "risk_level": risk_level,
                    "risk_label": risk_label_for_level(risk_level),
                    "probability": probability,
                    "severity": severity,
                    "priority": priority,
                    "loss_estimate": json.dumps(loss_estimate),
                    "location_summary": locations["location_summary"],
                    "municipalities": json.dumps(locations["municipalities"]),
                    "barangays": json.dumps(locations["barangays"]),
                    "status": status,
                    "classification_basis": (
                        f"Automatically classified from severity {severity}, "
                        f"priority score {priority}, probability {round(probability * 100)}%, "
                        f"and estimated exposure."
                    ),
                },
            )


def serialize_alert(row):
    loss_estimate = row["loss_estimate"] or {}
    if isinstance(loss_estimate, str):
        loss_estimate = json.loads(loss_estimate)
    municipalities = row["municipalities"] or []
    barangays = row["barangays"] or []
    if isinstance(municipalities, str):
        municipalities = json.loads(municipalities)
    if isinstance(barangays, str):
        barangays = json.loads(barangays)

    return {
        "id": row["id"],
        "riskZoneId": row["risk_zone_id"],
        "name": row["name"],
        "riskLevel": row["risk_label"],
        "rawRiskLevel": row["risk_level"],
        "probability": float(row["probability"] or 0),
        "severity": row["severity"],
        "priority": row["priority"],
        "status": row["status"],
        "classificationBasis": row["classification_basis"],
        "loss": loss_estimate,
        "locationSummary": row["location_summary"],
        "municipalities": municipalities,
        "barangays": barangays,
        "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
        "resolvedAt": row["resolved_at"].isoformat() if row["resolved_at"] else None,
        "feedTimestamp": row["updated_at"].isoformat() if row["updated_at"] else None,
        **alert_source_metadata(row["name"]),
    }


@app.get("/alerts")
def alerts(limit: int = 100):
    sync_alerts_from_risk_zones()

    query = text(
        """
        SELECT *
        FROM alerts
        ORDER BY
            CASE status
                WHEN 'Immediate Response' THEN 1
                WHEN 'Monitoring' THEN 2
                WHEN 'Watch' THEN 3
                ELSE 4
            END,
            priority DESC,
            updated_at DESC,
            id DESC
        LIMIT :limit;
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(query, {"limit": max(min(limit, 250), 1)}).mappings().all()

    return {"alerts": [serialize_alert(row) for row in rows]}


def ensure_generated_reports_table():
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS generated_reports (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    municipality TEXT NOT NULL,
                    report_type TEXT NOT NULL,
                    format TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'Generated',
                    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
                    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
        )


def report_alerts_for_municipality(municipality):
    all_alerts = alerts(limit=250)["alerts"]
    normalized_municipality = _normalize_place_name(municipality)

    if normalized_municipality in {"", "southern leyte", "all municipalities"}:
        return all_alerts

    return [
        alert
        for alert in all_alerts
        if any(
            _normalize_place_name(item.get("name")) == normalized_municipality
            for item in alert.get("municipalities", [])
        )
    ]


def build_generated_report_payload(request: GenerateReportRequest):
    selected_alerts = report_alerts_for_municipality(request.municipality)
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    normalized_report_type = request.report_type.strip().lower()

    summary = {
        "risk_zones": len(selected_alerts),
        "high_risk_zones": sum(
            1
            for alert in selected_alerts
            if alert.get("rawRiskLevel") in {"75%", "100%", "High"}
            or alert.get("severity") in {"High", "Critical"}
        ),
        "affected_people": round(
            sum(alert.get("loss", {}).get("estimated_affected_people", 0) for alert in selected_alerts)
        ),
        "economic_loss_php": round(
            sum(alert.get("loss", {}).get("estimated_economic_loss_php", 0) for alert in selected_alerts)
        ),
        "possible_casualties": round(
            sum(alert.get("loss", {}).get("estimated_possible_casualties", 0) for alert in selected_alerts),
            1,
        ),
        "highest_probability": max(
            [alert.get("probability", 0) for alert in selected_alerts] or [0]
        ),
    }

    distribution = {}
    top_barangays = {}
    for alert in selected_alerts:
        label = alert.get("riskLevel") or alert.get("severity") or "Unknown"
        distribution[label] = distribution.get(label, 0) + 1

        for barangay in alert.get("barangays", []):
            if (
                _normalize_place_name(request.municipality)
                not in {"", "southern leyte", "all municipalities"}
                and _normalize_place_name(barangay.get("municipality"))
                != _normalize_place_name(request.municipality)
            ):
                continue

            key = (
                barangay.get("municipality") or "",
                barangay.get("barangay") or "",
            )
            current = top_barangays.setdefault(
                key,
                {
                    "municipality": barangay.get("municipality"),
                    "barangay": barangay.get("barangay"),
                    "estimated_affected_people": 0,
                    "estimated_economic_loss_php": 0,
                    "estimated_possible_casualties": 0,
                    "max_coverage_percent": 0,
                },
            )
            current["estimated_affected_people"] += barangay.get(
                "estimated_affected_people",
                0,
            )
            current["estimated_economic_loss_php"] += barangay.get(
                "estimated_economic_loss_php",
                0,
            )
            current["estimated_possible_casualties"] += barangay.get(
                "estimated_possible_casualties",
                0,
            )
            current["max_coverage_percent"] = max(
                current["max_coverage_percent"],
                barangay.get("coverage_percent", 0),
            )

    top_barangay_rows = sorted(
        top_barangays.values(),
        key=lambda item: item["estimated_affected_people"],
        reverse=True,
    )[:12]

    if normalized_report_type == "loss estimate":
        focus_title = "Loss Estimate Register"
        focus_columns = [
            "Alert",
            "Location",
            "Risk",
            "Affected People",
            "Economic Loss",
            "Possible Casualties",
        ]
        focus_rows = [
            {
                "Alert": alert.get("name"),
                "Location": alert.get("locationSummary"),
                "Risk": alert.get("riskLevel"),
                "Affected People": alert.get("loss", {}).get("estimated_affected_people", 0),
                "Economic Loss": alert.get("loss", {}).get("estimated_economic_loss_php", 0),
                "Possible Casualties": alert.get("loss", {}).get("estimated_possible_casualties", 0),
            }
            for alert in selected_alerts
        ]
        recommendation = (
            "Use this loss register to prioritize resource allocation, evacuation logistics, and damage assessment planning."
        )
    elif normalized_report_type == "rainfall simulation":
        logs = rainfall_simulation_logs(limit=12).get("logs", [])
        focus_title = "Rainfall Simulation Log"
        focus_columns = [
            "Timestamp",
            "Rainfall Rate",
            "Duration",
            "Saturation",
            "Risk Level",
            "Hotspot",
        ]
        focus_rows = [
            {
                "Timestamp": log.get("timestamp") or log.get("created_at"),
                "Rainfall Rate": log.get("rainfall_rate"),
                "Duration": log.get("duration_hours"),
                "Saturation": log.get("saturation_factor"),
                "Risk Level": log.get("risk_level"),
                "Hotspot": log.get("hotspot"),
            }
            for log in logs
        ]
        recommendation = (
            "Compare simulated rainfall runs with current alerts and inspect hotspots where rainfall pressure increases mapped risk."
        )
    elif normalized_report_type == "barangay exposure":
        exposure_rows = top_barangay_rows
        if not exposure_rows:
            exposure_rows = [
                {
                    "barangay": "No high-overlap barangay rows",
                    "municipality": request.municipality,
                    "max_coverage_percent": 0,
                    "estimated_affected_people": summary["affected_people"],
                    "estimated_economic_loss_php": summary["economic_loss_php"],
                    "estimated_possible_casualties": summary["possible_casualties"],
                }
            ]
        focus_title = "Barangay Exposure Register"
        focus_columns = [
            "Barangay",
            "Municipality",
            "Coverage",
            "Affected People",
            "Economic Loss",
            "Possible Casualties",
        ]
        focus_rows = [
            {
                "Barangay": row.get("barangay"),
                "Municipality": row.get("municipality"),
                "Coverage": row.get("max_coverage_percent"),
                "Affected People": row.get("estimated_affected_people"),
                "Economic Loss": row.get("estimated_economic_loss_php"),
                "Possible Casualties": row.get("estimated_possible_casualties"),
            }
            for row in exposure_rows
        ]
        recommendation = (
            "Coordinate first with barangays showing the highest exposure, then validate household-level impacts with local officials."
        )
    else:
        focus_title = "Risk Distribution"
        focus_columns = ["Risk Level", "Zones"]
        focus_rows = [
            {"Risk Level": label, "Zones": count}
            for label, count in sorted(distribution.items())
        ]
        recommendation = (
            "Prioritize Immediate Response and High risk zones, validate exposed barangays with LGU field teams, and prepare advisories where needed."
        )

    return {
        "name": f"{request.municipality} {request.report_type}",
        "municipality": request.municipality,
        "report_type": request.report_type,
        "format": request.format,
        "generated_at": generated_at,
        "summary": summary,
        "risk_distribution": [
            {"label": label, "count": count}
            for label, count in sorted(distribution.items())
        ],
        "focus_title": focus_title,
        "focus_columns": focus_columns,
        "focus_rows": focus_rows,
        "alerts": selected_alerts,
        "top_barangays": top_barangay_rows,
        "recommendation": recommendation,
        "data_sources": {
            "risk_zones": "PostGIS risk_zones table",
            "alerts": "Database-backed generated alerts",
            "loss_estimates": "Barangay population, OSM asset exposure, vulnerability rates, and mapped risk area",
        },
    }


def serialize_generated_report(row):
    summary = row["summary"] or {}
    payload = row["payload"] or {}

    if isinstance(summary, str):
        summary = json.loads(summary)
    if isinstance(payload, str):
        payload = json.loads(payload)

    return {
        "id": row["id"],
        "name": row["name"],
        "municipality": row["municipality"],
        "reportType": row["report_type"],
        "format": row["format"],
        "status": row["status"],
        "summary": summary,
        "payload": payload,
        "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
    }


@app.post("/reports")
def generate_report(request: GenerateReportRequest):
    ensure_generated_reports_table()
    payload = build_generated_report_payload(request)

    query = text(
        """
        INSERT INTO generated_reports (
            name,
            municipality,
            report_type,
            format,
            status,
            summary,
            payload
        )
        VALUES (
            :name,
            :municipality,
            :report_type,
            :format,
            'Generated',
            CAST(:summary AS JSONB),
            CAST(:payload AS JSONB)
        )
        RETURNING *;
        """
    )

    with engine.begin() as conn:
        row = conn.execute(
            query,
            {
                "name": payload["name"],
                "municipality": request.municipality,
                "report_type": request.report_type,
                "format": request.format,
                "summary": json.dumps(payload["summary"]),
                "payload": json.dumps(payload),
            },
        ).mappings().one()

    return {"report": serialize_generated_report(row)}


@app.get("/reports")
def generated_reports(limit: int = 25):
    ensure_generated_reports_table()

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT *
                FROM generated_reports
                ORDER BY created_at DESC, id DESC
                LIMIT :limit;
                """
            ),
            {"limit": max(min(limit, 100), 1)},
        ).mappings().all()

    return {"reports": [serialize_generated_report(row) for row in rows]}


@app.get("/reports/{report_id}")
def generated_report(report_id: int):
    ensure_generated_reports_table()

    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT * FROM generated_reports WHERE id = :report_id;"),
            {"report_id": report_id},
        ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Report not found.")

    return {"report": serialize_generated_report(row)}


@app.get("/risk-zones")
def risk_zones():
    query = text(
        """
        SELECT
            id,
            name,
            risk_level,
            probability,
            ST_Area(geom::geography) / 1000000.0 AS area_sq_km,
            ST_AsGeoJSON(geom)::json AS geometry
        FROM risk_zones
        ORDER BY
            CASE risk_level
                WHEN 'Low' THEN 1
                WHEN 'Medium' THEN 2
                WHEN 'High' THEN 3
                WHEN '15%' THEN 1
                WHEN '30%' THEN 2
                WHEN '50%' THEN 3
                WHEN '75%' THEN 4
                WHEN '100%' THEN 5
                ELSE 4
            END,
            id;
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(query).mappings().all()

    features = []

    for row in rows:
        geometry = row["geometry"] if isinstance(row["geometry"], dict) else json.loads(row["geometry"])
        clipped_geometry = clip_geometry_to_southern_leyte(geometry)

        if clipped_geometry is None:
            continue

        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": row["id"],
                    "name": row["name"],
                    "risk_level": row["risk_level"],
                    "probability": row["probability"],
                    "loss_estimate": estimate_loss(
                        row["probability"],
                        row["risk_level"],
                        float(row["area_sq_km"] or 0),
                    ),
                },
                "geometry": clipped_geometry,
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
    }


@app.delete("/risk-zones")
def clear_risk_zones():
    with engine.begin() as conn:
        deleted_count = conn.execute(text("DELETE FROM risk_zones;")).rowcount

    return {
        "message": "Risk layers cleared",
        "deleted": deleted_count,
    }


def replace_risk_zones(predictions):
    query = text(
        """
        INSERT INTO risk_zones (name, risk_level, probability, geom)
        VALUES (
            :name,
            :risk_level,
            :probability,
            ST_GeomFromText(:wkt, 4326)
        )
        ON CONFLICT (name) DO UPDATE SET
            risk_level = EXCLUDED.risk_level,
            probability = EXCLUDED.probability,
            geom = EXCLUDED.geom
        RETURNING id, name, risk_level, probability;
        """
    )

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM risk_zones;"))
        rows = [
            conn.execute(query, prediction).mappings().one()
            for prediction in predictions
        ]

    calculate_barangay_risk_breakdown_from_json.cache_clear()
    return rows


def predictions_to_feature_collection(predictions):
    query = text(
        """
        SELECT
            ST_Area(ST_GeomFromText(:wkt, 4326)::geography) / 1000000.0 AS area_sq_km,
            ST_AsGeoJSON(ST_GeomFromText(:wkt, 4326), 6)::json AS geometry;
        """
    )

    features = []

    with engine.connect() as conn:
        for index, prediction in enumerate(predictions, start=1):
            row = conn.execute(query, prediction).mappings().one()
            geometry = row["geometry"] if isinstance(row["geometry"], dict) else json.loads(row["geometry"])
            clipped_geometry = clip_geometry_to_southern_leyte(geometry)

            if clipped_geometry is None:
                continue

            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "id": f"simulation-preview-{index}",
                        "name": prediction["name"],
                        "risk_level": prediction["risk_level"],
                        "probability": prediction["probability"],
                        "loss_estimate": estimate_loss(
                            prediction["probability"],
                            prediction["risk_level"],
                            float(row["area_sq_km"] or 0),
                        ),
                    },
                    "geometry": clipped_geometry,
                }
            )

    return {
        "type": "FeatureCollection",
        "features": features,
    }


@app.post("/restore-baseline-risk")
def restore_baseline_risk():
    baseline_result = run_baseline_hazard_predictions()
    rows = replace_risk_zones(baseline_result["predictions"])

    return {
        "message": "Baseline 5-level hazard layer restored",
        "model": baseline_result["model"],
        "checkpoint": baseline_result["checkpoint"],
        "inference_check": baseline_result["inference_check"],
        "predictions": [dict(row) for row in rows],
    }


@app.post("/predict")
def predict():
    prediction_result = run_landslide_predictions()
    rows = replace_risk_zones(prediction_result["predictions"])

    return {
        "message": "Model risk-band predictions saved",
        "model": prediction_result["model"],
        "checkpoint": prediction_result["checkpoint"],
        "inference_check": prediction_result["inference_check"],
        "predictions": [dict(row) for row in rows],
    }


@app.post("/predict-live")
def predict_live():
    prediction_result = run_live_rainfall_prediction()
    rows = replace_risk_zones(prediction_result["predictions"])

    return {
        "message": "Live rainfall prediction saved",
        "model": prediction_result["model"],
        "checkpoint": prediction_result["checkpoint"],
        "scenario": prediction_result["scenario"],
        "inference_check": prediction_result["inference_check"],
        "predictions": [dict(row) for row in rows],
    }


@app.post("/simulate-rainfall")
def simulate_rainfall(request: RainfallSimulationRequest):
    simulation_result = run_rainfall_simulation(
        rainfall_mm_per_hr=request.rainfall_mm_per_hr,
        duration_hours=request.duration_hours,
        saturation_factor=request.saturation_factor,
    )
    rows = replace_risk_zones(simulation_result["predictions"])

    return {
        "message": "Rainfall simulation saved",
        "model": simulation_result["model"],
        "checkpoint": simulation_result["checkpoint"],
        "scenario": simulation_result["scenario"],
        "inference_check": simulation_result["inference_check"],
        "predictions": [dict(row) for row in rows],
    }


@app.post("/simulate-rainfall-preview")
def simulate_rainfall_preview(request: RainfallSimulationRequest):
    simulation_result = run_rainfall_simulation(
        rainfall_mm_per_hr=request.rainfall_mm_per_hr,
        duration_hours=request.duration_hours,
        saturation_factor=request.saturation_factor,
    )

    return {
        "message": "Rainfall simulation preview generated",
        "model": simulation_result["model"],
        "checkpoint": simulation_result["checkpoint"],
        "scenario": simulation_result["scenario"],
        "inference_check": simulation_result["inference_check"],
        "risk_zones": predictions_to_feature_collection(
            simulation_result["predictions"]
        ),
    }


def ensure_rainfall_simulation_logs_table():
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS rainfall_simulation_logs (
                    id SERIAL PRIMARY KEY,
                    timestamp TEXT,
                    started_at TEXT,
                    ended_by TEXT,
                    rainfall_rate DOUBLE PRECISION NOT NULL,
                    duration_hours DOUBLE PRECISION NOT NULL,
                    saturation_factor DOUBLE PRECISION NOT NULL,
                    step_percent DOUBLE PRECISION NOT NULL,
                    affected_people DOUBLE PRECISION DEFAULT 0,
                    possible_casualties DOUBLE PRECISION DEFAULT 0,
                    economic_loss DOUBLE PRECISION DEFAULT 0,
                    mapped_area DOUBLE PRECISION DEFAULT 0,
                    hotspot TEXT,
                    risk_level TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                """
            )
        )


@app.post("/rainfall-simulation-logs")
def create_rainfall_simulation_log(request: RainfallSimulationLogRequest):
    ensure_rainfall_simulation_logs_table()

    query = text(
        """
        INSERT INTO rainfall_simulation_logs (
            timestamp,
            started_at,
            ended_by,
            rainfall_rate,
            duration_hours,
            saturation_factor,
            step_percent,
            affected_people,
            possible_casualties,
            economic_loss,
            mapped_area,
            hotspot,
            risk_level
        )
        VALUES (
            :timestamp,
            :started_at,
            :ended_by,
            :rainfall_rate,
            :duration_hours,
            :saturation_factor,
            :step_percent,
            :affected_people,
            :possible_casualties,
            :economic_loss,
            :mapped_area,
            :hotspot,
            :risk_level
        )
        RETURNING *;
        """
    )

    with engine.begin() as conn:
        row = conn.execute(query, request.dict()).mappings().one()

    return dict(row)


@app.get("/rainfall-simulation-logs")
def rainfall_simulation_logs(limit: int = 25):
    ensure_rainfall_simulation_logs_table()

    query = text(
        """
        SELECT *
        FROM rainfall_simulation_logs
        ORDER BY created_at DESC, id DESC
        LIMIT :limit;
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(query, {"limit": max(min(limit, 100), 1)}).mappings().all()

    return {"logs": [dict(row) for row in rows]}
