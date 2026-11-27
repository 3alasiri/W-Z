"use client";
import { useEffect, useState } from "react";
import { THEMES, FONTS, applyAppearance } from "@/lib/appearance";

function useAppearance() {
  const [theme, setTheme] = useState("auto");
  const [font, setFont] = useState("tajawal");
  useEffect(() => {
    try { setTheme(localStorage.getItem("ui-theme") || "auto"); setFont(localStorage.getItem("ui-font") || "tajawal"); } catch {}
  }, []);
  useEffect(() => {
    if (theme !== "auto") return;
    const m = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyAppearance("auto", font);
    m.addEventListener("change", on); return () => m.removeEventListener("change", on);
  }, [theme, font]);
  const set = (t: string, f: string) => { setTheme(t); setFont(f); applyAppearance(t, f); };
  return { theme, font, set };
}

/** لوحة كاملة لصفحة الإعدادات */
export default function Appearance() {
  const { theme, font, set } = useAppearance();
  return (
    <div className="appear">
      <div className="swatches">{THEMES.map((t) => (
        <button key={t.id} className={`swatch ${theme === t.id ? "on" : ""}`} onClick={() => set(t.id, font)} aria-pressed={theme === t.id}>
          <span className="dots">{t.sw.map((c) => <span key={c} style={{ background: c }} />)}</span>
          <b>{t.name}</b><small>{t.hint}</small>
        </button>))}</div>
      <div className="fontpick">{FONTS.map((f) => (
        <button key={f.id} className={font === f.id ? "on" : ""} style={{ fontFamily: `"${f.family}", Tahoma, sans-serif` }}
          onClick={() => set(theme, f.id)} aria-pressed={font === f.id}>{f.name} · أبجد هوز ١٢٣</button>))}</div>
    </div>
  );
}

/** نسخة مصغرة لأسفل القائمة الجانبية */
export function AppearanceMini() {
  const { theme, font, set } = useAppearance();
  return (
    <div className="list" style={{ gap: 8 }}>
      <div className="appear-mini" role="group" aria-label="المظهر">{THEMES.map((t) => (
        <button key={t.id} title={t.name} aria-label={t.name} className={theme === t.id ? "on" : ""} onClick={() => set(t.id, font)}
          style={{ background: t.id === "auto" ? `linear-gradient(135deg, ${t.sw[0]} 50%, ${t.sw[2]} 50%)` : `linear-gradient(135deg, ${t.sw[0]} 45%, ${t.sw[1]} 45%)` }} />))}</div>
      <select value={font} onChange={(e) => set(theme, e.target.value)} aria-label="الخط">
        {FONTS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
    </div>
  );
}
