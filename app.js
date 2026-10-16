const GOVERNMENT_STYLE_URL = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/resources/styles/root.json";
const GOVERNMENT_TILE_URL = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf";
const DISTRICT_URL = "resources/hksar_18_district_boundary.json";
const DISTRICT_SOURCE = "hong-kong-districts";
const COLORS = ["#df6b47", "#397c50", "#477bc0", "#9b5aaa", "#d29832", "#2c9292", "#ca4e6e"];
const $ = (selector) => document.querySelector(selector);
const ui = { status: $("#status"), upload: $("#gpx-upload"), drop: $("#drop-zone"), list: $("#gpx-list"), empty: $("#empty-routes"), mapEmpty: $("#map-empty"), summary: $("#summary"), distance: $("#total-distance"), ascent: $("#total-ascent"), count: $("#track-count"), clear: $("#clear-all"), districts: $("#district-visibility"), basemap: $("#basemap-toggle"), export: $("#export-png"), credit: $(".map-credit") };

let map;
let governmentStyle;
let districtGeojson;
let currentBasemap = "osm";
let districtsVisible = false;
let nextId = 1;
const routes = [];

bindControls();
start().catch((error) => {
  console.error(error);
  ui.status.textContent = "The map could not be loaded. Check your connection and try again.";
});

function bindControls() {
  ui.drop.addEventListener("click", () => ui.upload.click());
  ui.drop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ui.upload.click(); }
  });
  ui.upload.addEventListener("change", (event) => loadFiles(event.target.files));
  ["dragenter", "dragover"].forEach((name) => ui.drop.addEventListener(name, (event) => { event.preventDefault(); ui.drop.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((name) => ui.drop.addEventListener(name, (event) => { event.preventDefault(); ui.drop.classList.remove("is-dragging"); }));
  ui.drop.addEventListener("drop", (event) => loadFiles(event.dataTransfer.files));
  ui.districts.addEventListener("change", setDistrictVisibility);
  ui.basemap.addEventListener("click", switchBasemap);
  ui.export.addEventListener("click", exportMap);
  ui.clear.addEventListener("click", clearAllRoutes);
}

async function start() {
  const [styleResult, districtResult] = await Promise.allSettled([
    fetch(GOVERNMENT_STYLE_URL).then(checkedJson), fetch(DISTRICT_URL).then(checkedJson),
  ]);
  governmentStyle = styleResult.status === "fulfilled" ? styleResult.value : null;
  districtGeojson = districtResult.status === "fulfilled" ? districtResult.value : null;
  if (governmentStyle) {
    governmentStyle.sources.esri = { type: "vector", tiles: [GOVERNMENT_TILE_URL], bounds: [113.236, 21.6661, 114.975, 23.043], minzoom: 9, maxzoom: 15, attribution: "Map from Lands Department" };
    governmentStyle.glyphs = resolveTemplateUrl(governmentStyle.glyphs, GOVERNMENT_STYLE_URL);
  }
  map = new maplibregl.Map({ container: "map", style: buildStyle(osmStyle()), center: [114.16, 22.34], zoom: 10, attributionControl: false, preserveDrawingBuffer: true });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("error", (event) => console.error("Map error", event.error));
  map.on("load", () => { ui.status.textContent = ""; ui.basemap.disabled = !governmentStyle; ui.export.disabled = false; });
}

async function checkedJson(response) { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
function osmStyle() { return { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] }; }

function buildStyle(baseStyle) {
  const style = structuredClone(baseStyle);
  if (districtGeojson) {
    style.sources[DISTRICT_SOURCE] = { type: "geojson", data: districtGeojson };
    style.layers.push(
      { id: "district-fill", type: "fill", source: DISTRICT_SOURCE, layout: { visibility: districtsVisible ? "visible" : "none" }, paint: { "fill-color": "#397c50", "fill-opacity": .08 } },
      { id: "district-outline", type: "line", source: DISTRICT_SOURCE, layout: { visibility: districtsVisible ? "visible" : "none" }, paint: { "line-color": "#397c50", "line-width": 1.5, "line-opacity": .65 } },
    );
  }
  routes.forEach((route) => addRouteToStyle(style, route));
  return style;
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length || !map?.loaded()) { if (!map?.loaded()) ui.status.textContent = "Please wait for the map to finish loading."; return; }
  const added = [];
  const errors = [];
  for (const file of files) {
    try {
      ui.status.textContent = `Reading ${file.name}…`;
      for (const document of await readUploadedFile(file)) {
        try { const route = makeRoute(document.name, parseGpx(document.text)); routes.push(route); added.push(route); addRouteToMap(route); }
        catch (error) { errors.push(`${document.name}: ${error.message}`); }
      }
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  renderRoutes();
  if (added.length) fitRoutes(added);
  ui.status.textContent = errors.join(" • ");
  ui.upload.value = "";
}

async function readUploadedFile(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) return [{ name: file.name, text: await file.text() }];
  if (!window.JSZip) throw new Error("ZIP support is unavailable.");
  const archive = await window.JSZip.loadAsync(file);
  const entries = Object.values(archive.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".gpx"));
  if (!entries.length) throw new Error("No GPX files were found in this archive.");
  return Promise.all(entries.map(async (entry) => ({ name: entry.name.split("/").pop(), text: await entry.async("string") })));
}

function parseGpx(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("This is not valid GPX XML.");
  const features = [];
  let distance = 0;
  let ascent = 0;
  let pointCount = 0;
  for (const track of xml.getElementsByTagNameNS("*", "trk")) {
    const name = childText(track, "name") || "Untitled track";
    for (const segment of track.getElementsByTagNameNS("*", "trkseg")) {
      const points = readPoints(segment, "trkpt");
      if (points.length < 2) continue;
      const stats = pointStats(points); distance += stats.distance; ascent += stats.ascent; pointCount += points.length;
      features.push(lineFeature(points, name));
    }
  }
  for (const route of xml.getElementsByTagNameNS("*", "rte")) {
    const points = readPoints(route, "rtept");
    if (points.length < 2) continue;
    const stats = pointStats(points); distance += stats.distance; ascent += stats.ascent; pointCount += points.length;
    features.push(lineFeature(points, childText(route, "name") || "Untitled route"));
  }
  for (const waypoint of xml.getElementsByTagNameNS("*", "wpt")) {
    const lon = Number(waypoint.getAttribute("lon"));
    const lat = Number(waypoint.getAttribute("lat"));
    if (validCoordinate(lon, lat)) features.push({ type: "Feature", properties: { name: childText(waypoint, "name") || "Waypoint" }, geometry: { type: "Point", coordinates: [lon, lat] } });
  }
  if (!features.some((feature) => feature.geometry.type === "LineString")) throw new Error("No track or route with at least two points was found.");
  return { geojson: { type: "FeatureCollection", features }, distance, ascent, pointCount };
}

function readPoints(parent, tagName) {
  return Array.from(parent.getElementsByTagNameNS("*", tagName)).map((node) => {
    const elevationText = childText(node, "ele");
    return { lon: Number(node.getAttribute("lon")), lat: Number(node.getAttribute("lat")), elevation: elevationText === undefined ? null : Number(elevationText) };
  }).filter((point) => validCoordinate(point.lon, point.lat));
}
function validCoordinate(lon, lat) { return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90; }
function childText(parent, tagName) { return Array.from(parent.children).find((child) => child.localName === tagName)?.textContent?.trim(); }
function lineFeature(points, name) { return { type: "Feature", properties: { name }, geometry: { type: "LineString", coordinates: points.map((point) => [point.lon, point.lat]) } }; }
function pointStats(points) {
  let distance = 0; let ascent = 0;
  for (let i = 1; i < points.length; i += 1) {
    distance += haversine(points[i - 1], points[i]);
    if (points[i].elevation !== null && points[i - 1].elevation !== null) ascent += Math.max(0, points[i].elevation - points[i - 1].elevation);
  }
  return { distance, ascent };
}
function haversine(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat); const dLon = radians(b.lon - a.lon);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function makeRoute(filename, parsed) {
  const trackName = parsed.geojson.features.find((feature) => feature.geometry.type === "LineString")?.properties.name;
  const name = ["Untitled track", "Untitled route"].includes(trackName) ? filename.replace(/\.gpx$/i, "") : trackName;
  return { id: `route-${nextId}`, filename, name, color: COLORS[(nextId++ - 1) % COLORS.length], visible: true, ...parsed };
}
function routeLayers(route) {
  const visibility = route.visible ? "visible" : "none";
  return [
    { id: `${route.id}-casing`, type: "line", source: route.id, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round", visibility }, paint: { "line-color": "#fff", "line-width": 8, "line-opacity": .9 } },
    { id: `${route.id}-line`, type: "line", source: route.id, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round", visibility }, paint: { "line-color": route.color, "line-width": 4.5 } },
    { id: `${route.id}-points`, type: "circle", source: route.id, filter: ["==", ["geometry-type"], "Point"], layout: { visibility }, paint: { "circle-radius": 6, "circle-color": route.color, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
  ];
}
function addRouteToStyle(style, route) { style.sources[route.id] = { type: "geojson", data: route.geojson }; style.layers.push(...routeLayers(route)); }
function addRouteToMap(route) { map.addSource(route.id, { type: "geojson", data: route.geojson }); routeLayers(route).forEach((layer) => map.addLayer(layer)); }

function renderRoutes() {
  ui.list.replaceChildren();
  routes.forEach((route) => {
    const card = document.createElement("article"); card.className = `route-card${route.visible ? "" : " is-hidden"}`;
    const swatch = document.createElement("span"); swatch.className = "route-swatch"; swatch.style.background = route.color;
    const info = document.createElement("div"); info.className = "route-info"; info.title = "Zoom to route";
    const title = document.createElement("span"); title.className = "route-name"; title.textContent = route.name;
    const meta = document.createElement("span"); meta.className = "route-meta";
    [formatDistance(route.distance), `${Math.round(route.ascent).toLocaleString()} m gain`, `${route.pointCount.toLocaleString()} pts`].forEach((value) => { const span = document.createElement("span"); span.textContent = value; meta.append(span); });
    info.append(title, meta); info.addEventListener("click", () => fitRoutes([route]));
    const actions = document.createElement("div"); actions.className = "route-actions";
    const visibility = iconButton(route.visible ? eyeIcon() : eyeOffIcon(), route.visible ? "Hide route" : "Show route", () => { route.visible = !route.visible; setRouteVisibility(route); renderRoutes(); });
    const remove = iconButton("×", "Remove route", () => removeRoute(route)); remove.className = "remove";
    actions.append(visibility, remove); card.append(swatch, info, actions); ui.list.append(card);
  });
  const hasRoutes = routes.length > 0;
  ui.empty.hidden = hasRoutes; ui.summary.hidden = !hasRoutes; ui.clear.hidden = !hasRoutes; ui.mapEmpty.hidden = hasRoutes;
  ui.distance.textContent = formatDistance(routes.reduce((sum, route) => sum + route.distance, 0));
  ui.ascent.textContent = `${Math.round(routes.reduce((sum, route) => sum + route.ascent, 0)).toLocaleString()} m`;
  ui.count.textContent = routes.length;
}

function iconButton(content, label, handler) { const button = document.createElement("button"); button.type = "button"; button.setAttribute("aria-label", label); button.title = label; button.innerHTML = content; button.addEventListener("click", handler); return button; }
function eyeIcon() { return '<svg class="eye" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>'; }
function eyeOffIcon() { return '<svg class="eye" viewBox="0 0 24 24"><path d="m4 4 16 16M9.8 6.3A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.2 2.8M6.4 7.5A15 15 0 0 0 2.5 12s3.5 6 9.5 6c.9 0 1.8-.1 2.6-.4"/></svg>'; }
function formatDistance(km) { return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`; }
function setRouteVisibility(route) { ["casing", "line", "points"].forEach((suffix) => { if (map.getLayer(`${route.id}-${suffix}`)) map.setLayoutProperty(`${route.id}-${suffix}`, "visibility", route.visible ? "visible" : "none"); }); }
function removeRoute(route) { removeRouteLayers(route); routes.splice(routes.indexOf(route), 1); renderRoutes(); }
function removeRouteLayers(route) { ["points", "line", "casing"].forEach((suffix) => { if (map.getLayer(`${route.id}-${suffix}`)) map.removeLayer(`${route.id}-${suffix}`); }); if (map.getSource(route.id)) map.removeSource(route.id); }
function clearAllRoutes() { [...routes].forEach(removeRouteLayers); routes.length = 0; renderRoutes(); }
function fitRoutes(items) { const bounds = new maplibregl.LngLatBounds(); items.forEach((route) => route.geojson.features.forEach((feature) => extendBounds(feature.geometry.coordinates, bounds))); if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 700 }); }
function setDistrictVisibility() { districtsVisible = ui.districts.checked; ["district-fill", "district-outline"].forEach((id) => { if (map?.getLayer(id)) map.setLayoutProperty(id, "visibility", districtsVisible ? "visible" : "none"); }); }
function switchBasemap() { currentBasemap = currentBasemap === "osm" ? "government" : "osm"; map.setStyle(buildStyle(currentBasemap === "government" ? governmentStyle : osmStyle())); ui.basemap.textContent = currentBasemap === "government" ? "Switch to OpenStreetMap" : "Switch to HKSAR map"; ui.credit.textContent = currentBasemap === "government" ? "Map from Lands Department" : "© OpenStreetMap contributors"; }

async function exportMap() {
  ui.export.disabled = true; ui.status.textContent = "Preparing your map…";
  try {
    if (!map.loaded()) await new Promise((resolve) => map.once("idle", resolve));
    const source = map.getCanvas(); const output = document.createElement("canvas"); output.width = source.width; output.height = source.height;
    output.getContext("2d").drawImage(source, 0, 0);
    const blob = await new Promise((resolve) => output.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not create image");
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "trailglass-map.png"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); ui.status.textContent = "";
  } catch (error) { console.error(error); ui.status.textContent = "The map could not be exported. Your map provider may block image export."; }
  finally { ui.export.disabled = false; }
}
function resolveTemplateUrl(template, base) { return new URL(template, base).href.replaceAll("%7B", "{").replaceAll("%7D", "}"); }
function extendBounds(coordinates, bounds) { if (coordinates.length >= 2 && typeof coordinates[0] === "number") { bounds.extend(coordinates); return; } coordinates.forEach((child) => extendBounds(child, bounds)); }
