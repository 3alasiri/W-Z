"use client";
import { useEffect, useRef, useState } from "react";

/** حقل باركود يدعم قارئ USB (يكتب ثم Enter) ومسح الكاميرا */
export default function BarcodeInput({ onScan, placeholder = "امسح الباركود أو اكتبه ثم Enter", autoFocus = true }:
  { onScan: (code: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [val, setVal] = useState("");
  const [cam, setCam] = useState(false);
  const [camErr, setCamErr] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cam) return;
    let stop: (() => void) | undefined;
    let last = "";
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const ctrl = await reader.decodeFromVideoDevice(undefined, video.current!, (res) => {
          const t = res?.getText();
          if (t && t !== last) { last = t; onScan(t); setTimeout(() => (last = ""), 1500); }
        });
        stop = () => ctrl.stop();
      } catch {
        setCamErr("تعذّر تشغيل الكاميرا. اسمح بالوصول إليها أو استخدم قارئ الباركود.");
        setCam(false);
      }
    })();
    return () => stop?.();
  }, [cam, onScan]);

  return (
    <div className="list">
      <form className="scan" onSubmit={(e) => { e.preventDefault(); if (val.trim()) { onScan(val.trim()); setVal(""); input.current?.focus(); } }}>
        <input ref={input} value={val} onChange={(e) => setVal(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} inputMode="numeric" autoComplete="off" aria-label="الباركود" />
        <button className="btn">إضافة</button>
        <button type="button" className="btn ghost" onClick={() => { setCamErr(""); setCam(!cam); }}>{cam ? "إيقاف الكاميرا" : "الكاميرا"}</button>
      </form>
      {cam && <video ref={video} className="cam" muted playsInline />}
      {camErr && <div className="err">{camErr}</div>}
    </div>
  );
}
