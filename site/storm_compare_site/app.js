const COUNTY_GEOJSON_URL = "./data/us_counties.geojson";
const STORMS_URL = "./data/storms_compare.json?v=synthetic-preview-contrast-2";

const COLORS = ["#f7f4ea", "#efe3bf", "#e3c879", "#d89a43", "#c16b2a", "#93371d", "#5d1d14"];
const BINS = [1, 50, 250, 1000, 5000, 15000];

const state = {
  counties: null,
  storms: [],
  modelSources: [],
  modelArchitectures: [],
  predictionModes: [],
  sourceMeta: {},
  currentStorm: null,
  currentModelSource: null,
  currentArchitecture: null,
  currentMode: null,
  timesteps: [],
  currentIndex: 0,
  mapPred: null,
  mapReal: null,
  geoPred: null,
  geoReal: null,
  syncLock: false,
  pathPred: null,
  pathReal: null,
  fullPathPred: null,
  fullPathReal: null,
  eyePred: null,
  eyeReal: null,
};

const stormSelectEl = document.getElementById("stormSelect");
const modelSourceSelectEl = document.getElementById("modelSourceSelect");
const architectureSelectEl = document.getElementById("architectureSelect");
const modeSelectEl = document.getElementById("modeSelect");
const sliderEl = document.getElementById("timeSlider");
const timeLabelEl = document.getElementById("timeLabel");
const legendEl = document.getElementById("legend");
const startDateLabelEl = document.getElementById("startDateLabel");
const endDateLabelEl = document.getElementById("endDateLabel");

const MODEL_SOURCE_LABELS = {
  aurora: "Aurora-trained (synthetic preview)",
  era5: "ERA5-trained (reanalysis domain)",
  era5_on_aurora_inputs: "ERA5-trained on Aurora inputs (cross-domain)",
};

const ARCHITECTURE_LABELS = {
  ridge: "Ridge (linear, log1p wrapper)",
  poisson_linear: "Poisson linear (PoissonRegressor)",
  lgbm_poisson: "LightGBM (Poisson loss)",
  mlp_torch: "PyTorch MLP (Poisson NLL, GPU)",
};

function parseIso(ts) {
  if (!ts) return new Date(NaN);
  const compact = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
  const m = String(ts).match(compact);
  if (m) {
    const [, d, hh, mm, ss] = m;
    return new Date(`${d}T${hh}:${mm}:${ss}Z`);
  }
  return new Date(ts);
}

function formatTs(ts) {
  const d = parseIso(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return (
    d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }) + " UTC"
  );
}

function colorForOutage(value) {
  if (!value || value < BINS[0]) return COLORS[0];
  if (value < BINS[1]) return COLORS[1];
  if (value < BINS[2]) return COLORS[2];
  if (value < BINS[3]) return COLORS[3];
  if (value < BINS[4]) return COLORS[4];
  if (value < BINS[5]) return COLORS[5];
  return COLORS[6];
}

function buildLegend() {
  legendEl.innerHTML = "";
  const title = document.createElement("h3");
  title.textContent = "Expected outages";
  const list = document.createElement("ul");
  const labels = ["0", "1 - 49", "50 - 249", "250 - 999", "1k - 4,999", "5k - 14,999", ">= 15k"];

  labels.forEach((label, idx) => {
    const li = document.createElement("li");
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.backgroundColor = COLORS[idx];
    li.appendChild(sw);
    li.appendChild(document.createTextNode(label));
    list.appendChild(li);
  });

  legendEl.appendChild(title);
  legendEl.appendChild(list);
}

function getTrackPointForTs(track, ts) {
  const target = parseIso(ts).getTime();
  let best = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const p of track) {
    const delta = Math.abs(parseIso(p.timestamp).getTime() - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }
  return best;
}

function getTrackPathUntil(track, ts) {
  const target = parseIso(ts).getTime();
  return track.filter((p) => parseIso(p.timestamp).getTime() <= target).map((p) => [p.lat, p.lon]);
}

function outagesFor(side, ts) {
  if (!state.currentStorm || !ts) return {};
  if (side === "pred") {
    const bySource = state.currentStorm.predicted_outages_by_source_by_arch_by_mode || {};
    const byArch = bySource[state.currentModelSource] || {};
    const byMode = byArch[state.currentArchitecture] || {};
    const byTs = byMode[state.currentMode] || {};
    return byTs[ts] || {};
  }
  const byTs = state.currentStorm.reality_outages_by_timestamp || {};
  return byTs[ts] || {};
}

function styleFor(side, feature) {
  if (!state.currentStorm || !state.timesteps.length) {
    return { fillColor: COLORS[0], color: "#5f695e", weight: 0.45, fillOpacity: 0.72 };
  }
  const ts = state.timesteps[state.currentIndex];
  const map = outagesFor(side, ts);
  const fips = String(feature.properties.county_fips || "").padStart(5, "0");
  const value = map[fips] || 0;
  return { fillColor: colorForOutage(value), color: "#5f695e", weight: 0.45, fillOpacity: 0.72 };
}

function onEachCounty(side, layer, feature) {
  layer.on({
    mouseover: (evt) => {
      const ts = state.timesteps[state.currentIndex];
      const map = outagesFor(side, ts);
      const fips = String(feature.properties.county_fips || "").padStart(5, "0");
      const value = map[fips] || 0;
      const name = feature.properties.NAME || "Unknown county";
      evt.target.setStyle({ weight: 1.3, color: "#2f382f" });
      evt.target
        .bindTooltip(
          `<strong>${name}</strong><br/>FIPS: ${fips}<br/>${side === "pred" ? "Predicted" : "Reality"}: ${value.toLocaleString()}`,
          { direction: "top", className: "county-tip", sticky: true }
        )
        .openTooltip();
    },
    mouseout: (evt) => {
      (side === "pred" ? state.geoPred : state.geoReal).resetStyle(evt.target);
      evt.target.closeTooltip();
    },
  });
}

function syncMaps() {
  state.mapPred.on("move", () => {
    if (state.syncLock) return;
    state.syncLock = true;
    state.mapReal.setView(state.mapPred.getCenter(), state.mapPred.getZoom(), { animate: false });
    state.syncLock = false;
  });
  state.mapReal.on("move", () => {
    if (state.syncLock) return;
    state.syncLock = true;
    state.mapPred.setView(state.mapReal.getCenter(), state.mapReal.getZoom(), { animate: false });
    state.syncLock = false;
  });
}

function renderStormLayers() {
  const forecastTrack = state.currentStorm.forecast_track || [];
  const realityTrack = state.currentStorm.reality_track || [];
  const fullPred = forecastTrack.map((p) => [p.lat, p.lon]);
  const fullReal = realityTrack.map((p) => [p.lat, p.lon]);

  if (state.fullPathPred) state.fullPathPred.remove();
  if (state.fullPathReal) state.fullPathReal.remove();
  if (state.pathPred) state.pathPred.remove();
  if (state.pathReal) state.pathReal.remove();
  if (state.eyePred) state.eyePred.remove();
  if (state.eyeReal) state.eyeReal.remove();

  state.fullPathPred = L.polyline(fullPred, { color: "#4f8fb8", weight: 2, opacity: 0.45 }).addTo(state.mapPred);
  state.fullPathReal = L.polyline(fullReal, { color: "#4f8fb8", weight: 2, opacity: 0.45 }).addTo(state.mapReal);

  state.pathPred = L.polyline([], { color: "#1d5f89", weight: 4, opacity: 0.95, dashArray: "8 5" }).addTo(state.mapPred);
  state.pathReal = L.polyline([], { color: "#1d5f89", weight: 4, opacity: 0.95, dashArray: "8 5" }).addTo(state.mapReal);

  state.eyePred = L.circleMarker([0, 0], { radius: 6, color: "#0b2d44", fillColor: "#2f90c8", fillOpacity: 0.95, weight: 2 }).addTo(state.mapPred);
  state.eyeReal = L.circleMarker([0, 0], { radius: 6, color: "#0b2d44", fillColor: "#2f90c8", fillOpacity: 0.95, weight: 2 }).addTo(state.mapReal);
}

function refreshAll() {
  if (!state.currentStorm || !state.timesteps.length) {
    timeLabelEl.textContent = "No timesteps available";
    return;
  }
  const ts = state.timesteps[state.currentIndex];
  const hasPrediction = Object.keys(outagesFor("pred", ts)).length > 0;
  timeLabelEl.textContent = hasPrediction
    ? formatTs(ts)
    : `${formatTs(ts)} | No prediction data for this selection`;

  state.geoPred.setStyle((f) => styleFor("pred", f));
  state.geoReal.setStyle((f) => styleFor("real", f));

  const pathPred = getTrackPathUntil(state.currentStorm.forecast_track || [], ts);
  const pathReal = getTrackPathUntil(state.currentStorm.reality_track || [], ts);
  state.pathPred.setLatLngs(pathPred);
  state.pathReal.setLatLngs(pathReal);

  const eyePred = getTrackPointForTs(state.currentStorm.forecast_track || [], ts);
  const eyeReal = getTrackPointForTs(state.currentStorm.reality_track || [], ts);
  if (eyePred) {
    state.eyePred.setLatLng([eyePred.lat, eyePred.lon]);
  }
  if (eyeReal) {
    state.eyeReal.setLatLng([eyeReal.lat, eyeReal.lon]);
  }
}

function setStorm(stormId) {
  const storm = state.storms.find((s) => s.id === stormId) || state.storms[0];
  state.currentStorm = storm;
  populateModelSourceOptions();
  populateArchitectureOptions();
  populateModeOptions();

  state.timesteps = storm.timesteps || [];
  state.currentIndex = 0;

  sliderEl.min = "0";
  sliderEl.max = String(Math.max(0, state.timesteps.length - 1));
  sliderEl.value = "0";

  startDateLabelEl.textContent = state.timesteps.length ? formatTs(state.timesteps[0]) : "--";
  endDateLabelEl.textContent = state.timesteps.length ? formatTs(state.timesteps[state.timesteps.length - 1]) : "--";

  renderStormLayers();
  refreshAll();
}

function _sourceMap() {
  const storm = state.currentStorm;
  if (!storm) return {};
  return storm.predicted_outages_by_source_by_arch_by_mode || {};
}

function _availableSourcesForCurrentStorm() {
  return state.modelSources;
}

function _availableArchitecturesForCurrentStormAndSource() {
  return state.modelArchitectures;
}

function _availableModesForCurrentStormSourceArch() {
  return state.predictionModes;
}

function populateModelSourceOptions() {
  modelSourceSelectEl.innerHTML = "";
  const sources = _availableSourcesForCurrentStorm();
  sources.forEach((s) => {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = MODEL_SOURCE_LABELS[s] || s;
    modelSourceSelectEl.appendChild(o);
  });
  state.currentModelSource = sources.includes(state.currentModelSource) ? state.currentModelSource : sources[0] || null;
  modelSourceSelectEl.value = state.currentModelSource || "";
}

function populateArchitectureOptions() {
  architectureSelectEl.innerHTML = "";
  const archs = _availableArchitecturesForCurrentStormAndSource();
  archs.forEach((a) => {
    const o = document.createElement("option");
    o.value = a;
    o.textContent = ARCHITECTURE_LABELS[a] || a;
    architectureSelectEl.appendChild(o);
  });
  state.currentArchitecture = archs.includes(state.currentArchitecture)
    ? state.currentArchitecture
    : archs.includes("ridge")
      ? "ridge"
      : archs[0] || null;
  architectureSelectEl.value = state.currentArchitecture || "";
}

function populateModeOptions() {
  modeSelectEl.innerHTML = "";
  const modes = _availableModesForCurrentStormSourceArch();
  modes.forEach((m) => {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = m;
    modeSelectEl.appendChild(o);
  });
  state.currentMode = modes.includes(state.currentMode)
    ? state.currentMode
    : modes.includes("storm_plus_embeddings_plus_socio")
      ? "storm_plus_embeddings_plus_socio"
      : modes[0] || null;
  modeSelectEl.value = state.currentMode || "";
}

async function main() {
  const [countiesResp, stormsResp] = await Promise.all([fetch(COUNTY_GEOJSON_URL), fetch(STORMS_URL)]);
  if (!countiesResp.ok || !stormsResp.ok) {
    throw new Error("Failed to load base data files.");
  }

  state.counties = await countiesResp.json();
  const stormsPayload = await stormsResp.json();
  state.storms = stormsPayload.storms || [];
  state.modelSources = stormsPayload.model_sources || [];
  state.modelArchitectures = stormsPayload.model_architectures || [];
  state.predictionModes = stormsPayload.prediction_modes || [];
  state.sourceMeta = stormsPayload.source_meta || {};
  if (!state.storms.length) {
    throw new Error("No storms available. Build compare data first.");
  }

  buildLegend();

  state.mapPred = L.map("mapPred", { zoomControl: true }).setView([31.2, -95.5], 6);
  state.mapReal = L.map("mapReal", { zoomControl: true }).setView([31.2, -95.5], 6);

  [state.mapPred, state.mapReal].forEach((m) => {
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(m);
  });

  state.geoPred = L.geoJSON(state.counties, {
    style: (f) => styleFor("pred", f),
    onEachFeature: (feature, layer) => onEachCounty("pred", layer, feature),
  }).addTo(state.mapPred);

  state.geoReal = L.geoJSON(state.counties, {
    style: (f) => styleFor("real", f),
    onEachFeature: (feature, layer) => onEachCounty("real", layer, feature),
  }).addTo(state.mapReal);

  syncMaps();

  stormSelectEl.innerHTML = "";
  state.storms.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.name.toUpperCase()} (${s.t0})`;
    stormSelectEl.appendChild(o);
  });

  stormSelectEl.addEventListener("change", () => setStorm(stormSelectEl.value));
  modelSourceSelectEl.addEventListener("change", () => {
    populateArchitectureOptions();
    populateModeOptions();
    refreshAll();
  });
  architectureSelectEl.addEventListener("change", () => {
    state.currentArchitecture = architectureSelectEl.value;
    populateModeOptions();
    refreshAll();
  });
  modeSelectEl.addEventListener("change", () => {
    state.currentMode = modeSelectEl.value;
    refreshAll();
  });
  sliderEl.addEventListener("input", (e) => {
    state.currentIndex = Number(e.target.value);
    refreshAll();
  });

  setStorm(state.storms[0].id);
}

main().catch((err) => {
  console.error(err);
  timeLabelEl.textContent = `Failed to load data: ${err.message || "unknown error"}`;
});
