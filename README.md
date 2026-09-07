# AirWise — AI Air Quality Advisor

A multi-agent AI system that fetches live AQI + weather for **any location** and
turns it into a plain-language, personalized advisory. Built for the 1M1B AI
for Sustainability internship (IBM SkillsBuild & AICTE).

## How it maps to the deliverables

- **SDG Alignment:** SDG 11 (Sustainable Cities and Communities), SDG 13 (Climate Action)
- **Problem statement:** People — especially sensitive groups (children, elderly,
  asthma patients, outdoor athletes) — rarely check real-time air quality before
  deciding to go outside, because raw AQI numbers and pollutant charts aren't
  actionable on their own.
- **AI solution overview:** Three agents run in sequence —
  1. **Data Agent** — geocodes any location and pulls live AQI (WAQI) + weather (Open-Meteo)
  2. **Health Reasoning Agent** — maps the reading to WHO/CPCB-aligned guidance, adjusted for the user's sensitivity group
  3. **Advisory Agent** — generates a short plain-language advisory (LLM-backed, with a rule-based fallback so it always works)
- **Target users:** Anyone, anywhere — not tied to one campus or city. Input is a free-text location.
- **Responsible AI considerations:** the app states it's informational (not medical advice), notes that sensor coverage varies by area, and never stores personal or location data server-side.
- **Expected impact:** faster, more personal decisions about outdoor activity, reduced exposure for sensitive groups, and general public awareness of local air quality trends.

## Architecture

```
frontend/  Next.js 14 (React) — search UI + dashboard
backend/   FastAPI — /api/advisory endpoint running the 3-agent pipeline
```

## Local setup

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # add your WAQI_TOKEN (free, ~2 min: https://aqicn.org/data-platform/token/)
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```
Open http://localhost:3000 — search any city and it works end to end.

> Without `OPENAI_API_KEY` set on the backend, advisories still generate —
> they just use the templated (non-LLM) summary instead of the LLM one.

## Deployment (matches your usual pattern)

- **Backend → Render:** New Web Service, root dir `backend`, build command
  `pip install -r requirements.txt`, start command `uvicorn main:app --host 0.0.0.0 --port $PORT`.
  Add `WAQI_TOKEN` and (optionally) `OPENAI_API_KEY` as environment variables.
- **Frontend → Vercel:** import `frontend` as the project root, add
  `NEXT_PUBLIC_API_URL` env var pointing at your Render backend URL.

## Notes for your submission PPT/PDF

Screenshot the dashboard for 2–3 different cities/AQI bands (e.g. one clean
city, one moderately polluted, one high-AQI) — the sky-strip color shift
across screenshots makes a strong visual for the "Prototype/Demo" slide.
