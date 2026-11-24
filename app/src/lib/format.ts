export const SAR = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ر.س";
export const num = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString("ar-SA", { maximumFractionDigits: 3 });
export const daysTo = (d: string) => Math.round((new Date(d + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);
export const expiryLabel = (d: string) => {
  const n = daysTo(d);
  if (n < 0) return "منتهي";
  if (n === 0) return "ينتهي اليوم";
  return `خلال ${num(n)} يوم`;
};
export const PO_STATUS: Record<string, [string, string]> = {
  draft: ["مسودة تحتاج اعتماد", "p-warn"], approved: ["معتمد", "p-info"], sent: ["أُرسل للمورد", "p-info"],
  partial: ["استلام جزئي", "p-warn"], received: ["مستلم", "p-ok"], cancelled: ["ملغى", "p-bad"],
};
export const PAY: Record<string, string> = { cash: "نقدًا", card: "مدى / بنك", credit: "آجل" };
export const today = () => new Date().toISOString().slice(0, 10);
export const ORDER_STATUS: Record<string, [string, string]> = {
  new: ["جديد", "p-bad"], preparing: ["قيد التجهيز", "p-warn"], ready: ["جاهز", "p-info"],
  out_for_delivery: ["مع المندوب", "p-info"], delivered: ["تم التسليم", "p-ok"], cancelled: ["ملغى", "p-bad"],
};
export const ROLES: Record<string, string> = { owner: "مالك", manager: "مدير", cashier: "كاشير", stock: "أمين مخزون", driver: "مندوب توصيل" };
export const mapsLink = (lat?: number | null, lng?: number | null, address?: string | null) =>
  lat != null && lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
