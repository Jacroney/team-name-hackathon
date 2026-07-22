import { Maximize2, Radio } from "lucide-react";
import { useEffect, useRef } from "react";
import { flarePriority, geoCirclePolygon, priorityColor } from "../../lib/flarenet";
import type { Incident } from "../../lib/schemas";

interface RegionMapProps {
  incidents: Incident[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpenReport: (id: string) => void;
}

const TRAVIS_CENTER: [number, number] = [-97.56, 30.31];
const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "satellite", type: "raster" as const, source: "satellite" }],
};

export function RegionMap({ incidents, selectedId, onSelect, onOpenReport }: RegionMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | undefined>(undefined);
  const markersRef = useRef<Map<string, HTMLElement>>(new Map());
  const initializedRef = useRef(false);

  // Keep latest callbacks/selection without re-initialising the map.
  const onSelectRef = useRef(onSelect);
  const onOpenReportRef = useRef(onOpenReport);
  const selectedRef = useRef(selectedId);
  onSelectRef.current = onSelect;
  onOpenReportRef.current = onOpenReport;
  selectedRef.current = selectedId;

  const applySelection = (): void => {
    markersRef.current.forEach((el, id) => el.classList.toggle("sel", id === selectedRef.current));
  };

  // Initialise the map once, as soon as incident data is available.
  useEffect(() => {
    if (initializedRef.current) return;
    if (!containerRef.current || !incidents.length || !window.WebGLRenderingContext) return;
    initializedRef.current = true;
    const seeded = incidents;
    let disposed = false;

    void import("maplibre-gl").then((maplibre) => {
      if (disposed || !containerRef.current) return;
      const map = new maplibre.Map({
        container: containerRef.current,
        style: SATELLITE_STYLE,
        center: TRAVIS_CENTER,
        zoom: 10.6,
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibre.AttributionControl({ compact: true }));

      map.on("load", () => {
        const floodFeatures = seeded.map((incident) => {
          const feature = geoCirclePolygon(
            incident.location.coordinates as [number, number],
            incident.floodRadiusMeters ?? 600,
          );
          feature.properties = { color: priorityColor[flarePriority(incident)] };
          return feature;
        });
        map.addSource("flood", { type: "geojson", data: { type: "FeatureCollection", features: floodFeatures } });
        map.addLayer({
          id: "flood-fill",
          type: "fill",
          source: "flood",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "flood-line",
          type: "line",
          source: "flood",
          paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.5 },
        });

        seeded.forEach((incident) => {
          // Wrapper is what MapLibre positions (it sets an inline transform on it);
          // the inner .dot owns the hover/selected scale transforms so they don't
          // clobber the positioning transform and detach the marker from the map.
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
          new maplibre.Marker({ element: wrapper, anchor: "center" })
            .setLngLat(incident.location.coordinates as [number, number])
            .addTo(map);
          markersRef.current.set(incident.id, dot);
        });

        applySelection();
        const selected = seeded.find((incident) => incident.id === selectedRef.current);
        if (selected) map.panTo(selected.location.coordinates as [number, number], { animate: false });
      });
    });

    return () => {
      disposed = true;
    };
  }, [incidents]);

  // Dispose on unmount.
  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = undefined;
      markersRef.current.clear();
      initializedRef.current = false;
    },
    [],
  );

  // Reflect the selected incident: highlight its marker and pan to it.
  useEffect(() => {
    applySelection();
    const incident = incidents.find((item) => item.id === selectedId);
    if (incident && mapRef.current) {
      mapRef.current.panTo(incident.location.coordinates as [number, number], { animate: true });
    }
  }, [selectedId, incidents]);

  const selected = incidents.find((incident) => incident.id === selectedId);

  return (
    <section className="region-map" aria-label="Regional incident map">
      <div className="region-map-canvas" ref={containerRef} />
      <div className="map-glass map-tag">
        <span className="live-dot" aria-hidden="true" />
        Live satellite · <strong>Travis County, TX</strong>
      </div>
      <div className="map-glass map-legend">
        <h4>Legend</h4>
        <div className="legend-row"><span className="legend-sw" style={{ background: "var(--critical)" }} />P1 · Life safety</div>
        <div className="legend-row"><span className="legend-sw" style={{ background: "var(--urgent)" }} />P2 · Urgent</div>
        <div className="legend-row"><span className="legend-sw" style={{ background: "var(--success)" }} />Resolved</div>
        <div className="legend-row"><span className="legend-sw" style={{ background: "var(--routine)", opacity: 0.6 }} />Flood zone</div>
      </div>
      {selected && (
        <button type="button" className="map-open-report" onClick={() => onOpenReport(selected.id)}>
          <Maximize2 size={13} aria-hidden="true" /> Open full report · {selected.id}
        </button>
      )}
      {!selected && (
        <div className="map-glass map-hint"><Radio size={12} aria-hidden="true" /> Select an incident marker</div>
      )}
    </section>
  );
}
