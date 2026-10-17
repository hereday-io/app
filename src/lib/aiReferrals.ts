/**
 * AI assistants as an acquisition channel.
 *
 * When ChatGPT, Claude, Perplexity and the rest cite hereday.io in an
 * answer, the click arrives one of two ways: with a `Referer` from the
 * assistant's domain, or with no referrer at all but a `utm_source` the
 * assistant appends itself (ChatGPT tags every cited link with
 * `utm_source=chatgpt.com`, and its mobile apps send no referrer). Either
 * one identifies the assistant, so both are checked.
 *
 * The posthog-traffic edge function keeps an identical copy of this list
 * for its HogQL (it can't import from src/); traffic.test.ts fails if the
 * two drift.
 *
 * Not separable, so not listed: Google's AI Overviews / AI Mode (arrive
 * as google.com) and Copilot inside Bing search (arrive as bing.com).
 */

export interface AiAssistant {
  label: string;
  /** Referrer hosts. Subdomains match too: `chatgpt.com` covers `www.chatgpt.com`. */
  domains: string[];
  /** `utm_source` values beyond the domains themselves, lowercase. */
  utmSources: string[];
}

export const AI_ASSISTANTS: AiAssistant[] = [
  { label: 'ChatGPT', domains: ['chatgpt.com', 'chat.openai.com'], utmSources: ['chatgpt', 'openai'] },
  { label: 'Claude', domains: ['claude.ai'], utmSources: ['claude', 'anthropic'] },
  { label: 'Perplexity', domains: ['perplexity.ai'], utmSources: ['perplexity'] },
  { label: 'Gemini', domains: ['gemini.google.com', 'bard.google.com'], utmSources: ['gemini'] },
  { label: 'Copilot', domains: ['copilot.microsoft.com', 'copilot.com'], utmSources: ['copilot'] },
  { label: 'Grok', domains: ['grok.com', 'x.ai'], utmSources: ['grok'] },
  { label: 'Meta AI', domains: ['meta.ai'], utmSources: ['meta.ai', 'metaai'] },
  { label: 'DeepSeek', domains: ['chat.deepseek.com'], utmSources: ['deepseek'] },
  { label: 'Mistral', domains: ['chat.mistral.ai'], utmSources: ['mistral', 'lechat'] },
  { label: 'You.com', domains: ['you.com'], utmSources: [] },
];

function hostOf(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return '';
  try {
    return new URL(v.includes('://') ? v : `https://${v}`).hostname;
  } catch {
    return '';
  }
}

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * The assistant a visit came from, or null. `referrer` may be a full URL
 * (profiles.first_referrer) or a bare domain (PostHog's
 * $referring_domain); `utmSource` is the raw `utm_source` param.
 */
export function aiAssistantFor(
  referrer: string | null | undefined,
  utmSource?: string | null,
): string | null {
  const host = referrer ? hostOf(referrer) : '';
  const utm = (utmSource ?? '').trim().toLowerCase();
  for (const a of AI_ASSISTANTS) {
    if (host && a.domains.some((d) => hostMatches(host, d))) return a.label;
    if (utm && (a.domains.includes(utm) || a.utmSources.includes(utm))) return a.label;
  }
  return null;
}
