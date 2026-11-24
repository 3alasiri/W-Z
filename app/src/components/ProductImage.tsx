"use client";
import { useState } from "react";

const HUES: Record<string, number> = { "ألبان": 210, "مخبوزات": 32, "مشروبات": 190, "مواد غذائية": 12, "سناكس": 45, "منظفات": 260, "مجمدات": 200 };

/** صورة المنتج على خلفية بيضاء بنسبة ثابتة، مع بديل أنيق عند غياب الصورة */
export default function ProductImage({ src, name, category, size }: { src?: string | null; name: string; category?: string | null; size?: number }) {
  const [bad, setBad] = useState(false);
  const style = size ? { width: size, height: size, flex: "none" as const } : undefined;
  if (src && !bad) return (
    <div className="pimg" style={style}><img src={src} alt={name} loading="lazy" decoding="async" onError={() => setBad(true)} /></div>
  );
  const h = HUES[category ?? ""] ?? 220;
  return (
    <div className="pimg ph" style={{ ...style, background: `linear-gradient(145deg, hsl(${h} 70% 96%), hsl(${h} 55% 88%))`, color: `hsl(${h} 45% 35%)` }} aria-label={name}>
      <span style={{ fontSize: size ? Math.max(12, size / 2.6) : undefined }}>{name.trim().slice(0, 1)}</span>
    </div>
  );
}
