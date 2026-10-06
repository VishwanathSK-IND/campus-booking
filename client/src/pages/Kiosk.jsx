import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { resourceApi } from '../api/endpoints.js';
import { ErrorState, Loading } from '../components/ui.jsx';

/**
 * Venue display (tablet/laptop at the door). Shows a rotating, short-lived,
 * resource-bound check-in QR. A photo of the code stops working within the
 * token lifetime, so check-in effectively requires being at the venue.
 */
export default function Kiosk() {
  const { resourceId } = useParams();
  const [now, setNow] = useState(Date.now());
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['kiosk-token', resourceId],
    queryFn: () => resourceApi.checkInToken(resourceId),
    // Refresh well before expiry so the displayed code is always valid.
    refetchInterval: (query) => Math.max(5_000, ((query.state.data?.ttlSeconds || 60) * 1000) / 2),
    refetchIntervalInBackground: true,
    gcTime: 0,
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (isPending) return <Loading label="Generating check-in code…" />;
  if (isError) return <div className="p-8"><ErrorState error={error} onRetry={refetch} /></div>;

  const secondsLeft = Math.max(0, Math.round((new Date(data.expiresAt).getTime() - now) / 1000));
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 p-6 text-center text-white">
      <p className="text-sm tracking-widest text-slate-400 uppercase">Scan to check in</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{data.resource.name}</h1>
      <p className="text-slate-400">{data.resource.location}</p>
      <div className="mt-8 rounded-2xl bg-white p-5 shadow-2xl">
        <QRCodeSVG value={data.checkInUrl} size={300} level="M" marginSize={1} />
      </div>
      <p className="mt-6 text-sm text-slate-300">
        This code changes automatically · current code valid for <span className="font-mono">{secondsLeft}s</span>
      </p>
      <details className="mt-6 max-w-xl text-left text-xs text-slate-400">
        <summary className="cursor-pointer text-center">No camera? Show the check-in link</summary>
        <p className="mt-2 break-all rounded bg-slate-800 p-2 font-mono select-all">{data.checkInUrl}</p>
      </details>
      <Link to={`/resources/${resourceId}`} className="mt-8 text-xs text-slate-500 hover:text-slate-300">
        Exit kiosk
      </Link>
    </div>
  );
}
