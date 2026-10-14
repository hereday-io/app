/**
 * Hereday's own sample map, used on the homepage hero and the empty
 * dashboard. Owned by kevin@hereday.io and comped to Pro.
 *
 * It has no event date on purpose: public_events only marks dated events
 * as ended, so the sample never expires. Don't give it a date.
 */
export const SAMPLE_EVENT_ID = '1980c8d0-95ef-45f1-a315-a0713cca6325';
export const SAMPLE_EVENT_PATH = '/event/hereday-sample-5k-10k';
/** As shown in the homepage mock's address bar. */
export const SAMPLE_EVENT_DISPLAY_URL = 'hereday.io/event/hereday-sample-5k-10k';

/** The sample's race doesn't exist, so it shouldn't collect subscribers. */
export const isSampleEvent = (eventId: string): boolean => eventId === SAMPLE_EVENT_ID;
