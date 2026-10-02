# Hong Kong district boundary map

A small browser-based viewer for the 18 district polygons in
`resources/hksar_18_district_boundary.json`. It uses the Hong Kong Lands
Department WGS84 Vector Map API as its base map.

## Run it

From this directory, start any static HTTP server. Python already includes one:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/src/>.

The page uses MapLibre GL JS and the Hong Kong Lands Department Vector Map API,
so an internet connection is required for the map background. No API key is
needed. Use of the government map is subject to the Lands Department Map API
terms and attribution requirements.

Do not open `src/index.html` directly as a `file://` URL: browsers commonly block
the JavaScript request that loads the GeoJSON file.
