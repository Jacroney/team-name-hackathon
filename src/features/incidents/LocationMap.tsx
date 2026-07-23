import { Crosshair, MapPin } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

interface LocationMapProps {
  address: string;
  district: string;
  coordinates: [number, number];
}

export function LocationMap({ address, district, coordinates }: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !window.WebGLRenderingContext) return;
    let disposed = false;
    let map: import("maplibre-gl").Map | undefined;

    void import("maplibre-gl").then((maplibre) => {
      if (disposed || !containerRef.current) return;
      map = new maplibre.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            satellite: {
              type: "raster",
              tiles: [
                "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              ],
              tileSize: 256,
              attribution:
                "Imagery &copy; Esri, Maxar, Earthstar Geographics",
            },
          },
          layers: [{ id: "satellite", type: "raster", source: "satellite" }],
        },
        center: coordinates,
        zoom: 14.2,
        attributionControl: false,
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibre.AttributionControl({ compact: true }));

      const marker = document.createElement("div");
      marker.className = "map-incident-marker";
      marker.setAttribute("aria-label", "Incident location");
      new maplibre.Marker({ element: marker }).setLngLat(coordinates).addTo(map);
      map.once("load", () => setLoaded(true));
    });

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [coordinates]);

  return (
    <section className="location-map" aria-label="Incident location map">
      <div className="map-canvas" ref={containerRef} data-loaded={loaded || undefined}>
        <div className="map-fallback" aria-hidden="true">
          <span className="map-road horizontal one" />
          <span className="map-road horizontal two" />
          <span className="map-road vertical one" />
          <span className="map-road vertical two" />
          <MapPin size={24} />
        </div>
        <div className="map-coordinates"><Crosshair size={12} /> {coordinates[1].toFixed(4)}, {coordinates[0].toFixed(4)}</div>
      </div>
      <div className="map-address">
        <MapPin size={17} aria-hidden="true" />
        <div><strong>{address}</strong><span>{district}</span></div>
      </div>
    </section>
  );
}
