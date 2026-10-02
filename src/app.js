const GOVERNMENT_STYLE_URL =
  "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/resources/styles/root.json";
const GOVERNMENT_TILE_URL =
  "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf";
const DISTRICT_URL = "../resources/hksar_18_district_boundary.json";
const DISTRICT_SOURCE = "hong-kong-districts";
const DISTRICT_FILL = "district-fill";

const status = document.querySelector("#status");
const basemapToggle = document.querySelector("#basemap-toggle");
const landsDepartmentCredit = document.querySelector(".landsd-credit");
let map;
let governmentStyle;
let districtGeojson;
let currentBasemap = "government";
let hoveredDistrictId = null;
let hoverPopup = null;

start().catch((error) => {
  console.error(error);
  status.textContent = "Could not load the government map or district boundaries.";
});

async function start() {
  const [styleResponse, districtResponse] = await Promise.all([
    fetch(GOVERNMENT_STYLE_URL),
    fetch(DISTRICT_URL),
  ]);
  if (!styleResponse.ok) throw new Error(`Government map style: HTTP ${styleResponse.status}`);
  if (!districtResponse.ok) throw new Error(`District boundaries: HTTP ${districtResponse.status}`);

  governmentStyle = await styleResponse.json();
  districtGeojson = await districtResponse.json();

  // The published style points to a relative TileJSON endpoint that returns an
  // HTML page in MapLibre. Use the documented PBF tile template directly.
  governmentStyle.sources.esri = {
    type: "vector",
    tiles: [GOVERNMENT_TILE_URL],
    bounds: [113.236, 21.6661, 114.975, 23.043],
    minzoom: 9,
    maxzoom: 15,
    attribution:
      '<a href="https://api.portal.hkmapservice.gov.hk/disclaimer" target="_blank" rel="noopener">Map from Lands Department</a>',
  };
  governmentStyle.glyphs = resolveTemplateUrl(governmentStyle.glyphs, GOVERNMENT_STYLE_URL);

  map = new maplibregl.Map({
    container: "map",
    style: styleWithDistricts(governmentStyle),
    center: [114.16, 22.34],
    zoom: 9.5,
    minZoom: 9,
    maxZoom: 15,
    attributionControl: false,
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(
    new maplibregl.AttributionControl({ compact: true }),
  );
  map.on("error", (event) => console.error("Map error", event.error));
  map.on("load", () => {
    registerDistrictEvents();
    map.fitBounds(getGeoJsonBounds(districtGeojson), { padding: 35, duration: 0 });
    status.textContent = "";
    basemapToggle.disabled = false;
  });
  basemapToggle.addEventListener("click", switchBasemap);
}

function styleWithDistricts(baseStyle) {
  const style = structuredClone(baseStyle);
  style.sources[DISTRICT_SOURCE] = {
      type: "geojson",
      data: districtGeojson,
      generateId: true,
  };
  style.layers.push(
    {
      id: DISTRICT_FILL,
      type: "fill",
      source: DISTRICT_SOURCE,
      paint: {
        "fill-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ef5350", "#42a5f5"],
        "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.3, 0.16],
      },
    },
    {
      id: "district-outline",
      type: "line",
      source: DISTRICT_SOURCE,
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#c62828", "#1769aa"],
        "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4, 2],
      },
    },
  );
  return style;
}

function switchBasemap() {
  currentBasemap = currentBasemap === "government" ? "openstreetmap" : "government";
  hoverPopup?.remove();
  hoverPopup = null;
  hoveredDistrictId = null;

  const showingGovernment = currentBasemap === "government";
  const baseStyle = showingGovernment ? governmentStyle : openStreetMapStyle();
  map.setStyle(styleWithDistricts(baseStyle));
  basemapToggle.textContent = showingGovernment ? "Use OpenStreetMap" : "Use HKSAR Map";
  landsDepartmentCredit.hidden = !showingGovernment;
}

function openStreetMapStyle() {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}

function registerDistrictEvents() {
  map.on("mousemove", DISTRICT_FILL, (event) => {
    if (!event.features?.length) return;
    const feature = event.features[0];

    if (hoveredDistrictId !== null && hoveredDistrictId !== feature.id) {
      map.setFeatureState({ source: DISTRICT_SOURCE, id: hoveredDistrictId }, { hover: false });
    }
    hoveredDistrictId = feature.id;
    map.setFeatureState({ source: DISTRICT_SOURCE, id: hoveredDistrictId }, { hover: true });
    map.getCanvas().style.cursor = "pointer";

    hoverPopup?.remove();
    hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "district-tooltip",
    })
      .setLngLat(event.lngLat)
      .setHTML(districtName(feature.properties))
      .addTo(map);
  });

  map.on("mouseleave", DISTRICT_FILL, () => {
    if (hoveredDistrictId !== null) {
      map.setFeatureState({ source: DISTRICT_SOURCE, id: hoveredDistrictId }, { hover: false });
    }
    hoveredDistrictId = null;
    map.getCanvas().style.cursor = "";
    hoverPopup?.remove();
    hoverPopup = null;
  });

}

function resolveTemplateUrl(template, baseUrl) {
  return new URL(template, baseUrl).href
    .replaceAll("%7B", "{")
    .replaceAll("%7D", "}");
}

function districtName(properties = {}) {
  const englishName = properties.District ?? "Unknown district";
  const chineseName = properties["地區"] ?? "";
  return `<strong>${escapeHtml(englishName)}</strong><br>${escapeHtml(chineseName)}`;
}

function getGeoJsonBounds(geojson) {
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of geojson.features) {
    for (const ring of feature.geometry.coordinates) {
      for (const coordinate of ring) bounds.extend(coordinate);
    }
  }
  return bounds;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}
