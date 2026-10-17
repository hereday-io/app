import { describe, it, expect } from 'vitest';
import { aiAssistantFor } from './aiReferrals';

describe('aiAssistantFor', () => {
  it('reads a full referrer URL or a bare domain, subdomains included', () => {
    expect(aiAssistantFor('https://chatgpt.com/')).toBe('ChatGPT');
    expect(aiAssistantFor('chatgpt.com')).toBe('ChatGPT');
    expect(aiAssistantFor('https://www.perplexity.ai/search?q=race+map')).toBe('Perplexity');
    expect(aiAssistantFor('https://claude.ai/chat/abc')).toBe('Claude');
    expect(aiAssistantFor('https://gemini.google.com/app')).toBe('Gemini');
  });

  it("falls back to utm_source when there's no referrer, as from ChatGPT's apps", () => {
    expect(aiAssistantFor(null, 'chatgpt.com')).toBe('ChatGPT');
    expect(aiAssistantFor('', 'Perplexity')).toBe('Perplexity');
    expect(aiAssistantFor(undefined, 'copilot.com')).toBe('Copilot');
  });

  it("doesn't claim lookalikes or plain search", () => {
    expect(aiAssistantFor('https://www.google.com/')).toBeNull();
    expect(aiAssistantFor('https://notchatgpt.com/')).toBeNull();
    expect(aiAssistantFor('https://hereday.io/faq', 'newsletter')).toBeNull();
    expect(aiAssistantFor(null, null)).toBeNull();
    expect(aiAssistantFor('not a url')).toBeNull();
  });
});
