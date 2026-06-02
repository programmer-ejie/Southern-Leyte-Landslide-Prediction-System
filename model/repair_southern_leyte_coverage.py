from __future__ import annotations

import csv
import shutil
from pathlib import Path

import h5py
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TENSOR_PATH = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "southern_leyte"
    / "tensors"
    / "southern_leyte_demo_001.h5"
)
MASK_PATH = (
    PROJECT_ROOT
    / "data"
    / "processed"
    / "southern_leyte"
    / "masks"
    / "southern_leyte_osm_manual_noah_5level_target.h5"
)
TILE_BOUNDS_PATH = (
    PROJECT_ROOT / "data" / "metadata" / "southern_leyte" / "tile_bounds.csv"
)

OLD_BOUNDS = {
    "min_lon": 124.62,
    "min_lat": 9.88,
    "max_lon": 125.35,
    "max_lat": 10.55,
}
REPAIRED_BOUNDS = {
    "min_lon": 124.62,
    "min_lat": 9.88,
    "max_lon": 125.35,
    "max_lat": 10.622240066000074,
}


def main():
    repair_h5_dataset(TENSOR_PATH, "img", fill_value=None)
    repair_h5_dataset(MASK_PATH, "mask", fill_value=0.15)
    update_tile_bounds()
    print("Southern Leyte coverage repaired to include northern Silago.")


def repair_h5_dataset(path, dataset_name, fill_value):
    backup_path = path.with_suffix(path.suffix + ".before-coverage-repair")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)

    with h5py.File(path, "r") as source:
        data = source[dataset_name][:]
        attrs = dict(source[dataset_name].attrs.items())

    repaired = resample_to_repaired_bounds(data, fill_value=fill_value)

    with h5py.File(path, "w") as target:
        dataset = target.create_dataset(dataset_name, data=repaired.astype(data.dtype))
        for key, value in attrs.items():
            dataset.attrs[key] = value
        dataset.attrs["coverage_repair"] = (
            "Resampled from original demo bounds; newly uncovered cells filled "
            "with low baseline values or nearest tensor edge values."
        )
        dataset.attrs["min_lon"] = REPAIRED_BOUNDS["min_lon"]
        dataset.attrs["min_lat"] = REPAIRED_BOUNDS["min_lat"]
        dataset.attrs["max_lon"] = REPAIRED_BOUNDS["max_lon"]
        dataset.attrs["max_lat"] = REPAIRED_BOUNDS["max_lat"]


def resample_to_repaired_bounds(data, fill_value):
    height, width = data.shape[:2]
    lon_grid, lat_grid = repaired_pixel_centers(height, width)
    old_cols = (
        (lon_grid - OLD_BOUNDS["min_lon"])
        / (OLD_BOUNDS["max_lon"] - OLD_BOUNDS["min_lon"])
        * width
        - 0.5
    )
    old_rows = (
        (OLD_BOUNDS["max_lat"] - lat_grid)
        / (OLD_BOUNDS["max_lat"] - OLD_BOUNDS["min_lat"])
        * height
        - 0.5
    )
    inside_old_bounds = (
        (old_rows >= 0)
        & (old_rows <= height - 1)
        & (old_cols >= 0)
        & (old_cols <= width - 1)
    )
    sample_rows = np.clip(np.rint(old_rows).astype(int), 0, height - 1)
    sample_cols = np.clip(np.rint(old_cols).astype(int), 0, width - 1)
    sampled = data[sample_rows, sample_cols]

    if fill_value is None:
        return sampled

    repaired = np.full_like(data, fill_value)
    repaired[inside_old_bounds] = sampled[inside_old_bounds]
    return repaired


def repaired_pixel_centers(height, width):
    cols = np.arange(width, dtype=np.float32) + 0.5
    rows = np.arange(height, dtype=np.float32) + 0.5
    lon = REPAIRED_BOUNDS["min_lon"] + (
        cols / width * (REPAIRED_BOUNDS["max_lon"] - REPAIRED_BOUNDS["min_lon"])
    )
    lat = REPAIRED_BOUNDS["max_lat"] - (
        rows / height * (REPAIRED_BOUNDS["max_lat"] - REPAIRED_BOUNDS["min_lat"])
    )
    return np.meshgrid(lon, lat)


def update_tile_bounds():
    rows = []
    with TILE_BOUNDS_PATH.open("r", encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        fieldnames = reader.fieldnames
        for row in reader:
            if row.get("tile_id") == "southern_leyte_demo_001":
                row["min_lon"] = str(REPAIRED_BOUNDS["min_lon"])
                row["min_lat"] = str(REPAIRED_BOUNDS["min_lat"])
                row["max_lon"] = str(REPAIRED_BOUNDS["max_lon"])
                row["max_lat"] = str(REPAIRED_BOUNDS["max_lat"])
                row["notes"] = "coverage-repaired demo bounds including northern Silago"
            rows.append(row)

    with TILE_BOUNDS_PATH.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
