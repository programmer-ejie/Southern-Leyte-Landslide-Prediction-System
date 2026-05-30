import os
import json
import sys
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text

try:
    import shapefile
except ImportError:  # pragma: no cover - depends on runtime environment
    shapefile = None

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

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

from model.inference import (
    run_landslide_predictions,
    run_live_rainfall_prediction,
    run_rainfall_simulation,
    run_sample_inference,
)

load_dotenv(Path(__file__).with_name(".env"))

app = FastAPI(title="Landslide Prediction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)


LOSS_ASSUMPTIONS = {
    "population_per_sq_km": 330,
    "asset_value_php_per_sq_km": 18_000_000,
    "casualty_rate": 0.015,
}


class RainfallSimulationRequest(BaseModel):
    rainfall_mm_per_hr: float = Field(ge=0, le=300)
    duration_hours: float = Field(ge=0, le=168)
    saturation_factor: float = Field(default=1.0, ge=0, le=2)


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
        boundaries[name.lower()] = {
            "type": "Feature",
            "properties": {
                "name": name,
                "province": record.get("NAME_1"),
                "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
            },
            "geometry": shape_record.shape.__geo_interface__,
        }

    return boundaries


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


@lru_cache(maxsize=1)
def load_southern_leyte_barangay_boundaries():
    if shapefile is None or not BARANGAY_BOUNDARY_PATH.exists():
        return {}

    reader = shapefile.Reader(str(BARANGAY_BOUNDARY_PATH))
    fields = [field[0] for field in reader.fields[1:]]
    barangays_by_municipality = {}

    for shape_record in reader.iterShapeRecords():
        record = dict(zip(fields, shape_record.record))

        if record.get("NAME_1") != "Southern Leyte":
            continue

        municipality_name = record.get("NAME_2")
        barangay_name = record.get("NAME_3")
        min_lon, min_lat, max_lon, max_lat = shape_record.shape.bbox
        feature = {
            "type": "Feature",
            "properties": {
                "name": barangay_name,
                "municipality": municipality_name,
                "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
            },
            "geometry": shape_record.shape.__geo_interface__,
        }

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


@app.get("/model-health")
def model_health():
    return {
        "model": "U-Net V3",
        "status": "loaded",
        "inference_check": run_sample_inference(),
    }


def estimate_loss(probability, risk_level, area_sq_km):
    severity_multiplier = {
        "15%": 0.15,
        "30%": 0.30,
        "50%": 0.50,
        "75%": 0.75,
        "100%": 1.00,
        "Low": 0.25,
        "Medium": 0.55,
        "High": 0.85,
    }.get(risk_level, max(min(float(probability), 1.0), 0.0))

    affected_population = area_sq_km * LOSS_ASSUMPTIONS["population_per_sq_km"]
    economic_loss = (
        area_sq_km
        * LOSS_ASSUMPTIONS["asset_value_php_per_sq_km"]
        * severity_multiplier
    )
    possible_casualties = (
        affected_population
        * severity_multiplier
        * LOSS_ASSUMPTIONS["casualty_rate"]
    )

    if severity_multiplier >= 0.75:
        recommendation = "Evacuate exposed households, close unsafe roads, and pre-position rescue and medical teams."
    elif severity_multiplier >= 0.50:
        recommendation = "Prepare evacuation centers, inspect slopes and drainage, and issue barangay-level warnings."
    elif severity_multiplier >= 0.30:
        recommendation = "Increase monitoring, clear drainage, and advise residents to avoid steep or saturated slopes."
    else:
        recommendation = "Maintain routine monitoring and keep residents informed through local advisories."

    return {
        "estimated_area_sq_km": round(area_sq_km, 3),
        "estimated_affected_people": round(affected_population),
        "estimated_economic_loss_php": round(economic_loss),
        "estimated_possible_casualties": round(possible_casualties, 1),
        "recommendation": recommendation,
        "basis": "Planning estimate using mapped area, risk probability, population density, and asset exposure assumptions.",
    }


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

    return {
        "type": "FeatureCollection",
        "features": [
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
                "geometry": row["geometry"]
                if isinstance(row["geometry"], dict)
                else json.loads(row["geometry"]),
            }
            for row in rows
        ],
    }


@app.post("/predict")
def predict():
    prediction_result = run_landslide_predictions()

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
    cleanup_query = text(
        """
        DELETE FROM risk_zones
        WHERE name IN (
            'U-Net Sample Prediction',
            'U-Net High Risk',
            'U-Net Medium Risk',
            'U-Net Low Risk',
            'Local Susceptibility High Risk',
            'Local Susceptibility Medium Risk',
            'Local Susceptibility Low Risk',
            'NOAH Fine-Tuned U-Net High Risk',
            'NOAH Fine-Tuned U-Net Medium Risk',
            'NOAH Fine-Tuned U-Net Low Risk',
            'NOAH Fine-Tuned U-Net 15% Risk',
            'NOAH Fine-Tuned U-Net 30% Risk',
            'NOAH Fine-Tuned U-Net 50% Risk',
            'NOAH Fine-Tuned U-Net 75% Risk',
            'NOAH Fine-Tuned U-Net 100% Risk'
        );
        """
    )

    with engine.begin() as conn:
        conn.execute(cleanup_query)
        rows = [
            conn.execute(query, prediction).mappings().one()
            for prediction in prediction_result["predictions"]
        ]

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
    cleanup_query = text(
        """
        DELETE FROM risk_zones
        WHERE name LIKE 'Live Rainfall Prediction % Risk';
        """
    )

    with engine.begin() as conn:
        conn.execute(cleanup_query)
        rows = [
            conn.execute(query, prediction).mappings().one()
            for prediction in prediction_result["predictions"]
        ]

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
    cleanup_query = text(
        """
        DELETE FROM risk_zones
        WHERE name LIKE 'Rainfall Simulation % Risk';
        """
    )

    with engine.begin() as conn:
        conn.execute(cleanup_query)
        rows = [
            conn.execute(query, prediction).mappings().one()
            for prediction in simulation_result["predictions"]
        ]

    return {
        "message": "Rainfall simulation saved",
        "model": simulation_result["model"],
        "checkpoint": simulation_result["checkpoint"],
        "scenario": simulation_result["scenario"],
        "inference_check": simulation_result["inference_check"],
        "predictions": [dict(row) for row in rows],
    }
