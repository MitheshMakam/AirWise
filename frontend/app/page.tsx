"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const GROUPS = [
  { value: "general", label: "General public" },
  { value: "asthma", label: "Asthma / respiratory condition" },
  { value: "elderly", label: "Elderly" },
  { value: "children", label: "Children" },
  { value: "athlete", label: "Outdoor athlete" },
];

const BAND_COLOR: Record<string, string> = {
  "Good": "#4FA8C9",
  "Moderate": "#D9A94F",
  "Unhealthy for Sensitive Groups": "#D9824F",
  "Unhealthy": "#C9524F",
  "Very Unhealthy": "#93415A",
  "Hazardous": "#5C2A3A",
};

type Advisory = {
  location: { name: string; admin1: string; country: string };
  aqi: { aqi: number; dominant_pollutant: string; pollutants: Record<string, number>; station: string; measured_at: string };
  weather: { temperature_c: number; wind_kmh: number };
  hourly_outlook: { time: string; temperature_c: number; humidity_pct: number; wind_kmh: number }[];
  health: { category: string; base_guidance: string; group: string; extra_caution_flag: boolean };
  advisory: string;
  responsible_ai_note: string;
};

export default function Home() {
  const [location, setLocation] = useState("");
  const [group, setGroup] = useState("general");
  const [data, setData] = useState<Advisory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const bandColor = data ? BAND_COLOR[data.health.category] || "#3A4150" : "#2A303C";

  async function runAdvisory(loc: string) {
    if (!loc.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${API_URL}/api/advisory?location=${encodeURIComponent(loc)}&group=${group}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Couldn't fetch that location. Try a nearby city name.");
      }
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation isn't available in this browser.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const res = await fetch(
            `${API_URL}/api/advisory?location=${latitude},${longitude}&group=${group}`
          );
          const json = await res.json();
          setData(json);
        } catch {
          setError("Couldn't read your location's air quality.");
        } finally {
          setLoading(false);
        }
      },
      () => {
        setError("Location access was denied.");
        setLoading(false);
      }
    );
  }

  return (
    <main className="page">
      <aside className="skystrip" style={{ background: bandColor }}>
        <span className="skystrip-label">
          {data ? data.health.category : "AWAITING READING"}
        </span>
      </aside>

      <div className="content">
        <header className="hero">
          <p className="eyebrow">AirWise — an AI air quality advisor</p>
          <h1>Know the air before you go out.</h1>
          <p className="sub">
            Enter any city, town, or neighborhood. Three small agents fetch the live
            reading, check it against WHO/CPCB guidance, and tell you plainly what
            today looks like — for you specifically.
          </p>
        </header>

        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            runAdvisory(location);
          }}
        >
          <input
            type="text"
            placeholder="Try 'Kondhwa, Pune' or 'Bengaluru'"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={loading}>
            {loading ? "Reading…" : "Check air"}
          </button>
          <button type="button" className="ghost" onClick={useMyLocation} disabled={loading}>
            Use my location
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        {data && (
          <section className="results">
            <div className="reading-row">
              <div className="reading-card" style={{ borderColor: bandColor }}>
                <span className="reading-value" style={{ color: bandColor }}>
                  {data.aqi.aqi}
                </span>
                <span className="reading-unit">AQI</span>
                <span className="reading-category">{data.health.category}</span>
                <span className="reading-place">
                  {data.location.name}
                  {data.location.admin1 ? `, ${data.location.admin1}` : ""}
                </span>
              </div>

              <div className="pollutant-grid">
                {Object.entries(data.aqi.pollutants).map(([key, val]) => (
                  <div className="pollutant" key={key}>
                    <span className="pollutant-key">{key.toUpperCase()}</span>
                    <span className="pollutant-val">{val}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="advisory-card">
              <p className="advisory-label">Advisory for {data.health.group}</p>
              <p className="advisory-text">{data.advisory}</p>
            </div>

            <div className="weather-row">
              <span>Currently {data.weather.temperature_c}°C</span>
              <span>Wind {data.weather.wind_kmh} km/h</span>
              <span>Station: {data.aqi.station}</span>
            </div>

            <footer className="responsible-note">{data.responsible_ai_note}</footer>
          </section>
        )}
      </div>
    </main>
  );
}
