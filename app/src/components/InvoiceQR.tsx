"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { zatcaQrPayload } from "@/lib/zatca";

export default function InvoiceQR({ seller, vatNumber, time, total, vat, size = 140 }: { seller: string; vatNumber: string | null; time: string; total: number; vat: number; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!vatNumber) return;
    QRCode.toDataURL(zatcaQrPayload({ seller, vatNumber, time, total, vat }), { margin: 1, width: size * 2, errorCorrectionLevel: "M" }).then(setSrc).catch(() => setSrc(""));
  }, [seller, vatNumber, time, total, vat, size]);
  if (!vatNumber) return <div className="muted" style={{ fontSize: 11, textAlign: "center" }}>أضف الرقم الضريبي في الإعدادات لإظهار رمز الفاتورة الإلكترونية.</div>;
  return src ? <img src={src} width={size} height={size} alt="رمز QR للفاتورة الضريبية" style={{ display: "block", margin: "0 auto" }} /> : null;
}
