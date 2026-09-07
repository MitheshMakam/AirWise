"""
AirWise backend — FastAPI service.

Single endpoint (/api/advisory) that runs a three-agent pipeline:
  1. DataAgent      -> geocodes the location, fetches live AQI + weather
  2. HealthAgent     -> maps AQI/weather to WHO/CPCB-aligned health guidance
  3. AdvisoryAgent    -> turns the structured analysis into a plain-language,
                        time-windowed advisory (LLM-backed, with a safe
                        rule-based fallback if no OPENAI_API_KEY is set)
"""

from dotenv import load_dotenv
load_dotenv()  # must run BEFORE agents.py is imported, so os.getenv sees your .env values

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from agents import DataAgent, HealthAgent, AdvisoryAgent

app = FastAPI(title="AirWise API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your deployed frontend origin in production
    allow_methods=["*"],
    allow_headers=["*"],
)

data_agent = DataAgent()
health_agent = HealthAgent()
advisory_agent = AdvisoryAgent()


class AdvisoryResponse(BaseModel):
    location: dict
    aqi: dict
    weather: dict
    hourly_outlook: list
    health: dict
    advisory: str
    responsible_ai_note: str


@app.get("/")
def root():
    return {"status": "ok", "service": "AirWise API"}


@app.get("/api/advisory", response_model=AdvisoryResponse)
def get_advisory(
    location: str = Query(..., description="City, area, or place name, e.g. 'Kondhwa, Pune'"),
    group: Optional[str] = Query(
        "general",
        description="Sensitivity group: general | asthma | elderly | children | athlete",
    ),
):
    try:
        place = data_agent.geocode(location)
        aqi_data = data_agent.fetch_aqi(place["latitude"], place["longitude"], keyword=place["name"])
        weather_data = data_agent.fetch_weather(place["latitude"], place["longitude"])
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    health = health_agent.assess(aqi_data, group)
    advisory_text = advisory_agent.generate(place, aqi_data, weather_data, health, group)

    return {
        "location": place,
        "aqi": aqi_data,
        "weather": weather_data["current"],
        "hourly_outlook": weather_data["hourly_outlook"],
        "health": health,
        "advisory": advisory_text,
        "responsible_ai_note": (
            "This advisory is generated from public AQI/weather data and general "
            "WHO/CPCB health guidance. It is informational, not a medical diagnosis. "
            "Sensor coverage varies by location, so treat readings as indicative, "
            "especially outside major cities."
        ),
    }
