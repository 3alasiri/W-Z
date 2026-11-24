"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

type Pt = { lat: number; lng: number; label: string; color: string } | null;

/** خريطة التوصيل: المتجر والعميل والمندوب، بخرائط OpenStreetMap */
export default function DeliveryMap({ points, height = 260 }: { points: Pt[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const pts = points.filter(Boolean) as NonNullable<Pt>[];
  const key = JSON.stringify(pts);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !el.current) return;
      if (!map.current) {
        map.current = L.map(el.current, { zoomControl: true, attributionControl: true });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
      }
      layer.current!.clearLayers();
      pts.forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 9, color: "#fff", weight: 2, fillColor: p.color, fillOpacity: 1 })
        .bindTooltip(p.label, { permanent: true, direction: "top", offset: [0, -8] }).addTo(layer.current!));
      if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 16 });
      else if (pts.length === 1) map.current.setView([pts[0].lat, pts[0].lng], 15);
    })();
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);
  if (!pts.length) return null;
  return <div ref={el} style={{ height, borderRadius: 12, overflow: "hidden", zIndex: 0, position: "relative" }} />;
}
