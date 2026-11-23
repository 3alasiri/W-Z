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
