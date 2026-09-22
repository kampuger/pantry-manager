'use client';

import { useEffect, useRef, useState } from 'react';
import { BarcodeDetector, setZXingModuleOverrides } from 'barcode-detector/ponyfill';
import { color, radius, cardStyle, buttonStyle, modalOverlayStyle } from '@/lib/theme';

const DEDUPE_WINDOW_MS = 2000;
const PRODUCT_BARCODE_FORMATS = ['upc_a', 'upc_e', 'ean_13', 'ean_8'] as const;

// Number of consecutive per-frame detect() failures before we treat the
// decoder as permanently broken (e.g. its WASM binary never loaded) rather
// than just having hit one blurry frame, and surface that to the user.
const CONSECUTIVE_FAILURE_THRESHOLD = 15;

// zxing-wasm defaults to fetching zxing_reader.wasm from the jsDelivr CDN at
// runtime. That fetch silently fails under a strict CSP, offline, or a
// blocked CDN — so we self-host the binary (mirrors packages/ocr's
// tesseract worker/core pinning) and only fall back to the default
// prefix+path behavior for any non-wasm file it might request.
setZXingModuleOverrides({
  locateFile: (path, prefix) => (path.endsWith('.wasm') ? `/zxing/${path}` : prefix + path),
});

export function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (barcode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastDetection = useRef<{ code: string; at: number } | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let consecutiveFailures = 0;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch (playErr) {
            // getUserMedia already granted the camera — if playback then
            // fails, stop those tracks too, or the camera indicator light
            // stays on even though the <video> unmounts on error below.
            stream.getTracks().forEach((track) => track.stop());
            throw playErr;
          }
        }

        const detector = new BarcodeDetector({ formats: [...PRODUCT_BARCODE_FORMATS] });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (cancelled) return;
            consecutiveFailures = 0;
            const code = codes[0]?.rawValue;
            if (code) {
              const now = Date.now();
              const last = lastDetection.current;
              if (!last || last.code !== code || now - last.at > DEDUPE_WINDOW_MS) {
                lastDetection.current = { code, at: now };
                setFlash(true);
                if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
                flashTimeoutRef.current = setTimeout(() => setFlash(false), 200);
                onDetect(code);
              }
            }
          } catch {
            // A single failed decode pass (e.g. a blurry mid-motion frame)
            // isn't fatal — the loop just tries again next frame. But if
            // detect() never succeeds, that's a sign the decoder itself
            // never loaded (e.g. its WASM fetch failed), not that frames
            // are blurry — surface that instead of a silently-dead feed.
            consecutiveFailures += 1;
            if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
              if (!cancelled) {
                setError('Barcode scanner failed to load. Try closing and reopening the scanner.');
              }
              return;
            }
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not access the camera.');
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
    // onDetect must stay referentially stable (see BulkAddModal's
    // handleBarcodeDetected) — an unstable reference here would tear down
    // and re-acquire the camera on every parent re-render.
  }, [onDetect]);

  return (
    <div style={modalOverlayStyle(60)}>
      <div style={{ ...cardStyle, width: '100%', maxWidth: 480, padding: 24, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: color.foreground }}>Scan barcode</h2>
          <button type="button" onClick={onClose} style={buttonStyle('secondary')}>
            Done
          </button>
        </div>

        {error ? (
          <p style={{ margin: 0, fontSize: 13, color: color.destructive }}>{error}</p>
        ) : (
          <div
            style={{
              position: 'relative',
              borderRadius: radius.md,
              overflow: 'hidden',
              border: `2px solid ${flash ? color.primary : color.border}`,
              transition: 'border-color 150ms ease',
            }}
          >
            <video ref={videoRef} muted playsInline style={{ width: '100%', display: 'block' }} />
          </div>
        )}

        <p style={{ margin: 0, fontSize: 13, color: color.mutedForeground }}>
          Point the camera at a barcode. Each scan adds a row — tap Done when you&rsquo;re finished.
        </p>
      </div>
    </div>
  );
}
