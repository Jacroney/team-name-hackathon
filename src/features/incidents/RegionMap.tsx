import { ArrowsOut, GlobeHemisphereWest, Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { flarePriority, geoCirclePolygon, priorityColor } from "../../lib/flarenet";
import type { Incident } from "../../lib/schemas";

interface RegionMapProps {
  incidents: Incident[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpenReport: (id: string) => void;
}

const TRAVIS_CENTER: [number, number] = [-97.56, 30.31];

type Basemap = "dark" | "light" | "satellite";

const rasterStyle = (tiles: string[], attribution: string): StyleSpecification => ({
  version: 8,
  sources: { base: { type: "raster", tiles, tileSize: 256, attribution } },
  layers: [{ id: "base", type: "raster", source: "base" }],
});

const BASEMAPS: Record<Basemap, StyleSpecification> = {
  dark: rasterStyle(
    [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ],
    "&copy; OpenStreetMap &copy; CARTO",
  ),
  light: rasterStyle(
    [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ],
    "&copy; OpenStreetMap &copy; CARTO",
  ),
  satellite: rasterStyle(
    ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    "Imagery &copy; Esri, Maxar, Earthstar Geographics",
  ),
};

const BASEMAP_META: Array<{ id: Basemap; label: string; Icon: typeof Moon }> = [
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "light", label: "Light", Icon: Sun },
  { id: "satellite", label: "Satellite", Icon: GlobeHemisphereWest },
];

export function RegionMap({ incidents, selectedId, onSelect, onOpenReport }: RegionMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | undefined>(undefined);
  const maplibreRef = useRef<typeof import("maplibre-gl") | undefined>(undefined);
  const markersRef = useRef<Map<string, HTMLElement>>(new Map());
  const markerInstancesRef = useRef<Map<string, import("maplibre-gl").Marker>>(new Map());
  const mapReadyRef = useRef(false);
  const fittedRef = useRef(false);
  const initializedRef = useRef(false);
  const [basemap, setBasemap] = useState<Basemap>("dark");

  const onSelectRef = useRef(onSelect);
  const onOpenReportRef = useRef(onOpenReport);
  const selectedRef = useRef(selectedId);
  const incidentsRef = useRef(incidents);
  onSelectRef.current = onSelect;
  onOpenReportRef.current = onOpenReport;
  selectedRef.current = selectedId;
  incidentsRef.current = incidents;

  const applySelection = (): void => {
    markersRef.current.forEach((el, id) => el.classList.toggle("sel", id === selectedRef.current));
  };

  // Create / update / remove markers so streamed incidents always get pins.
  const syncMarkers = (map: import("maplibre-gl").Map): void => {
    const maplibre = maplibreRef.current;
    if (!maplibre) return;
    const present = new Set<string>();

    incidentsRef.current.forEach((incident) => {
      present.add(incident.id);
      const existing = markersRef.current.get(incident.id);
      if (existing) {
        existing.className = `dot ${flarePriority(incident)}`;
        markerInstancesRef.current
          .get(incident.id)
          ?.setLngLat(incident.location.coordinates as [number, number]);
        return;
      }
      const wrapper = document.createElement("div");
      wrapper.className = "marker-wrap";
      const dot = document.createElement("div");
      dot.className = `dot ${flarePriority(incident)}`;
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", `${incident.id} ${incident.location.address}`);
      dot.innerHTML = '<span class="ring"></span>';
      wrapper.appendChild(dot);
      wrapper.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(incident.id);
      });
      wrapper.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        onOpenReportRef.current(incident.id);
      });
      const marker = new maplibre.Marker({ element: wrapper, anchor: "center" })
        .setLngLat(incident.location.coordinates as [number, number])
        .addTo(map);
      markersRef.current.set(incident.id, dot);
      markerInstancesRef.current.set(incident.id, marker);
    });

    // Drop markers for incidents no longer present.
    markerInstancesRef.current.forEach((marker, id) => {
      if (present.has(id)) return;
      marker.remove();
      markerInstancesRef.current.delete(id);
      markersRef.current.delete(id);
    });

    applySelection();
  };

  // Fit the viewport to wherever the incidents actually are (once).
  const fitToIncidents = (map: import("maplibre-gl").Map): void => {
    const maplibre = maplibreRef.current;
    const list = incidentsRef.current;
    if (!maplibre || !list.length) return;
    const bounds = new maplibre.LngLatBounds();
    list.forEach((incident) => bounds.extend(incident.location.coordinates as [number, number]));
    if (list.length === 1) {
      map.easeTo({ center: bounds.getCenter(), zoom: 12.5, duration: 500 });
    } else {
      map.fitBounds(bounds, { padding: 120, maxZoom: 13, duration: 500 });
    }
  };

  // Adds/updates the flood-zone overlay. Re-run after every setStyle (which clears sources).
  const addOverlays = (map: import("maplibre-gl").Map): void => {
    const features = incidentsRef.current.map((incident) => {
      const feature = geoCirclePolygon(
        incident.location.coordinates as [number, number],
        incident.floodRadiusMeters ?? 600,
      );
      feature.properties = { color: priorityColor[flarePriority(incident)] };
      return feature;
    });
    const data = { type: "FeatureCollection" as const, features };
    const source = map.getSource("flood") as import("maplibre-gl").GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource("flood", { type: "geojson", data });
    map.addLayer({
      id: "flood-fill",
      type: "fill",
      source: "flood",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 },
    });
    map.addLayer({
      id: "flood-line",
      type: "line",
      source: "flood",
      paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.45 },
    });
  };

  useEffect(() => {
    if (initializedRef.current) return;
    if (!containerRef.current || !incidents.length || !window.WebGLRenderingContext) return;
    initializedRef.current = true;
    let disposed = false;

    void import("maplibre-gl").then((maplibre) => {
      if (disposed || !containerRef.current) return;
      maplibreRef.current = maplibre;
      const map = new maplibre.Map({
        container: containerRef.current,
        style: BASEMAPS.dark,
        center: TRAVIS_CENTER,
        zoom: 10.6,
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibre.AttributionControl({ compact: true }));

      // Re-add overlays whenever the basemap style finishes (re)loading.
      map.on("styledata", () => {
        if (mapReadyRef.current) addOverlays(map);
      });

      map.on("load", () => {
        mapReadyRef.current = true;
        addOverlays(map);
        syncMarkers(map);
        if (!fittedRef.current) {
          fittedRef.current = true;
          fitToIncidents(map);
        }
        const selected = incidentsRef.current.find((incident) => incident.id === selectedRef.current);
        if (selected) map.panTo(selected.location.coordinates as [number, number], { animate: false });
      });
    });

    return () => {
      disposed = true;
    };
  }, [incidents]);

  // Keep markers + overlays in sync as incidents stream in.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    syncMarkers(map);
    addOverlays(map);
    if (!fittedRef.current) {
      fittedRef.current = true;
      fitToIncidents(map);
    }
  }, [incidents]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = undefined;
      markersRef.current.clear();
      initializedRef.current = false;
    },
    [],
  );

  // Switch basemap style on demand.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(BASEMAPS[basemap]);
  }, [basemap]);

  useEffect(() => {
    applySelection();
    const incident = incidents.find((item) => item.id === selectedId);
    if (incident && mapRef.current) {
      mapRef.current.panTo(incident.location.coordinates as [number, number], { animate: true });
    }
  }, [selectedId, incidents]);

  const selected = incidents.find((incident) => incident.id === selectedId);

  return (
    <section className="region-map" aria-label="Regional incident map" data-basemap={basemap}>
      <div className="region-map-canvas" ref={containerRef} />

      <div className="map-basemap-switch" role="group" aria-label="Basemap style">
        {BASEMAP_META.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            data-active={basemap === id || undefined}
            onClick={() => setBasemap(id)}
            aria-pressed={basemap === id}
          >
            <Icon size={14} weight="bold" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="map-legend-pill" aria-hidden="true">
        <span className="lg"><i style={{ background: "var(--critical)" }} /> Critical</span>
        <span className="lg"><i style={{ background: "var(--urgent)" }} /> Urgent</span>
        <span className="lg"><i style={{ background: "var(--routine)" }} /> Routine</span>
      </div>

      {selected && (
        <button type="button" className="map-open-report" onClick={() => onOpenReport(selected.id)}>
          <ArrowsOut size={14} weight="bold" aria-hidden="true" /> Open report
        </button>
      )}
    </section>
  );
}
