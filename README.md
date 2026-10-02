# Trailglass GPX Viewer

A private, browser-based GPX viewer for inspecting tracks and routes on a map. Files are parsed locally and never uploaded to a server.

## Features

- Drag-and-drop or browse for multiple `.gpx` files
- Open ZIP archives containing GPX files
- Display tracks, routes, and named waypoints
- Calculate distance, elevation gain, and point count
- Focus, hide, show, remove, or clear routes independently
- Switch between OpenStreetMap and the HKSAR Lands Department basemap
- Optionally show Hong Kong's 18 district boundaries
- Export the current map as a PNG

## Run locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/src/>. An internet connection is required for map tiles and browser libraries.
