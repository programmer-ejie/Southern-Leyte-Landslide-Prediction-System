from datetime import datetime, timezone
import os
from urllib.parse import urlencode
from urllib.request import urlopen
import json


OPEN_METEO_FORECAST_URL = os.getenv(
    "OPEN_METEO_FORECAST_URL",
    "https://api.open-meteo.com/v1/forecast",
)
SOUTHERN_LEYTE_LATITUDE = 10.22
SOUTHERN_LEYTE_LONGITUDE = 125.05


class LiveRainfallForecastUnavailable(Exception):
    def __init__(self, reason, metadata=None):
        super().__init__(reason)
        self.reason = reason
        self.metadata = metadata or {}


def _metadata_base(url, latitude, longitude, payload=None):
    payload = payload or {}
    return {
        "source": "Open-Meteo Forecast API",
        "source_url": url,
        "latitude": float(latitude),
        "longitude": float(longitude),
        "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        "timezone": payload.get("timezone"),
    }


def _non_negative_number(value):
    if value is None:
        return None

    return max(float(value), 0.0)


def fetch_live_rainfall_forecast(
    latitude=SOUTHERN_LEYTE_LATITUDE,
    longitude=SOUTHERN_LEYTE_LONGITUDE,
    forecast_hours=6,
    timeout_seconds=20,
):
    """Fetch latest hourly rainfall forecast and convert it to model inputs."""
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "precipitation,rain,showers",
        "hourly": "precipitation",
        "forecast_hours": int(forecast_hours),
        "timezone": "Asia/Manila",
    }
    url = f"{OPEN_METEO_FORECAST_URL}?{urlencode(params)}"

    with urlopen(url, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))

    metadata = _metadata_base(url, latitude, longitude, payload)
    hourly = payload.get("hourly", {})
    hourly_times = hourly.get("time", [])
    raw_hourly_precipitation = hourly.get("precipitation", [])
    selected_raw_precipitation = raw_hourly_precipitation[: int(forecast_hours)]
    if not selected_raw_precipitation:
        raise LiveRainfallForecastUnavailable(
            "Open-Meteo returned no hourly precipitation forecast values.",
            {
                **metadata,
                "forecast_times": hourly_times[: int(forecast_hours)],
                "forecast_precipitation_mm": [],
            },
        )

    selected_precipitation = [_non_negative_number(value) for value in selected_raw_precipitation]
    if any(value is None for value in selected_precipitation):
        raise LiveRainfallForecastUnavailable(
            "Open-Meteo returned null hourly precipitation values.",
            {
                **metadata,
                "forecast_times": hourly_times[: int(forecast_hours)],
                "forecast_precipitation_mm": selected_raw_precipitation,
            },
        )

    duration_hours = max(len(selected_precipitation), 1)
    total_rainfall_mm = float(sum(selected_precipitation))
    average_rainfall_mm_per_hr = total_rainfall_mm / duration_hours

    current = payload.get("current", {})
    current_precipitation = _non_negative_number(current.get("precipitation")) or 0.0
    current_rain = _non_negative_number(current.get("rain")) or 0.0
    current_showers = _non_negative_number(current.get("showers")) or 0.0
    live_rate = max(average_rainfall_mm_per_hr, current_precipitation, current_rain, current_showers)

    return {
        **metadata,
        "current_time": current.get("time"),
        "current_precipitation_mm": current_precipitation,
        "current_rain_mm": current_rain,
        "current_showers_mm": current_showers,
        "forecast_hours": duration_hours,
        "forecast_times": hourly_times[: int(forecast_hours)],
        "forecast_precipitation_mm": selected_precipitation,
        "total_forecast_rainfall_mm": total_rainfall_mm,
        "average_rainfall_mm_per_hr": average_rainfall_mm_per_hr,
        "rainfall_mm_per_hr": live_rate,
        "duration_hours": float(duration_hours),
        "saturation_factor": 1.0,
    }
