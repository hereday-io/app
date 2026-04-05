import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Loader2 } from 'lucide-react';
import { logEvent } from '@/lib/analytics';

interface ShareQrCodeProps {
  /** The public URL to encode. Required — the component renders nothing until provided. */
  url: string;
  /** Event name, used to produce a friendly download filename. */
  eventName: string;
  /** Event id, for analytics attribution. */
  eventId?: string | null;
}

/**
 * QR code block for the share popover.
 *
 * Generates two sizes: a small preview (for display in the popover) and a
 * high-res print version (for the download button). Race organizers print
 * these onto race-day signage, bib inserts, and course signs — so the
 * download needs enough resolution to survive a 4"+ print at 300 DPI.
 *
 * Uses error correction level H (high) so the code survives wrinkles,
 * sun glare, and partial occlusion on outdoor signage.
 */
const ShareQrCode = ({ url, eventName, eventId = null }: ShareQrCodeProps) => {
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Track which URL we've already logged a 'qr_generated' event for so we
  // don't double-log when the popover re-opens in the same session.
  const loggedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 256,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((dataUrl) => {
        if (cancelled) return;
        setPreviewDataUrl(dataUrl);
        if (loggedRef.current !== url) {
          loggedRef.current = url;
          logEvent('qr_generated', eventId, { context: 'share_popover' });
        }
      })
      .catch((err) => {
        console.error('QR preview generation failed', err);
      });
    return () => { cancelled = true; };
  }, [url, eventId]);

  const handleDownload = async () => {
    if (!url || downloading) return;
    setDownloading(true);
    try {
      // 1024px @ error correction H is crisp at ~3.4" print width (300 DPI)
      // and still looks good scaled up to ~6" for large course signage.
      const hiResDataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 1024,
        color: { dark: '#000000', light: '#ffffff' },
      });

      const safeName = eventName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'event';
      const link = document.createElement('a');
      link.href = hiResDataUrl;
      link.download = `${safeName}-qr.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      logEvent('qr_downloaded', eventId, { context: 'share_popover' });
    } catch (err) {
      console.error('QR download failed', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="shrink-0 h-20 w-20 rounded-md bg-white p-1.5 flex items-center justify-center border border-border/60">
        {previewDataUrl ? (
          <img src={previewDataUrl} alt="Share QR code" className="h-full w-full" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground">Race-day QR</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
          Print on bibs, signs, and flyers — scans straight to your public page.
        </p>
        <button
          onClick={handleDownload}
          disabled={!previewDataUrl || downloading}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {downloading ? 'Preparing…' : 'Download PNG'}
        </button>
      </div>
    </div>
  );
};

export default ShareQrCode;
