from functools import lru_cache
import csv
from pathlib import Path

import h5py
import torch

from model.postprocessing import (
    adaptive_mask_threshold,
    probability_mask_to_polygon_wkt,
    probability_mask_to_risk_wkts,
)
from model.live_weather import (
    LiveRainfallForecastUnavailable,
    fetch_live_rainfall_forecast,
)
from model.preprocessing import (
    DEFAULT_SAMPLE_IMAGE,
    load_h5_image,
    load_sample_tensor,
    normalized_image_to_tensor,
    preprocess_image_array,
)
from model.attention_unet import AttentionUNet
from model.unet_v3 import predict_probability_mask


MODEL_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODEL_DIR.parent
MODEL_NAME = "Attention U-Net"
MODEL_CHECKPOINT = "attention_unet.pth"
MODEL_PATH = MODEL_DIR / "new-model" / MODEL_CHECKPOINT
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
SOUTHERN_LEYTE_BASELINE_5LEVEL_MASK = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "southern_leyte"
    / "masks"
    / "southern_leyte_osm_manual_noah_5level_target.h5"
)


def _load_baseline_hazard_mask():
    with h5py.File(SOUTHERN_LEYTE_BASELINE_5LEVEL_MASK, "r") as f:
        return f["mask"][:].astype("float32")


def _baseline_hazard_to_probability(mask):
    """Convert the curated 5-level hazard mask into a 0-1 probability surface."""
    normalized = mask.astype("float32").copy()
    normalized[mask <= 0] = 0.0
    normalized[mask == 1] = 0.15
    normalized[mask == 2] = 0.30
    normalized[mask == 3] = 0.50
    normalized[mask == 4] = 0.75
    normalized[mask >= 5] = 1.00
    return normalized


@lru_cache(maxsize=1)
def load_model():
    model = AttentionUNet(in_channels=14, out_channels=1)
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
    """Run the selected model on the processed Southern Leyte tensor when available."""
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
        "model": MODEL_NAME,
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
        "risk_surface": "attention_unet_model_probability",
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
        name_prefix=MODEL_NAME,
        min_pixels=1,
        band_specs=[
            (1, "15%", "Attention U-Net 15% Risk", 0.00, 0.15),
            (2, "30%", "Attention U-Net 30% Risk", 0.15, 0.30),
            (3, "50%", "Attention U-Net 50% Risk", 0.30, 0.50),
            (4, "75%", "Attention U-Net 75% Risk", 0.50, 0.75),
            (5, "100%", "Attention U-Net 100% Risk", 0.75, 1.00),
        ],
    )

    return {
        "model": MODEL_NAME,
        "checkpoint": MODEL_CHECKPOINT,
        "inference_check": inference_check,
        "predictions": predictions,
    }


def run_baseline_hazard_predictions(bounds=None):
    """Return the curated 5-level Southern Leyte baseline hazard layer."""
    mask = _load_baseline_hazard_mask()

    predictions = probability_mask_to_risk_wkts(
        mask,
        bounds=bounds or _load_tile_bounds(),
        name_prefix="Baseline Hazard",
        min_pixels=1,
        simplify_tolerance=0.0005,
        band_specs=[
            (1, "15%", "Baseline Hazard 15% Risk", 0.00, 0.151),
            (2, "30%", "Baseline Hazard 30% Risk", 0.151, 0.49),
            (3, "50%", "Baseline Hazard 50% Risk", 0.49, 0.51),
            (4, "75%", "Baseline Hazard 75% Risk", 0.74, 0.76),
            (5, "100%", "Baseline Hazard 100% Risk", 0.99, 1.01),
        ],
    )

    return {
        "model": "Curated 5-level baseline hazard",
        "checkpoint": str(SOUTHERN_LEYTE_BASELINE_5LEVEL_MASK),
        "inference_check": {
            "sample_image": str(SOUTHERN_LEYTE_BASELINE_5LEVEL_MASK),
            "risk_surface": "osm_manual_noah_5level_target",
            "input_shape": list(mask.shape),
            "output_shape": list(mask.shape),
            "mean_probability": float(mask.mean()),
            "max_probability": float(mask.max()),
            "min_probability": float(mask.min()),
            "display_threshold": None,
            "predicted_pixel_count": int((mask > 0).sum()),
        },
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
    """Run rainfall over the curated baseline hazard plus the local tensor model."""
    total_rainfall_mm = max(float(rainfall_mm_per_hr), 0.0) * max(float(duration_hours), 0.0)
    saturation_factor = max(float(saturation_factor), 0.0)
    scenario_label = f"{total_rainfall_mm:.0f}mm/{duration_hours:.1f}h"
    name_prefix = name_prefix or f"Rainfall Simulation {scenario_label}"

    if total_rainfall_mm <= 0:
        baseline_result = run_baseline_hazard_predictions(bounds=bounds)
        scenario = {
            "rainfall_mm_per_hr": float(rainfall_mm_per_hr),
            "duration_hours": float(duration_hours),
            "total_rainfall_mm": total_rainfall_mm,
            "saturation_factor": saturation_factor,
            "rainfall_boost": 0.0,
            "scenario_pressure": 0.0,
            "no_rainfall_passthrough": True,
        }
        if scenario_metadata:
            scenario.update(scenario_metadata)

        return {
            "model": baseline_result["model"],
            "checkpoint": baseline_result["checkpoint"],
            "scenario": scenario,
            "inference_check": {
                **baseline_result["inference_check"],
                "risk_surface": risk_surface,
            },
            "predictions": baseline_result["predictions"],
        }

    model = load_model()
    input_image = SOUTHERN_LEYTE_TENSOR if SOUTHERN_LEYTE_TENSOR.exists() else DEFAULT_SAMPLE_IMAGE
    image = load_h5_image(input_image).astype("float32")
    baseline_hazard = _baseline_hazard_to_probability(_load_baseline_hazard_mask())

    rainfall_boost = min(total_rainfall_mm / 250.0, 1.0) * min(saturation_factor, 5.0) / 5.0
    scenario_pressure = min((total_rainfall_mm / 500.0) * max(saturation_factor, 0.25), 1.0)

    baseline_rainfall = image[:, :, 3].copy()
    image[:, :, 3] = (0.55 * baseline_rainfall + 0.45 * rainfall_boost).clip(0.0, 1.0)

    sample_input = normalized_image_to_tensor(image)
    probability_mask = predict_probability_mask(model, sample_input)
    model_probability = probability_mask.detach().cpu().numpy().squeeze()
    rainfall_adjustment = (1.0 - baseline_hazard) * scenario_pressure * 0.55
    model_adjustment = model_probability * scenario_pressure * 0.25
    probability_array = (
        baseline_hazard + rainfall_adjustment + model_adjustment
    ).clip(0.0, 1.0)
    display_threshold = adaptive_mask_threshold(probability_array)
    predictions = probability_mask_to_risk_wkts(
        probability_array,
        bounds=bounds or _load_tile_bounds(),
        name_prefix=name_prefix,
        min_pixels=1,
        simplify_tolerance=0 if scenario_pressure == 0 else 0.0015,
        band_specs=[
            (1, "15%", f"{name_prefix} 15% Risk", 0.00, 0.225),
            (2, "30%", f"{name_prefix} 30% Risk", 0.225, 0.40),
            (3, "50%", f"{name_prefix} 50% Risk", 0.40, 0.625),
            (4, "75%", f"{name_prefix} 75% Risk", 0.625, 0.875),
            (5, "100%", f"{name_prefix} 100% Risk", 0.875, 1.01),
        ],
    )
    scenario = {
        "rainfall_mm_per_hr": float(rainfall_mm_per_hr),
        "duration_hours": float(duration_hours),
        "total_rainfall_mm": total_rainfall_mm,
        "saturation_factor": saturation_factor,
        "rainfall_boost": rainfall_boost,
        "scenario_pressure": scenario_pressure,
        "baseline_rainfall_mean": float(baseline_rainfall.mean()),
        "simulated_rainfall_mean": float(image[:, :, 3].mean()),
        "baseline_hazard_mean": float(baseline_hazard.mean()),
        "model_probability_mean": float(model_probability.mean()),
        "blended_probability_mean": float(probability_array.mean()),
    }
    if scenario_metadata:
        scenario.update(scenario_metadata)

    return {
        "model": MODEL_NAME,
        "checkpoint": MODEL_CHECKPOINT,
        "scenario": scenario,
        "inference_check": {
            "sample_image": str(input_image),
            "risk_surface": risk_surface,
            "input_shape": list(sample_input.shape),
            "output_shape": list(probability_array.shape),
            "mean_probability": float(probability_array.mean()),
            "max_probability": float(probability_array.max()),
            "min_probability": float(probability_array.min()),
            "display_threshold": display_threshold,
            "predicted_pixel_count": int((probability_array >= display_threshold).sum()),
        },
        "predictions": predictions,
    }


def run_live_rainfall_prediction(bounds=None):
    try:
        live_rainfall = fetch_live_rainfall_forecast()
    except LiveRainfallForecastUnavailable as exc:
        baseline_result = run_baseline_hazard_predictions(bounds=bounds)
        live_weather = {
            **exc.metadata,
            "forecast_unavailable": True,
            "fallback_to_baseline": True,
            "unavailable_reason": exc.reason,
        }

        return {
            "model": baseline_result["model"],
            "checkpoint": baseline_result["checkpoint"],
            "scenario": {
                "live_weather": live_weather,
                "fallback_to_baseline": True,
                "no_rainfall_passthrough": True,
            },
            "inference_check": {
                **baseline_result["inference_check"],
                "risk_surface": "osm_manual_noah_5level_target",
                "live_forecast_unavailable": True,
            },
            "predictions": baseline_result["predictions"],
        }

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
        risk_surface="baseline_hazard_live_rainfall_model_probability",
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
