import os
import json
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

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


@app.get("/model-health")
def model_health():
    return {
        "model": "U-Net V3",
        "status": "loaded",
        "inference_check": run_sample_inference(),
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
