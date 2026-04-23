/**
 * Organizer → audience email template for the send-event-update edge
 * function.
 *
 * Intentionally duplicated with src/lib/emailTemplate.ts (the client-
 * side copy used to power the compose dialog preview). Both are pure,
 * dependency-free functions; keeping two copies trades a little code
 * duplication for the Deno-vs-browser module boundary (no shared import
 * path works cleanly across both runtimes without a build step). When
 * updating one, update the other.
 */

export interface EmailTemplateInput {
  eventName: string;
  subject: string;
  bodyMarkdown: string;
  unsubscribeUrl: string;
  organizerName: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(
    /\[([^\]]+?)\]\((https?:\/\/[^\s)]+?)\)/g,
    '<a href="$2" style="color:#0F766E;text-decoration:underline;">$1</a>',
  );
  return out;
}

export function markdownToHtml(md: string): string {
  const paragraphs = md
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paragraphs
    .map((p) => {
      const withBreaks = renderInline(p).replace(/\n/g, '<br>');
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${withBreaks}</p>`;
    })
    .join('\n');
}

export function renderOrganizerEmailHtml(input: EmailTemplateInput): string {
  const bodyHtml = markdownToHtml(input.bodyMarkdown || '');
  const safeEventName = escapeHtml(input.eventName);
  const safeSubject = escapeHtml(input.subject);
  const safeOrganizer = input.organizerName ? escapeHtml(input.organizerName) : null;
  const unsubscribeHref = escapeHtml(input.unsubscribeUrl);

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F9FAFB;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:28px 32px 8px;">
                <img src="https://hereday.io/hereday-logo.png" alt="Hereday" width="160" style="display:block;height:auto;max-width:160px;" />
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 0;">
                <div style="font-size:12px;color:#6B7280;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:4px;">Update from ${safeEventName}</div>
                <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">${safeSubject}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;">
                ${bodyHtml}
              </td>
            </tr>
            ${safeOrganizer ? `
            <tr>
              <td style="padding:8px 32px 24px;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">
                  — ${safeOrganizer}
                </p>
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding:16px 32px 24px;border-top:1px solid #F3F4F6;">
                <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#9CA3AF;">
                  You're receiving this because you signed up for updates about ${safeEventName} on Hereday.
                </p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#9CA3AF;">
                  <a href="${unsubscribeHref}" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe</a> from ${safeEventName} updates.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;">
            &copy; Hereday LLC &middot; Made for race organizers
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderOrganizerEmailText(input: EmailTemplateInput): string {
  const lines: string[] = [];
  lines.push(`Update from ${input.eventName}`);
  lines.push(input.subject);
  lines.push('');
  const plainBody = input.bodyMarkdown
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+?)\)/g, '$1 ($2)');
  lines.push(plainBody);
  if (input.organizerName) {
    lines.push('');
    lines.push(`— ${input.organizerName}`);
  }
  lines.push('');
  lines.push('---');
  lines.push(`You're receiving this because you signed up for updates about ${input.eventName} on Hereday.`);
  lines.push(`Unsubscribe: ${input.unsubscribeUrl}`);
  return lines.join('\n');
}
