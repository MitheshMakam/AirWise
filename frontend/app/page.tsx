"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const GROUPS = [
  { value: "general", label: "General public" },
  { value: "asthma", label: "Asthma / respiratory condition" },
  { value: "elderly", label: "Elderly" },
  { value: "children", label: "Children" },
  { value: "athlete", label: "Outdoor athlete" },
];

type Advisory = {
  location: { name: string; admin1?: string; country?: string };
  aqi: { aqi: number; dominant_pollutant?: string | null; pollutants: Record<string, number>; station: string; measured_at?: string | null };
  weather: { temperature_c: number | null; wind_kmh: number | null };
  hourly_outlook: { time: string; temperature_c: number; humidity_pct: number; wind_kmh: number }[];
  health: { category: string; base_guidance: string; group: string; extra_caution_flag: boolean };
  advisory: string;
  responsible_ai_note: string;
};

const BAND_COLORS: Record<string, string> = {
  Good: "#4fa8c9", Moderate: "#d9a94f", "Unhealthy for Sensitive Groups": "#d9824f",
  Unhealthy: "#c9524f", "Very Unhealthy": "#93415a", Hazardous: "#d9824f",
};
const BAND_TINTS: Record<string, string> = {
  Good: "#a7dce8", Moderate: "#f0dfa9", "Unhealthy for Sensitive Groups": "#edc2a5",
  Unhealthy: "#e8b2ad", "Very Unhealthy": "#c7a2ae", Hazardous: "#baa6b2",
};

export default function Home() {
  const railRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const [location, setLocation] = useState("");
  const [group, setGroup] = useState("general");
  const [data, setData] = useState<Advisory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activePanel, setActivePanel] = useState(0);
  const requestedGroupLabel = GROUPS.find((item) => item.value === group)?.label || "General public";

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActivePanel(Number((entry.target as HTMLElement).dataset.panel));
      });
    }, { root: rail, threshold: 0.65 });
    rail.querySelectorAll("[data-panel]").forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, []);

  async function requestAdvisory(place: string, audience = group) {
    if (!place.trim()) { setError("Enter a city, town, or neighborhood to begin."); return; }
    const requestId = ++requestIdRef.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`${API_URL}/api/advisory?location=${encodeURIComponent(place)}&group=${encodeURIComponent(audience)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Couldn't fetch air quality. Try again in a moment.");
      if (requestId === requestIdRef.current) setData(body as Advisory);
    } catch (e) {
      if (requestId === requestIdRef.current) {
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
        setData(null);
      }
    } finally { if (requestId === requestIdRef.current) setLoading(false); }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestAdvisory(location);
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setError("Geolocation isn't available in this browser."); return; }
    setLoading(true); setError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { const point = `${coords.latitude},${coords.longitude}`; setLocation(point); void requestAdvisory(point); },
      () => { setError("Location access was denied. You can search for a place instead."); setLoading(false); },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  function scrollDashboard(direction: -1 | 1) {
    const nextPanel = (activePanel + direction + 3) % 3;
    setActivePanel(nextPanel);
    railRef.current?.querySelector(`[data-panel="${nextPanel}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }

  const bandColor = data ? BAND_COLORS[data.health.category] || "#4fa8c9" : "#4fa8c9";
  const bandTint = data ? BAND_TINTS[data.health.category] || "#a7dce8" : "#a7dce8";

  return (
    <main className="airwise-page" style={{ "--aqi-tint": bandTint, "--aqi-color": bandColor } as React.CSSProperties}>
      <div className="aqi-backdrop" aria-hidden="true" />
      <div className="topline"><span className="live-dot" /> LIVE AIR QUALITY, MADE CLEAR <span className="topline-right">A SMALL GUIDE FOR YOUR DAY</span></div>
      <header className="airwise-header">
        <a className="airwise-brand" href="#home" aria-label="AirWise home"><svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><circle className="logo-disc" cx="20" cy="20" r="18.5"/><circle className="logo-sun" cx="27" cy="12" r="3.5"/><path className="logo-breeze" d="M7 17h15c3.4 0 3.8-5 0-5-1.5 0-2.5.8-2.8 1.8M5 22h22c4 0 4.2 5.3.2 5.3-1.4 0-2.4-.7-2.8-1.7M9 27h8"/></svg><span>AirWise</span></a>
        <nav aria-label="Main navigation"><a className="nav-active" href="#home">Today</a><a href="#reading">Your reading</a><a href="#about">How it works</a></nav>
        <a className="header-action" href="#check">Check your air <span aria-hidden="true">↗</span></a>
      </header>

      <section className="air-hero" id="home">
        <p className="eyebrow">AN AI AIR QUALITY ADVISOR</p>
        <h1>Know the air before<br className="hero-break" /> you go out.</h1>
        <p className="hero-copy">Enter any city, town, or neighborhood. We check live air quality against health guidance and explain what it means for you today.</p>
        <form className="search-card" id="check" onSubmit={submitSearch}>
          <label className="location-field"><span>YOUR LOCATION</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Try Pune or Bengaluru" aria-label="City, town, or neighborhood" /></label>
          <label className="group-field"><span>ADVICE FOR</span><select value={group} onChange={(event) => { const next = event.target.value; setGroup(next); if (data && location.trim()) void requestAdvisory(location, next); }} aria-label="Sensitivity group">{GROUPS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <button className="check-button" type="submit" disabled={loading}>{loading ? "Checking..." : "Check air"}<span aria-hidden="true">↗</span></button>
          <button className="location-button" type="button" onClick={useMyLocation} disabled={loading}><span aria-hidden="true">◎</span> Use my location</button>
        </form>
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>

      <section className="reading-section" id="reading" aria-live="polite">
        <div className="section-heading"><div><p className="eyebrow">{data ? `LATEST READING / ${data.location.name.toUpperCase()}` : "YOUR DAILY AIR CHECK"}</p><h2>{data ? `Air in ${data.location.name}` : "A clearer picture of your air"}</h2></div><div className="dashboard-tools"><span className="freshness"><i /> {data ? "CURRENT ESTIMATE" : "READY WHEN YOU ARE"}</span><div className="rail-controls"><button type="button" aria-label="Scroll dashboard left" onClick={() => scrollDashboard(-1)}>←</button><button type="button" aria-label="Scroll dashboard right" onClick={() => scrollDashboard(1)}>→</button></div></div></div>
        <div className="reading-rail" ref={railRef}>
          <article className={`reading-panel aqi-panel${activePanel === 0 ? " is-selected" : ""}`} data-panel="0" aria-current={activePanel === 0 ? "true" : undefined} style={{ "--band-color": bandColor } as React.CSSProperties}>
            <div className="panel-head"><span>01 / AIR QUALITY</span><span className="panel-icon" aria-hidden="true">◌</span></div>
            {data ? <><div className="aqi-value">{data.aqi.aqi}<small>AQI</small></div><h3 className="aqi-category">{data.health.category}</h3><p className="panel-copy">{data.location.name}{data.location.admin1 ? `, ${data.location.admin1}` : ""}{data.aqi.measured_at ? ` · ${data.aqi.measured_at}` : ""}</p><div className="pollutant-list">{Object.entries(data.aqi.pollutants).slice(0, 4).map(([name, value]) => <span key={name}><b>{name.toUpperCase()}</b>{value}</span>)}</div><details className="panel-details"><summary>Explore all pollutant readings</summary><div className="detail-values">{Object.entries(data.aqi.pollutants).map(([name, value]) => <span key={name}><b>{name.toUpperCase()}</b>{value}</span>)}</div></details></> : <><div className="empty-visual"><span className="empty-ring" /><span className="empty-number">--</span><small>AQI</small></div><h3>Live reading</h3><p className="panel-copy">Search a place to see the latest available air quality and key pollutants.</p><a className="panel-action" href="#check">Search a location <span aria-hidden="true">↗</span></a></>}
          </article>
          <article className={`reading-panel advice-panel${activePanel === 1 ? " is-selected" : ""}`} data-panel="1" aria-current={activePanel === 1 ? "true" : undefined}>
            <div className="panel-head"><span>02 / PERSONAL ADVICE</span><span className="panel-icon warm" aria-hidden="true">✳</span></div>
            {data ? <><p className="advice-audience">GUIDANCE FOR {data.health.group.toUpperCase()}</p>{loading ? <p className="advice-refresh" role="status">Updating for {requestedGroupLabel}...</p> : <><h3 className="advice-text">{data.advisory}</h3><details className="panel-details"><summary>Why this advice?</summary><p>{data.health.base_guidance} {data.responsible_ai_note}</p></details></>}</> : <><div className="advice-placeholder"><span /><span /><span /></div><h3>Plain language, for you</h3><p className="panel-copy">We compare the reading with health guidance and tailor the explanation to your selected group.</p><a className="panel-action" href="#check">Choose your audience <span aria-hidden="true">↗</span></a></>}
          </article>
          <article className={`reading-panel weather-panel${activePanel === 2 ? " is-selected" : ""}`} data-panel="2" aria-current={activePanel === 2 ? "true" : undefined}>
            <div className="panel-head"><span>03 / CONDITIONS</span><span className="panel-icon" aria-hidden="true">☼</span></div>
            {data ? <><div className="weather-stats"><div><small>TEMPERATURE</small><strong>{data.weather.temperature_c == null ? "--" : `${data.weather.temperature_c}°`}</strong></div><div><small>WIND</small><strong>{data.weather.wind_kmh == null ? "--" : `${data.weather.wind_kmh}`}<em> km/h</em></strong></div></div><div className="outlook-title">HOURLY OUTLOOK</div>{data.hourly_outlook.length ? <><div className="outlook-bars">{data.hourly_outlook.slice(0, 8).map((hour) => <div className="outlook-hour" key={hour.time}><i style={{ height: `${Math.max(12, Math.min(44, hour.wind_kmh * 3))}px` }} /><span>{hour.time.slice(-5)}</span></div>)}</div><details className="panel-details"><summary>Open full hourly outlook</summary><div className="hourly-detail-list">{data.hourly_outlook.map((hour) => <span key={hour.time}><b>{hour.time.slice(-5)}</b>{hour.temperature_c}°C · {hour.wind_kmh} km/h wind · {hour.humidity_pct}% humidity</span>)}</div></details></> : <p className="weather-unavailable">Hourly weather is temporarily unavailable for this location.</p>}<p className="panel-copy source-note">AQI source: {data.aqi.station}</p></> : <><div className="weather-placeholder"><i>☼</i><span>--°</span><b>-- km/h</b></div><h3>Weather in context</h3><p className="panel-copy">See current conditions alongside the air reading, all in one place.</p><a className="panel-action" href="#check">Check local conditions <span aria-hidden="true">↗</span></a></>}
          </article>
        </div>
      </section>

      <footer className="airwise-footer" id="about"><span><span className="footer-mark">AIRWISE</span> · Know the air before you go out.</span><span>Informational guidance, not a medical diagnosis.</span></footer>
    </main>
  );
}
