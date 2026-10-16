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

Then open <http://localhost:8000/>. An internet connection is required for map tiles and browser libraries.

## Deployment

The site is published with GitHub Pages and deployed by the `Deploy GitHub Pages` workflow in `.github/workflows/pages.yml`, which runs on every push to `master` (and can be started manually from the Actions tab). There is no build step: the workflow uploads the repository as the Pages artifact and publishes it as-is.

Once Pages is enabled for the repository, the site is served from the root of the Pages URL, for example <https://wahackr.github.io/GPX-Viewer/>.
