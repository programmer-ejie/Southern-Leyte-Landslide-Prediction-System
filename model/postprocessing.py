from functools import lru_cache
from pathlib import Path

import numpy as np

try:
    from rasterio.features import shapes as raster_shapes
    from rasterio.transform import from_bounds
except ImportError:  # pragma: no cover - fallback for environments without rasterio
    raster_shapes = from_bounds = None

try:
    import shapefile
except ImportError:  # pragma: no cover - fallback for environments without pyshp
    shapefile = None

try:
    from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, shape
    from shapely.ops import unary_union
    from shapely.validation import make_valid
    from shapely import wkt
except ImportError:  # pragma: no cover - fallback for environments without shapely
    GeometryCollection = MultiPolygon = Polygon = None
    shape = unary_union = make_valid = wkt = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOUTHERN_LEYTE_BOUNDARY = (
    PROJECT_ROOT
    / "data"
    / "raw"
    / "southern_leyte"
    / "boundary"
    / "gadm41_PHL_1.shp"
)

SOUTHERN_LEYTE_DEMO_BOUNDS = {
    "min_lon": 124.62,
    "min_lat": 9.88,
    "max_lon": 125.35,
    "max_lat": 10.622240066000074,
}


def adaptive_mask_threshold(probability_mask, base_threshold=0.5, min_pixels=100):
    mask = _squeeze_mask(probability_mask)

    if int((mask >= base_threshold).sum()) >= min_pixels:
        return base_threshold

    percentile_threshold = float(np.percentile(mask, 98))
    return max(0.1, min(base_threshold, percentile_threshold))


def probability_mask_to_polygon_wkt(
    probability_mask,
    threshold=None,
    bounds=None,
    min_component_pixels=6,
):
    bounds = bounds or SOUTHERN_LEYTE_DEMO_BOUNDS
    mask = _squeeze_mask(probability_mask)
    threshold = adaptive_mask_threshold(mask) if threshold is None else threshold
    binary_mask = mask >= threshold

    components = _connected_components(binary_mask)
    components = [
        component for component in components if len(component) >= min_component_pixels
    ]

    if not components:
        components = [_fallback_component(mask)]

    polygons = []
    for component in components:
        hull = _component_hull(component, bounds)
        if len(hull) >= 4:
            polygons.append(hull)

    if not polygons:
        polygons = [_component_hull(_fallback_component(mask), bounds)]

    return _clip_wkt_to_southern_leyte(_polygons_to_wkt(polygons))


def probability_mask_to_risk_wkts(
    probability_mask,
    bounds=None,
    min_pixels=8,
    simplify_tolerance=0.001,
    medium_threshold=0.50,
    high_threshold=0.75,
    name_prefix="U-Net",
    band_specs=None,
):
    """Convert a probability mask into separate low/medium/high clipped polygons."""
    bounds = bounds or SOUTHERN_LEYTE_DEMO_BOUNDS
    mask = _squeeze_mask(probability_mask)

    if band_specs is None:
        band_specs = [
            (1, "Low", f"{name_prefix} Low Risk", 0.0, medium_threshold),
            (2, "Medium", f"{name_prefix} Medium Risk", medium_threshold, high_threshold),
            (3, "High", f"{name_prefix} High Risk", high_threshold, 1.01),
        ]

    classified = np.zeros(mask.shape, dtype=np.uint8)
    for value, _risk_level, _name, min_value, max_value in band_specs:
        if max_value >= 1.0:
            classified[(mask >= min_value) & (mask <= max_value)] = value
        else:
            classified[(mask >= min_value) & (mask < max_value)] = value

    if raster_shapes is None or from_bounds is None or shape is None:
        return _probability_mask_to_risk_wkts_fallback(
            mask,
            classified,
            bounds,
            band_specs,
            min_pixels,
            name_prefix,
        )

    transform = from_bounds(
        bounds["min_lon"],
        bounds["min_lat"],
        bounds["max_lon"],
        bounds["max_lat"],
        mask.shape[1],
        mask.shape[0],
    )
    pixel_area = (
        (bounds["max_lon"] - bounds["min_lon"])
        * (bounds["max_lat"] - bounds["min_lat"])
        / (mask.shape[0] * mask.shape[1])
    )
    min_area = min_pixels * pixel_area

    risk_specs = [
        (value, risk_level, name)
        for value, risk_level, name, _min_value, _max_value in sorted(
            band_specs,
            key=lambda item: item[0],
            reverse=True,
        )
    ]
    results = []

    for value, risk_level, name in risk_specs:
        band_mask = classified == value
        if not np.any(band_mask):
            continue

        geometries = []
        for geometry, geometry_value in raster_shapes(
            classified,
            mask=band_mask,
            transform=transform,
        ):
            if int(geometry_value) != value:
                continue

            geom = make_valid(shape(geometry))
            if geom.area >= min_area:
                geometries.append(geom)

        if not geometries:
            continue

        geometry = make_valid(unary_union(geometries))
        boundary = _southern_leyte_boundary()
        if boundary is not None:
            geometry = make_valid(geometry.intersection(boundary))

        geometry = _polygonal_geometry(geometry)
        if geometry is None or geometry.is_empty:
            continue

        if simplify_tolerance:
            geometry = geometry.simplify(simplify_tolerance, preserve_topology=True)
            geometry = _polygonal_geometry(make_valid(geometry))

        if geometry is None or geometry.is_empty:
            continue

        band_values = mask[band_mask]
        results.append(
            {
                "name": name,
                "risk_level": risk_level,
                "probability": float(np.nanmax(band_values)),
                "wkt": geometry.wkt,
            }
        )

    if not results:
        fallback_wkt = probability_mask_to_polygon_wkt(
            mask,
            threshold=adaptive_mask_threshold(mask),
            bounds=bounds,
        )
        results.append(
            {
                "name": f"{name_prefix} High Risk",
                "risk_level": "High",
                "probability": float(np.nanmax(mask)),
                "wkt": fallback_wkt,
            }
        )

    return results


def postprocessing_capabilities():
    return {
        "rasterio_shapes": raster_shapes is not None,
        "rasterio_from_bounds": from_bounds is not None,
        "shapely": shape is not None and unary_union is not None and make_valid is not None,
        "pyshp": shapefile is not None,
        "mode": (
            "rasterio"
            if raster_shapes is not None and from_bounds is not None and shape is not None
            else "banded_fallback"
        ),
    }


def _probability_mask_to_risk_wkts_fallback(
    mask,
    classified,
    bounds,
    band_specs,
    min_pixels,
    name_prefix,
):
    results = []
    risk_specs = [
        (value, risk_level, name)
        for value, risk_level, name, _min_value, _max_value in sorted(
            band_specs,
            key=lambda item: item[0],
            reverse=True,
        )
    ]

    for value, risk_level, name in risk_specs:
        band_mask = classified == value
        if not np.any(band_mask):
            continue

        components = [
            component
            for component in _connected_components(band_mask)
            if len(component) >= min_pixels
        ]
        if not components:
            continue

        polygons = []
        for component in components:
            hull = _component_hull(component, bounds)
            if len(hull) >= 4:
                polygons.append(hull)

        if not polygons:
            continue

        band_values = mask[band_mask]
        results.append(
            {
                "name": name,
                "risk_level": risk_level,
                "probability": float(np.nanmax(band_values)),
                "wkt": _clip_wkt_to_southern_leyte(_polygons_to_wkt(polygons)),
            }
        )

    if results:
        return results

    fallback_wkt = probability_mask_to_polygon_wkt(
        mask,
        threshold=adaptive_mask_threshold(mask),
        bounds=bounds,
    )
    return [
        {
            "name": f"{name_prefix} High Risk",
            "risk_level": "High",
            "probability": float(np.nanmax(mask)),
            "wkt": fallback_wkt,
        }
    ]


def _squeeze_mask(probability_mask):
    mask = np.asarray(probability_mask)

    if mask.ndim == 4:
        mask = mask[0, 0]
    elif mask.ndim == 3:
        mask = mask[0]

    if mask.shape != (128, 128):
        raise ValueError(f"Expected mask shape (128, 128), got {mask.shape}")

    return mask


def _connected_components(binary_mask):
    visited = np.zeros(binary_mask.shape, dtype=bool)
    components = []
    height, width = binary_mask.shape

    for row in range(height):
        for col in range(width):
            if visited[row, col] or not binary_mask[row, col]:
                continue

            stack = [(row, col)]
            visited[row, col] = True
            component = []

            while stack:
                current_row, current_col = stack.pop()
                component.append((current_row, current_col))

                for next_row, next_col in (
                    (current_row - 1, current_col),
                    (current_row + 1, current_col),
                    (current_row, current_col - 1),
                    (current_row, current_col + 1),
                ):
                    if (
                        0 <= next_row < height
                        and 0 <= next_col < width
                        and not visited[next_row, next_col]
                        and binary_mask[next_row, next_col]
                    ):
                        visited[next_row, next_col] = True
                        stack.append((next_row, next_col))

            components.append(component)

    return components


def _fallback_component(mask):
    max_row, max_col = np.unravel_index(np.argmax(mask), mask.shape)
    return [
        (row, col)
        for row in range(max(max_row - 4, 0), min(max_row + 5, mask.shape[0]))
        for col in range(max(max_col - 4, 0), min(max_col + 5, mask.shape[1]))
    ]


def _component_hull(component, bounds):
    points = []

    for row, col in component:
        points.extend(
            [
                _pixel_to_lon_lat(row, col, bounds),
                _pixel_to_lon_lat(row, col + 1, bounds),
                _pixel_to_lon_lat(row + 1, col + 1, bounds),
                _pixel_to_lon_lat(row + 1, col, bounds),
            ]
        )

    hull = _convex_hull(points)

    if hull[0] != hull[-1]:
        hull.append(hull[0])

    return hull


def _pixel_to_lon_lat(row, col, bounds):
    min_lon = bounds["min_lon"]
    max_lon = bounds["max_lon"]
    min_lat = bounds["min_lat"]
    max_lat = bounds["max_lat"]

    lon = min_lon + (col / 128) * (max_lon - min_lon)
    lat = max_lat - (row / 128) * (max_lat - min_lat)
    return (lon, lat)


def _convex_hull(points):
    unique_points = sorted(set(points))

    if len(unique_points) <= 1:
        return unique_points

    def cross(origin, point_a, point_b):
        return (point_a[0] - origin[0]) * (point_b[1] - origin[1]) - (
            point_a[1] - origin[1]
        ) * (point_b[0] - origin[0])

    lower = []
    for point in unique_points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper = []
    for point in reversed(unique_points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    return lower[:-1] + upper[:-1]


def _polygons_to_wkt(polygons):
    polygon_strings = []

    for polygon in polygons:
        coordinates = ",".join(f"{lon:.6f} {lat:.6f}" for lon, lat in polygon)
        polygon_strings.append(f"(({coordinates}))")

    if len(polygon_strings) == 1:
        return f"POLYGON{polygon_strings[0]}"

    return f"MULTIPOLYGON({','.join(polygon_strings)})"


@lru_cache(maxsize=1)
def _southern_leyte_boundary():
    if shapefile is None or shape is None or not SOUTHERN_LEYTE_BOUNDARY.exists():
        return None

    reader = shapefile.Reader(str(SOUTHERN_LEYTE_BOUNDARY))
    fields = [field[0] for field in reader.fields[1:]]
    province_geometries = []

    for shape_record in reader.iterShapeRecords():
        record = dict(zip(fields, shape_record.record))
        if record.get("NAME_1") == "Southern Leyte":
            province_geometries.append(shape(shape_record.shape.__geo_interface__))

    if not province_geometries:
        return None

    return unary_union(province_geometries)


def _clip_wkt_to_southern_leyte(wkt_text):
    boundary = _southern_leyte_boundary()
    if boundary is None or wkt is None:
        return wkt_text

    try:
        prediction = make_valid(wkt.loads(wkt_text))
        prediction = unary_union(prediction)
        clipped = make_valid(prediction.intersection(boundary))
        clipped = _polygonal_geometry(clipped)

        if clipped is None or clipped.is_empty:
            return wkt_text

        return clipped.wkt
    except Exception:
        return wkt_text


def _polygonal_geometry(geometry):
    if geometry is None or geometry.is_empty:
        return None

    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry

    if isinstance(geometry, GeometryCollection):
        polygons = [
            part
            for part in geometry.geoms
            if isinstance(part, (Polygon, MultiPolygon)) and not part.is_empty
        ]
        if not polygons:
            return None

        return unary_union(polygons)

    return None
