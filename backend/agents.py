import os
import math
import requests
from datetime import datetime, timedelta, timezone

WAQI_TOKEN = os.getenv("WAQI_TOKEN", "demo")  # get a free token: https://aqicn.org/data-platform/token/
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
WAQI_GEO_URL = "https://api.waqi.info/feed/geo:{lat};{lon}/"
WAQI_SEARCH_URL = "https://api.waqi.info/search/"
WAQI_STATION_URL = "https://api.waqi.info/feed/@{uid}/"

# Beyond this distance, a WAQI "nearest station" match is treated as unreliable
# (WAQI's geo endpoint has no built-in radius cap, so it can return a station
# hundreds of km away instead of reporting "no data").
MAX_PLAUSIBLE_STATION_KM = 100

# WHO / CPCB-aligned AQI breakpoints (US EPA-style scale, which is what WAQI reports)
AQI_BANDS = [
    (0, 50, "Good", "Air quality is satisfactory; enjoy normal outdoor activity."),
    (51, 100, "Moderate", "Acceptable, but unusually sensitive people should consider reducing prolonged exertion outdoors."),
    (101, 150, "Unhealthy for Sensitive Groups", "Children, elderly, and people with respiratory or heart conditions should limit prolonged outdoor exertion."),
    (151, 200, "Unhealthy", "Everyone may begin to experience health effects; sensitive groups should avoid outdoor exertion."),
    (201, 300, "Very Unhealthy", "Health alert: everyone should avoid prolonged outdoor exertion."),
    (301, 500, "Hazardous", "Health emergency: everyone should avoid all outdoor exertion."),
]

SENSITIVE_GROUPS = {
    "general": "the general public",
    "asthma": "people with asthma or respiratory conditions",
    "elderly": "elderly individuals",
    "children": "children",
    "athlete": "outdoor athletes and people doing intense exercise",
}


class DataAgent:
    """Fetches and normalizes location, AQI, and weather data."""

    def geocode(self, location: str) -> dict:
        resp = requests.get(GEOCODE_URL, params={"name": location, "count": 1}, timeout=10)
        if resp.status_code != 200:
            raise RuntimeError("Geocoding service unavailable.")
        results = resp.json().get("results")
        if not results:
            raise LookupError(f"Could not find a location matching '{location}'.")
        r = results[0]
        return {
            "name": r.get("name"),
            "admin1": r.get("admin1"),
            "country": r.get("country"),
            "latitude": r["latitude"],
            "longitude": r["longitude"],
            "timezone": r.get("timezone", "auto"),
        }

    @staticmethod
    def _haversine_km(lat1, lon1, lat2, lon2) -> float:
        R = 6371
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * R * math.asin(math.sqrt(a))

    def _parse_feed(self, d: dict, lat: float, lon: float) -> dict:
        iaqi = d.get("iaqi", {})
        pollutants = {k: v.get("v") for k, v in iaqi.items() if isinstance(v, dict)}
        station_geo = d.get("city", {}).get("geo") or [lat, lon]
        distance_km = round(self._haversine_km(lat, lon, station_geo[0], station_geo[1]), 1)
        return {
            "aqi": d.get("aqi"),
            "dominant_pollutant": d.get("dominentpol"),
            "pollutants": pollutants,
            "station": d.get("city", {}).get("name"),
            "measured_at": d.get("time", {}).get("s"),
            "station_distance_km": distance_km,
        }

    def _fetch_open_meteo_aqi(self, lat: float, lon: float) -> dict:
        url = "https://air-quality-api.open-meteo.com/v1/air-quality"
        try:
            resp = requests.get(
                url,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,ozone",
                    "timezone": "auto",
                },
                timeout=15,
            )
            resp.raise_for_status()
            current = resp.json().get("current", {})
        except (requests.RequestException, ValueError) as exc:
            print("Open-Meteo air-quality request failed:", exc)
            raise RuntimeError("Current air-quality data is temporarily unavailable. Please try again shortly.") from exc

        aqi = current.get("us_aqi")
        if aqi is None:
            raise RuntimeError("Current air-quality data is temporarily unavailable. Please try again shortly.")

        pollutants = {
            "pm25": current.get("pm2_5"),
            "pm10": current.get("pm10"),
            "co": current.get("carbon_monoxide"),
            "no2": current.get("nitrogen_dioxide"),
            "o3": current.get("ozone"),
        }
        return {
            "aqi": round(aqi),
            "dominant_pollutant": None,
            "pollutants": {key: value for key, value in pollutants.items() if value is not None},
            "station": "Open-Meteo modeled estimate (not a monitoring station)",
            "measured_at": current.get("time"),
            "station_distance_km": None,
        }

    def _search_nearest_station(self, keyword: str, lat: float, lon: float):
        resp = requests.get(WAQI_SEARCH_URL, params={"token": WAQI_TOKEN, "keyword": keyword}, timeout=10)
        if resp.status_code != 200:
            return None
        results = resp.json().get("data", [])
        candidates = []
        for r in results:
            geo = r.get("station", {}).get("geo")
            uid = r.get("uid")
            if geo and uid is not None:
                dist = self._haversine_km(lat, lon, geo[0], geo[1])
                candidates.append((dist, uid))
        if not candidates:
            return None
        candidates.sort(key=lambda c: c[0])
        best_uid = candidates[0][1]
        station_resp = requests.get(WAQI_STATION_URL.format(uid=best_uid), params={"token": WAQI_TOKEN}, timeout=10)
        if station_resp.status_code != 200:
            return None
        payload = station_resp.json()
        if payload.get("status") != "ok":
            return None
        return payload["data"]

    def fetch_aqi(self, lat: float, lon: float, keyword: str = "") -> dict:
        try:
            resp = requests.get(WAQI_GEO_URL.format(lat=lat, lon=lon), params={"token": WAQI_TOKEN}, timeout=10)
            geo_data = None
            if resp.status_code == 200 and resp.json().get("status") == "ok":
                candidate = resp.json()["data"]
                station_geo = candidate.get("city", {}).get("geo")
                if station_geo:
                    dist = self._haversine_km(lat, lon, station_geo[0], station_geo[1])
                    if dist <= MAX_PLAUSIBLE_STATION_KM:
                        geo_data = candidate

            if geo_data is None and keyword:
                geo_data = self._search_nearest_station(keyword, lat, lon)

            if geo_data is not None:
                result = self._parse_feed(geo_data, lat, lon)
                measured_at = result.get("measured_at")
                try:
                    measured_time = datetime.fromisoformat(measured_at.replace("Z", "+00:00"))
                    if measured_time.tzinfo is None:
                        measured_time = measured_time.replace(tzinfo=timezone.utc)
                    stale = datetime.now(timezone.utc) - measured_time > timedelta(hours=6)
                except (AttributeError, TypeError, ValueError):
                    stale = True
                if not stale:
                    return result
                print("WAQI reading is older than six hours; using the current modeled estimate.")
        except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
            print("WAQI request failed; trying Open-Meteo air quality:", exc)

        return self._fetch_open_meteo_aqi(lat, lon)

    def fetch_weather(self, lat: float, lon: float) -> dict:
        unavailable = {
            "current": {"temperature_c": None, "wind_kmh": None},
            "hourly_outlook": [],
        }
        try:
            resp = requests.get(
                WEATHER_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,wind_speed_10m",
                    "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m",
                    "forecast_days": 1,
                    "timezone": "auto",
                },
                timeout=10,
            )
        except requests.RequestException as exc:
            print("Open-Meteo request failed:", exc)
            return unavailable

        if resp.status_code != 200:
            print("Open-Meteo error:", resp.status_code, resp.text)
            return unavailable

        try:
            d = resp.json()
        except ValueError as exc:
            print("Open-Meteo returned invalid JSON:", exc)
            return unavailable

        current = d.get("current", {})
        hourly = d.get("hourly", {})

        times = hourly.get("time", [])
        temps = hourly.get("temperature_2m", [])
        humidity = hourly.get("relative_humidity_2m", [])
        wind = hourly.get("wind_speed_10m", [])

        outlook = [
            {
                "time": t,
                "temperature_c": temps[i],
                "humidity_pct": humidity[i],
                "wind_kmh": wind[i],
            }
            for i, t in enumerate(times)
        ]

        return {
            "current": {
                "temperature_c": current.get("temperature_2m"),
                "wind_kmh": current.get("wind_speed_10m"),
            },
            "hourly_outlook": outlook,
        }

class HealthAgent:
    """Maps AQI + sensitivity group to a WHO/CPCB-aligned health assessment."""

    def _band_for(self, aqi_value: int):
        for lo, hi, label, guidance in AQI_BANDS:
            if lo <= aqi_value <= hi:
                return label, guidance
        return "Hazardous", AQI_BANDS[-1][3]

    def assess(self, aqi_data: dict, group: str) -> dict:
        aqi_value = aqi_data.get("aqi") or 0
        try:
            aqi_value = int(aqi_value)
        except (TypeError, ValueError):
            aqi_value = 0
        label, guidance = self._band_for(aqi_value)
        group_label = SENSITIVE_GROUPS.get(group, SENSITIVE_GROUPS["general"])

        extra_caution = aqi_value > 100 and group != "general"
        return {
            "category": label,
            "base_guidance": guidance,
            "group": group_label,
            "extra_caution_flag": extra_caution,
        }


class AdvisoryAgent:
    """Turns structured data into a plain-language advisory. Uses an LLM if
    OPENAI_API_KEY is set, otherwise falls back to a templated summary so the
    app always works without external keys."""

    def generate(self, place: dict, aqi_data: dict, weather_data: dict, health: dict, group: str) -> str:
        if OPENAI_API_KEY:
            try:
                return self._generate_with_llm(place, aqi_data, weather_data, health)
            except Exception:
                pass  # fall back silently if the LLM call fails
        return self._generate_template(place, aqi_data, weather_data, health)

    def _best_and_worst_windows(self, hourly_outlook: list) -> str:
        if not hourly_outlook:
            return ""
        # crude heuristic: pick the windiest hour as "clearest" and calmest+hottest as "worst"
        sorted_by_wind = sorted(hourly_outlook, key=lambda h: h["wind_kmh"] or 0)
        worst = sorted_by_wind[0]["time"][-5:]
        best = sorted_by_wind[-1]["time"][-5:]
        return f"Conditions look most favorable around {best} and most stagnant around {worst}."

    def _generate_template(self, place, aqi_data, weather_data, health) -> str:
        name = place.get("name", "your location")
        aqi_value = aqi_data.get("aqi", "N/A")
        category = health["category"]
        window_note = self._best_and_worst_windows(weather_data.get("hourly_outlook", []))
        return (
            f"Air quality in {name} is currently {category} (AQI {aqi_value}). "
            f"{health['base_guidance']} This is especially relevant for {health['group']}. "
            f"{window_note}"
        ).strip()

    def _generate_with_llm(self, place, aqi_data, weather_data, health) -> str:
        prompt = (
            "You are a plain-language air quality advisor. Given this structured data, "
            "write a short (2-4 sentence) advisory for a resident. Mention the AQI category, "
            "one concrete behavior recommendation, and a best/worst time window if the hourly "
            "data supports it. No markdown, no headers, just prose.\n\n"
            f"Location: {place.get('name')}, {place.get('admin1')}, {place.get('country')}\n"
            f"AQI: {aqi_data.get('aqi')} ({health['category']})\n"
            f"Dominant pollutant: {aqi_data.get('dominant_pollutant')}\n"
            f"Base guidance: {health['base_guidance']}\n"
            f"Audience: {health['group']}\n"
            f"Current temp: {weather_data['current'].get('temperature_c')}C, "
            f"wind: {weather_data['current'].get('wind_kmh')} km/h\n"
        )
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 200,
                "temperature": 0.4,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
