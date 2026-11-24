export const THEMES = [
  { id: "auto", name: "تلقائي", hint: "يتبع إعداد جهازك", sw: ["#f4f6f2", "#1f6b4a", "#101814"] },
  { id: "mint", name: "نعناع", hint: "فاتح منعش", sw: ["#f4f6f2", "#1f6b4a", "#e0a526"] },
  { id: "sand", name: "رمل", hint: "دافئ هادئ", sw: ["#f7f1e7", "#9a5b2a", "#2f6f73"] },
  { id: "night", name: "ليل", hint: "داكن مريح", sw: ["#0f1512", "#4cc38a", "#f0b84d"] },
  { id: "ocean", name: "محيط", hint: "داكن أزرق", sw: ["#0b1220", "#5aa9ff", "#ffcf6a"] },
] as const;

export const FONTS = [
  { id: "tajawal", name: "تجوال", family: "Tajawal" },
  { id: "plex", name: "IBM Plex عربي", family: "IBM Plex Sans Arabic" },
  { id: "cairo", name: "القاهرة", family: "Cairo" },
  { id: "almarai", name: "المراعي", family: "Almarai" },
  { id: "readex", name: "ريدكس", family: "Readex Pro" },
] as const;

export const FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;700&family=Cairo:wght@400;600;700&family=Almarai:wght@400;700;800&family=Readex+Pro:wght@400;500;700&display=swap";

/** يُنفَّذ قبل عرض الصفحة لتطبيق المظهر والخط المحفوظين دون وميض */
export const BOOT_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem('ui-theme')||'auto',f=localStorage.getItem('ui-font')||'tajawal';
if(t==='auto'){t=matchMedia('(prefers-color-scheme: dark)').matches?'night':'mint'}d.setAttribute('data-theme',t);d.setAttribute('data-font',f)}catch(e){}})()`;

export function applyAppearance(theme: string, font: string) {
  const d = document.documentElement;
  const t = theme === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "mint") : theme;
  d.setAttribute("data-theme", t); d.setAttribute("data-font", font);
  try { localStorage.setItem("ui-theme", theme); localStorage.setItem("ui-font", font); } catch {}
}
