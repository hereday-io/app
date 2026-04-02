interface EventBrandingProps {
  logoUrl: string | null;
  brandingStyle: string;
  eventName: string;
}

const EventBranding = ({ logoUrl, brandingStyle, eventName }: EventBrandingProps) => {
  if (!logoUrl || brandingStyle === 'none') return null;

  const showBanner = brandingStyle === 'banner' || brandingStyle === 'both';
  const showCorner = brandingStyle === 'corner' || brandingStyle === 'both';

  return (
    <>
      {showBanner && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-2 bg-card/90 backdrop-blur border-b border-border">
          <img src={logoUrl} alt={`${eventName} logo`} className="h-8 w-8 object-contain rounded" />
          <span className="text-sm font-semibold text-foreground truncate" style={{ fontFamily: 'var(--font-display)' }}>
            {eventName}
          </span>
        </div>
      )}
      {showCorner && (
        <div className="absolute bottom-20 left-4 z-20">
          <img
            src={logoUrl}
            alt={`${eventName} logo`}
            className="h-12 w-12 object-contain rounded-lg bg-card/80 backdrop-blur border border-border p-1 shadow-md"
          />
        </div>
      )}
    </>
  );
};

export default EventBranding;
