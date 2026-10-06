import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, Textarea } from './ui.jsx';

/** Extracts { resource, token } from a scanned venue QR (a check-in URL) or a pasted token/link. */
export function parseCheckInCode(text) {
  const value = text.trim();
  try {
    const url = new URL(value);
    const token = url.searchParams.get('token');
    if (token) return { token, resource: url.searchParams.get('resource') };
  } catch {
    /* not a URL */
  }
  return value.split('.').length === 3 ? { token: value, resource: null } : null;
}

/**
 * Camera QR scanner (html5-qrcode, loaded on demand) with a manual fallback
 * for devices without a camera — paste the link shown under the venue code.
 */
export default function QrScanner({ onCode, busy }) {
  const scannerRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let cancelled = false;
    let scanner;
    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        scanner = new Html5Qrcode('qr-reader', { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decoded) => {
            const parsed = parseCheckInCode(decoded);
            if (parsed) onCodeRef.current(parsed);
          },
          () => {},
        );
        if (!cancelled) setScanning(true);
      } catch (error) {
        if (!cancelled) setCameraError(typeof error === 'string' ? error : error?.message || 'Camera unavailable');
      }
    })();
    return () => {
      cancelled = true;
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
  }, []);

  const submitManual = () => {
    const parsed = parseCheckInCode(manual);
    if (!parsed) return setManualError('Paste the full check-in link or code shown at the venue.');
    setManualError(null);
    onCode(parsed);
  };

  return (
    <div className="space-y-4">
      <div>
        <div id="qr-reader" className="mx-auto w-full max-w-xs overflow-hidden rounded-xl bg-slate-900/5" />
        {scanning && <p className="mt-2 text-center text-sm text-slate-500">Point your camera at the QR code displayed at the venue.</p>}
        {cameraError && (
          <Alert tone="info" className="mt-2">
            Camera not available ({cameraError}). Paste the code instead.
          </Alert>
        )}
      </div>
      <Field label="Or paste the check-in link" htmlFor="manual-code" error={manualError}>
        <Textarea id="manual-code" rows={2} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="https://…/check-in?resource=…&token=…" />
      </Field>
      <Button onClick={submitManual} disabled={!manual.trim()} loading={busy} loadingText="Checking in…" className="w-full">
        Check in with this code
      </Button>
    </div>
  );
}
