interface EventBrandingProps {
  logoUrl: string | null;
  brandingStyle: string;
  eventName: string;
}

const EventBranding = ({ logoUrl, brandingStyle, eventName }: EventBrandingProps) => {
  if (!logoUrl || brandingStyle === 'none') return null;

  // All branding styles render as a corner logo in the top-right,
  // below the header and opposite the basemap toolbar.
  return (
    <div className="absolute top-[76px] right-4 z-[15]">
      <img
        src={logoUrl}
        alt={`${eventName} logo`}
        className="h-12 w-12 object-contain rounded-lg bg-card/80 backdrop-blur border border-border p-1 shadow-md"
      />
    </div>
  );
};

export default EventBranding;
