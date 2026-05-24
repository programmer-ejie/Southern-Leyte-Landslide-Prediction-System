from functools import lru_cache
import csv
from pathlib import Path

import torch

from model.postprocessing import (
    adaptive_mask_threshold,
    probability_mask_to_polygon_wkt,
    probability_mask_to_risk_wkts,
)
from model.live_weather import fetch_live_rainfall_forecast
from model.preprocessing import (
    DEFAULT_SAMPLE_IMAGE,
    load_h5_image,
    load_sample_tensor,
    normalized_image_to_tensor,
    preprocess_image_array,
)
from model.unet_v3 import UNetV3, predict_probability_mask


MODEL_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODEL_DIR.parent
MODEL_CHECKPOINT = "unet_v3_southern_leyte_osm_manual_noah_5level.pth"
MODEL_PATH = MODEL_DIR / MODEL_CHECKPOINT
SOUTHERN_LEYTE_TENSOR = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "southern_leyte"
    / "tensors"
    / "southern_leyte_demo_001.h5"
)
SOUTHERN_LEYTE_TILE_BOUNDS = (
    PROJECT_ROOT / "data" / "metadata" / "southern_leyte" / "tile_bounds.csv"
)


@lru_cache(maxsize=1)
def load_model():
    model = UNetV3(in_channels=14, out_channels=1)
    state_dict = torch.load(MODEL_PATH, map_location="cpu")
    model.load_state_dict(state_dict)
    model.eval()
    return model


def run_sample_inference():
    model = load_model()
    sample_input = load_sample_tensor()
    probability_mask = predict_probability_mask(model, sample_input)
    probability_array = probability_mask.detach().cpu().numpy()
    display_threshold = adaptive_mask_threshold(probability_array)

    return {
        "sample_image": str(DEFAULT_SAMPLE_IMAGE),
        "input_shape": list(sample_input.shape),
        "output_shape": list(probability_mask.shape),
        "mean_probability": float(probability_mask.mean().item()),
        "max_probability": float(probability_mask.max().item()),
        "min_probability": float(probability_mask.min().item()),
        "display_threshold": display_threshold,
        "predicted_pixel_count": int((probability_array >= display_threshold).sum()),
    }


def _load_tile_bounds(tile_id="southern_leyte_demo_001"):
    if not SOUTHERN_LEYTE_TILE_BOUNDS.exists():
        return None

    with SOUTHERN_LEYTE_TILE_BOUNDS.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("tile_id") == tile_id:
                return {
                    "min_lon": float(row["min_lon"]),
                    "min_lat": float(row["min_lat"]),
                    "max_lon": float(row["max_lon"]),
                    "max_lat": float(row["max_lat"]),
                }

    return None


def run_landslide_prediction(bounds=None):
    """Run U-Net V3 on the processed Southern Leyte tensor when available."""
    model = load_model()
    input_image = SOUTHERN_LEYTE_TENSOR if SOUTHERN_LEYTE_TENSOR.exists() else DEFAULT_SAMPLE_IMAGE
    sample_input = _load_model_tensor(input_image)
    probability_mask = predict_probability_mask(model, sample_input)
    probability_array = probability_mask.detach().cpu().numpy()
    display_threshold = adaptive_mask_threshold(probability_array)
    inference_check = {
        "sample_image": str(input_image),
        "input_shape": list(sample_input.shape),
        "output_shape": list(probability_mask.shape),
        "mean_probability": float(probability_mask.mean().item()),
        "max_probability": float(probability_mask.max().item()),
        "min_probability": float(probability_mask.min().item()),
        "display_threshold": display_threshold,
        "predicted_pixel_count": int((probability_array >= display_threshold).sum()),
    }
    probability = inference_check["max_probability"]
    risk_level = "High" if probability >= 0.75 else "Medium" if probability >= 0.5 else "Low"

    return {
        "name": "U-Net Sample Prediction",
        "risk_level": risk_level,
        "probability": probability,
        "model": "U-Net V3",
        "checkpoint": MODEL_CHECKPOINT,
        "inference_check": inference_check,
        "wkt": probability_mask_to_polygon_wkt(
            probability_array,
            threshold=display_threshold,
            bounds=bounds or _load_tile_bounds(),
        ),
    }


def run_landslide_predictions(bounds=None):
    """Return separate low/medium/high polygons from the fine-tuned model output."""
    model = load_model()
    input_image = SOUTHERN_LEYTE_TENSOR if SOUTHERN_LEYTE_TENSOR.exists() else DEFAULT_SAMPLE_IMAGE
    sample_input = _load_model_tensor(input_image)
    probability_mask = predict_probability_mask(model, sample_input)
    probability_array = probability_mask.detach().cpu().numpy()
    display_threshold = adaptive_mask_threshold(probability_array)
    inference_check = {
        "sample_image": str(input_image),
        "risk_surface": "noah_finetuned_model_probability",
        "input_shape": list(sample_input.shape),
        "output_shape": list(probability_mask.shape),
        "mean_probability": float(probability_mask.mean().item()),
        "max_probability": float(probability_mask.max().item()),
        "min_probability": float(probability_mask.min().item()),
        "display_threshold": display_threshold,
        "predicted_pixel_count": int((probability_array >= display_threshold).sum()),
    }

    predictions = probability_mask_to_risk_wkts(
        probability_array,
        bounds=bounds or _load_tile_bounds(),
        name_prefix="NOAH Fine-Tuned U-Net",
        band_specs=[
            (1, "15%", "NOAH Fine-Tuned U-Net 15% Risk", 0.00, 0.15),
            (2, "30%", "NOAH Fine-Tuned U-Net 30% Risk", 0.15, 0.30),
            (3, "50%", "NOAH Fine-Tuned U-Net 50% Risk", 0.30, 0.50),
            (4, "75%", "NOAH Fine-Tuned U-Net 75% Risk", 0.50, 0.75),
            (5, "100%", "NOAH Fine-Tuned U-Net 100% Risk", 0.75, 1.00),
        ],
    )

    return {
        "model": "U-Net V3",
        "checkpoint": MODEL_CHECKPOINT,
        "inference_check": inference_check,
        "predictions": predictions,
    }


def run_rainfall_simulation(
    rainfall_mm_per_hr,
    duration_hours,
    saturation_factor=1.0,
    bounds=None,
    name_prefix=None,
    risk_surface="rainfall_simulated_model_probability",
    scenario_metadata=None,
):
    """Run a scenario by increasing the normalized rainfall channel before inference."""
    model = load_model()
    input_image = SOUTHERN_LEYTE_TENSOR if SOUTHERN_LEYTE_TENSOR.exists() else DEFAULT_SAMPLE_IMAGE
    image = load_h5_image(input_image).astype("float32")

    total_rainfall_mm = max(float(rainfall_mm_per_hr), 0.0) * max(float(duration_hours), 0.0)
    saturation_factor = max(float(saturation_factor), 0.0)
    rainfall_boost = min(total_rainfall_mm / 250.0, 1.0) * min(saturation_factor, 2.0)

    baseline_rainfall = image[:, :, 3].copy()
    image[:, :, 3] = (0.65 * baseline_rainfall + 0.35 * rainfall_boost).clip(0.0, 1.0)

    sample_input = normalized_image_to_tensor(image)
    probability_mask = predict_probability_mask(model, sample_input)
    probability_array = probability_mask.detach().cpu().numpy()
    display_threshold = adaptive_mask_threshold(probability_array)
    scenario_label = f"{total_rainfall_mm:.0f}mm/{duration_hours:.1f}h"
    name_prefix = name_prefix or f"Rainfall Simulation {scenario_label}"

    predictions = probability_mask_to_risk_wkts(
        probability_array,
        bounds=bounds or _load_tile_bounds(),
        name_prefix=name_prefix,
        band_specs=[
            (1, "15%", f"{name_prefix} 15% Risk", 0.00, 0.15),
            (2, "30%", f"{name_prefix} 30% Risk", 0.15, 0.30),
            (3, "50%", f"{name_prefix} 50% Risk", 0.30, 0.50),
            (4, "75%", f"{name_prefix} 75% Risk", 0.50, 0.75),
            (5, "100%", f"{name_prefix} 100% Risk", 0.75, 1.00),
        ],
    )
    scenario = {
        "rainfall_mm_per_hr": float(rainfall_mm_per_hr),
        "duration_hours": float(duration_hours),
        "total_rainfall_mm": total_rainfall_mm,
        "saturation_factor": saturation_factor,
        "rainfall_boost": rainfall_boost,
        "baseline_rainfall_mean": float(baseline_rainfall.mean()),
        "simulated_rainfall_mean": float(image[:, :, 3].mean()),
    }
    if scenario_metadata:
        scenario.update(scenario_metadata)

    return {
        "model": "U-Net V3",
        "checkpoint": MODEL_CHECKPOINT,
        "scenario": scenario,
        "inference_check": {
            "sample_image": str(input_image),
            "risk_surface": risk_surface,
            "input_shape": list(sample_input.shape),
            "output_shape": list(probability_mask.shape),
            "mean_probability": float(probability_mask.mean().item()),
            "max_probability": float(probability_mask.max().item()),
            "min_probability": float(probability_mask.min().item()),
            "display_threshold": display_threshold,
            "predicted_pixel_count": int((probability_array >= display_threshold).sum()),
        },
        "predictions": predictions,
    }


def run_live_rainfall_prediction(bounds=None):
    live_rainfall = fetch_live_rainfall_forecast()
    scenario_label = (
        f"{live_rainfall['total_forecast_rainfall_mm']:.1f}mm/"
        f"{live_rainfall['duration_hours']:.0f}h"
    )

    return run_rainfall_simulation(
        rainfall_mm_per_hr=live_rainfall["rainfall_mm_per_hr"],
        duration_hours=live_rainfall["duration_hours"],
        saturation_factor=live_rainfall["saturation_factor"],
        bounds=bounds,
        name_prefix=f"Live Rainfall Prediction {scenario_label}",
        risk_surface="live_rainfall_model_probability",
        scenario_metadata={"live_weather": live_rainfall},
    )


def _load_model_tensor(input_image):
    input_image = Path(input_image)
    if input_image == SOUTHERN_LEYTE_TENSOR and input_image.exists():
        return normalized_image_to_tensor(load_h5_image(input_image))

    return load_sample_tensor(input_image)


def _local_susceptibility_score(image_path):
    image = load_h5_image(image_path)
    if image.shape != (128, 128, 14):
        raise ValueError(f"Expected image shape (128, 128, 14), got {image.shape}")

    dem = image[:, :, 0]
    slope = image[:, :, 1]
    rainfall = image[:, :, 3]
    ndvi = image[:, :, 5]
    coarse_fragments = image[:, :, 7]
    clay = image[:, :, 8]
    geology = image[:, :, 13]

    score = (
        0.40 * slope
        + 0.20 * rainfall
        + 0.12 * clay
        + 0.08 * coarse_fragments
        + 0.10 * (1.0 - ndvi)
        + 0.05 * dem
        + 0.05 * geology
    )
    score = score.astype("float32")
    score_min = float(score.min())
    score_max = float(score.max())

    if score_max > score_min:
        score = (score - score_min) / (score_max - score_min)
    else:
        score = score * 0

    return score
