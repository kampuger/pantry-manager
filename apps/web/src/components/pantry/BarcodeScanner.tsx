'use client';

import { useEffect, useRef, useState } from 'react';
import { BarcodeDetector } from 'barcode-detector/ponyfill';
import { color, radius, cardStyle, buttonStyle } from '@/lib/theme';

const DEDUPE_WINDOW_MS = 2000;
const PRODUCT_BARCODE_FORMATS = ['upc_a', 'upc_e', 'ean_13', 'ean_8'] as const;

export function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (barcode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastDetection = useRef<{ code: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream: MediaStream | null = null;
    const timeoutIds: NodeJS.Timeout[] = [];

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = new BarcodeDetector({ formats: [...PRODUCT_BARCODE_FORMATS] });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (cancelled) return;
            const code = codes[0]?.rawValue;
            if (code) {
              const now = Date.now();
              const last = lastDetection.current;
              if (!last || last.code !== code || now - last.at > DEDUPE_WINDOW_MS) {
                lastDetection.current = { code, at: now };
                setFlash(true);
                const timeoutId = setTimeout(() => setFlash(false), 200);
                timeoutIds.push(timeoutId);
                onDetect(code);
              }
            }
          } catch {
            // A single failed decode pass (e.g. a blurry mid-motion frame)
            // isn't fatal — the loop just tries again next frame.
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
      timeoutIds.forEach((id) => clearTimeout(id));
    };
  }, [onDetect]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto',
        zIndex: 60,
      }}
    >
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
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
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
