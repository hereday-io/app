import { Document, Image, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import type { EventRoute, PoiType, RoutePoi } from '@/types/mapEditor';
import type { EmergencyContacts } from '@/components/EditEventDialog';
import { totalRouteMiles, mileMarkerForPoi, metersToMiles } from './routeDistance';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ChecklistInput {
  event: {
    id: string;
    name: string;
    city?: string | null;
    event_date?: string | null;
    start_time?: string | null;
    slug?: string | null;
    paid_at?: string | null;
    routes?: EventRoute[] | null;
    pois?: RoutePoi[] | null;
    emergency_contacts?: EmergencyContacts | null;
  };
  organizer: { displayName: string | null; email: string | null };
  /** Base URL for the public event page, e.g. "https://hereday.io" (no trailing slash). */
  publicBaseUrl: string;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

// Primary blue pulled from Tailwind config: hsl(217 91% 50%) ≈ #1E57E3.
// Brand orange accent from the Hereday logo sun: hsl(25 95% 58%) ≈ #F5A623.
const PRIMARY = '#1E57E3';
const ACCENT = '#F5A623';
const TEXT = '#111827';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: TEXT,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: `1pt solid ${BORDER}`,
  },
  logo: { width: 120, height: 36, objectFit: 'contain' },
  headerRight: { flexDirection: 'column', alignItems: 'flex-end' },
  eventName: { fontSize: 18, fontWeight: 700, color: TEXT, marginBottom: 2 },
  eventMeta: { fontSize: 10, color: MUTED },
  proTag: {
    fontSize: 8,
    fontWeight: 700,
    color: '#B45309',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    marginLeft: 6,
  },

  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: PRIMARY,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottom: `1pt solid ${ACCENT}`,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  labelCol: { width: 90, fontSize: 9, color: MUTED, fontWeight: 700 },
  valueCol: { flex: 1, fontSize: 10, color: TEXT },

  summaryBlock: { marginBottom: 18 },
  summaryLine: { marginBottom: 4 },

  poiColumns: { flexDirection: 'row', gap: 24 },
  poiColumn: { flex: 1 },
  poiGroup: { marginBottom: 12 },
  poiGroupTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: TEXT,
    marginBottom: 4,
  },
  poiItem: { marginBottom: 4 },
  poiTitle: { fontSize: 10, color: TEXT },
  poiDesc: { fontSize: 9, color: MUTED, marginTop: 1 },

  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    padding: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 4,
    border: `1pt solid ${BORDER}`,
  },
  shareLabel: { fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  shareUrl: { fontSize: 13, color: PRIMARY, fontWeight: 700 },
  shareHint: { fontSize: 9, color: MUTED, marginTop: 4 },
  qr: { width: 90, height: 90 },

  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 8,
    color: MUTED,
  },
  footerFree: { color: '#B45309', fontWeight: 700 },
});

/* ------------------------------------------------------------------ */
/*  POI grouping                                                       */
/* ------------------------------------------------------------------ */

// Order deliberately tuned for race-day skim: start/finish first, then
// safety-critical (aid, medical), then participant-critical (water,
// registration, restrooms, parking), then sponsors, then custom.
const POI_GROUPS: Array<{ key: string; label: string; types: PoiType[] }> = [
  { key: 'startFinish', label: 'Start & Finish', types: ['start', 'finish'] },
  { key: 'aid', label: 'Aid Stations', types: ['aid-station'] },
  { key: 'medical', label: 'Medical', types: ['medical'] },
  { key: 'water', label: 'Water', types: ['water'] },
  { key: 'registration', label: 'Registration', types: ['registration'] },
  { key: 'restroom', label: 'Restrooms', types: ['restroom'] },
  { key: 'parking', label: 'Parking', types: ['parking'] },
  { key: 'sponsor', label: 'Sponsors', types: ['sponsor'] },
  { key: 'custom', label: 'Other', types: ['custom'] },
];

function groupPois(pois: RoutePoi[]) {
  return POI_GROUPS.map((g) => ({
    ...g,
    items: pois.filter((p) => g.types.includes(p.type)),
  })).filter((g) => g.items.length > 0);
}

/* ------------------------------------------------------------------ */
/*  Formatting                                                         */
/* ------------------------------------------------------------------ */

function formatEventDate(date?: string | null): string {
  if (!date) return 'Date TBD';
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatStartTime(time?: string | null): string {
  if (!time) return '';
  // time is "HH:mm" or "HH:mm:ss" from a TIME column
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/* ------------------------------------------------------------------ */
/*  Asset loading                                                      */
/* ------------------------------------------------------------------ */

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    width: 512,
    margin: 1,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

/* ------------------------------------------------------------------ */
/*  Document                                                           */
/* ------------------------------------------------------------------ */

interface DocProps extends ChecklistInput {
  logoDataUrl: string;
  qrDataUrl: string;
  publicUrl: string;
  totalMiles: number;
  routeCount: number;
  groupedPois: ReturnType<typeof groupPois>;
  /** POI id → mile marker (e.g. 4.7). Absent for POIs that couldn't be projected. */
  poiMileMarkers: Map<string, number>;
}

function RaceDayChecklistDocument(props: DocProps) {
  const { event, organizer, logoDataUrl, qrDataUrl, publicUrl, totalMiles, routeCount, groupedPois, poiMileMarkers } = props;
  const isPro = !!event.paid_at;
  const formattedDate = formatEventDate(event.event_date);
  const formattedTime = formatStartTime(event.start_time);
  const ec = (event.emergency_contacts ?? {}) as EmergencyContacts;
  const hasEmergencyContacts = !!(ec.raceDirectorPhone || ec.medicalLeadName || ec.medicalLeadPhone || ec.nearestHospital);

  // Split groups into two balanced columns by item count so neither
  // column towers over the other.
  const leftCol: typeof groupedPois = [];
  const rightCol: typeof groupedPois = [];
  let leftCount = 0;
  let rightCount = 0;
  for (const g of groupedPois) {
    if (leftCount <= rightCount) {
      leftCol.push(g);
      leftCount += g.items.length;
    } else {
      rightCol.push(g);
      rightCount += g.items.length;
    }
  }

  // Mini header repeated on page 2+ via `fixed` — shows event name
  // and date so a standalone second page is still identifiable.
  const miniHeader = (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingBottom: 8,
        marginBottom: 12,
        borderBottom: `0.5pt solid ${BORDER}`,
        fontSize: 8,
        color: MUTED,
      }}
      fixed
      render={({ pageNumber }) => (pageNumber > 1 ? (
        <>
          <Text>{event.name}</Text>
          <Text>{formattedDate}{formattedTime ? ` · ${formattedTime}` : ''}</Text>
        </>
      ) : null)}
    />
  );

  return (
    <Document title={`${event.name} — Race-Day Checklist`}>
      <Page size="LETTER" style={styles.page}>
        {/* Mini header on page 2+ */}
        {miniHeader}

        {/* Header */}
        <View style={styles.headerRow}>
          {logoDataUrl ? <Image src={logoDataUrl} style={styles.logo} /> : <View style={styles.logo} />}
          <View style={styles.headerRight}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.eventName}>{event.name}</Text>
              {isPro && <Text style={styles.proTag}>PRO</Text>}
            </View>
            <Text style={styles.eventMeta}>
              {formattedDate}
              {formattedTime ? `  ·  ${formattedTime}` : ''}
              {event.city ? `  ·  ${event.city}` : ''}
            </Text>
          </View>
        </View>

        {/* Race director */}
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionTitle}>Race Director</Text>
          <View style={styles.row}>
            <Text style={styles.labelCol}>Name</Text>
            <Text style={styles.valueCol}>{organizer.displayName || '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.labelCol}>Contact</Text>
            <Text style={styles.valueCol}>{organizer.email || '—'}</Text>
          </View>
        </View>

        {/* Emergency contacts — only rendered if at least one field is filled */}
        {hasEmergencyContacts && (
          <View style={styles.summaryBlock}>
            <Text style={styles.sectionTitle}>Race-Day Contacts</Text>
            {ec.raceDirectorPhone && (
              <View style={styles.row}>
                <Text style={styles.labelCol}>Race Director</Text>
                <Text style={styles.valueCol}>{ec.raceDirectorPhone}</Text>
              </View>
            )}
            {(ec.medicalLeadName || ec.medicalLeadPhone) && (
              <View style={styles.row}>
                <Text style={styles.labelCol}>Medical Lead</Text>
                <Text style={styles.valueCol}>
                  {[ec.medicalLeadName, ec.medicalLeadPhone].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}
            {ec.nearestHospital && (
              <View style={styles.row}>
                <Text style={styles.labelCol}>Nearest Hospital</Text>
                <Text style={styles.valueCol}>{ec.nearestHospital}</Text>
              </View>
            )}
          </View>
        )}

        {/* Course summary */}
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionTitle}>Course</Text>
          {routeCount > 0 ? (
            <Text style={styles.summaryLine}>
              {routeCount} {routeCount === 1 ? 'route' : 'routes'} · {totalMiles.toFixed(2)} miles total
            </Text>
          ) : (
            <Text style={[styles.summaryLine, { color: MUTED }]}>No routes drawn yet.</Text>
          )}
        </View>

        {/* POIs */}
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionTitle}>Points of Interest</Text>
          {groupedPois.length === 0 ? (
            <Text style={[styles.summaryLine, { color: MUTED }]}>No POIs added yet.</Text>
          ) : (
            <View style={styles.poiColumns}>
              <View style={styles.poiColumn}>{leftCol.map((g) => renderPoiGroup(g, poiMileMarkers))}</View>
              <View style={styles.poiColumn}>{rightCol.map((g) => renderPoiGroup(g, poiMileMarkers))}</View>
            </View>
          )}
        </View>

        {/* Public page + QR */}
        <View style={styles.shareRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.shareLabel}>Live event page</Text>
            <Text style={styles.shareUrl}>{publicUrl}</Text>
            <Text style={styles.shareHint}>
              Participants and spectators can scan to view the course and aid stations.
            </Text>
          </View>
          {qrDataUrl && <Image src={qrDataUrl} style={styles.qr} />}
        </View>

        {/* Footer */}
        <Text style={styles.footer} fixed>
          {isPro ? (
            <Text>hereday.io</Text>
          ) : (
            <Text>
              <Text style={styles.footerFree}>Made with Hereday</Text> — upgrade to Pro to remove this footer · hereday.io
            </Text>
          )}
        </Text>
      </Page>
    </Document>
  );
}

function renderPoiGroup(g: ReturnType<typeof groupPois>[number], markers: Map<string, number>) {
  return (
    <View key={g.key} style={styles.poiGroup}>
      <Text style={styles.poiGroupTitle}>{g.label}</Text>
      {g.items.map((p) => {
        const mile = markers.get(p.id);
        const mileLabel = mile != null ? `Mile ${mile.toFixed(1)} — ` : '';
        return (
          <View key={p.id} style={styles.poiItem}>
            <Text style={styles.poiTitle}>• {mileLabel}{p.title || '(untitled)'}</Text>
            {p.description ? <Text style={styles.poiDesc}>   {p.description}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

/**
 * Generate the Race-Day Prep Checklist PDF as a Blob. Callers trigger
 * the download themselves (keeps this pure and easier to test).
 *
 * Lazy-load this module via dynamic import so `@react-pdf/renderer`
 * doesn't land in the main bundle.
 */
export async function renderRaceDayChecklistPdf(input: ChecklistInput): Promise<Blob> {
  const { event, publicBaseUrl } = input;
  const publicUrl = event.slug ? `${publicBaseUrl}/event/${event.slug}` : publicBaseUrl;

  const pois = Array.isArray(event.pois) ? event.pois : [];
  const routes = Array.isArray(event.routes) ? event.routes : [];

  const [logoDataUrl, qrDataUrl] = await Promise.all([
    // Fetch on a best-effort basis — broken logo shouldn't block the PDF.
    fetchAsDataUrl('/hereday-logo.png').catch(() => ''),
    generateQrDataUrl(publicUrl),
  ]);

  const totalMiles = totalRouteMiles(routes);
  const groupedPois = groupPois(pois);

  // Compute mile markers by projecting each POI onto the nearest route.
  // Uses the first route with routeCoords as the primary route — most
  // single-course events have exactly one. Multi-route events get a
  // best-effort projection onto the longest route.
  const poiMileMarkers = new Map<string, number>();
  const primaryRoute = routes
    .filter((r) => r.routeCoords && r.routeCoords.length >= 2)
    .sort((a, b) => (b.routeCoords?.length ?? 0) - (a.routeCoords?.length ?? 0))[0];

  if (primaryRoute?.routeCoords) {
    for (const poi of pois) {
      const meters = mileMarkerForPoi(poi.coordinates, primaryRoute.routeCoords);
      if (meters != null) {
        poiMileMarkers.set(poi.id, metersToMiles(meters));
      }
    }
  }

  const blob = await pdf(
    <RaceDayChecklistDocument
      {...input}
      logoDataUrl={logoDataUrl}
      qrDataUrl={qrDataUrl}
      publicUrl={publicUrl}
      totalMiles={totalMiles}
      routeCount={routes.length}
      groupedPois={groupedPois}
      poiMileMarkers={poiMileMarkers}
    />,
  ).toBlob();
  return blob;
}
