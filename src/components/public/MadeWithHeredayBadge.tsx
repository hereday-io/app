/**
 * Small attribution pill shown on public event pages for free-tier
 * events. Doubles as a growth loop — every spectator who lands on a
 * free event sees it. Paid events suppress it.
 *
 * Positioned as a fixed element above the Mapbox attribution so it is
 * visible on any map view without interfering with controls.
 */
const MadeWithHeredayBadge = () => {
  return (
    <a
      href="https://hereday.io/?utm_source=public_event&utm_medium=footer_badge"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground hover:border-primary/40 transition-colors"
      aria-label="Made with Hereday"
    >
      <img src="/browserlogo.png" alt="" className="h-3.5 w-3.5" />
      <span>
        Made with <span className="text-foreground font-semibold">Hereday</span>
      </span>
    </a>
  );
};

export default MadeWithHeredayBadge;
