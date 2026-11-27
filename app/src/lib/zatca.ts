/** رمز QR للفاتورة الضريبية المبسطة (المرحلة الأولى من الفوترة الإلكترونية): حقول TLV مرمزة Base64 */
export function zatcaQrPayload(f: { seller: string; vatNumber: string; time: string; total: number | string; vat: number | string }) {
  const enc = new TextEncoder();
  const fields = [f.seller, f.vatNumber, new Date(f.time).toISOString().replace(/\.\d{3}Z$/, "Z"), Number(f.total).toFixed(2), Number(f.vat).toFixed(2)];
  const bytes: number[] = [];
  fields.forEach((v, i) => {
    const b = enc.encode(v);
    if (b.length > 255) throw new Error("حقل طويل جدًا في رمز الفاتورة");
    bytes.push(i + 1, b.length, ...b);
  });
  let bin = "";
  bytes.forEach((x) => (bin += String.fromCharCode(x)));
  return btoa(bin);
}
