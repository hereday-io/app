# Email Template Design Notes

All templates use inline CSS only. Email clients (especially Outlook and Gmail
app) mangle or strip `<style>` blocks, so every color, font, and spacing rule
is on the element.

## Brand

- **Logo:** `https://hereday.io/hereday-logo.png` (absolute URL required)
- **Primary:** `#0F766E` (teal — matches app primary)
- **Text:** `#111827` body, `#6B7280` muted
- **Background:** `#F9FAFB` page, `#FFFFFF` card
- **Button:** teal fill, white text, 10px padding, 6px radius

## Supabase template variables

Available in every auth template:

- `{{ .ConfirmationURL }}` — the action link (confirm, reset, etc.)
- `{{ .Token }}` — numeric OTP (only if you enable OTP mode)
- `{{ .TokenHash }}` — URL-safe token (advanced use)
- `{{ .SiteURL }}` — from project settings
- `{{ .Email }}` — recipient email
- `{{ .Data }}` — custom metadata from signUp()

## How to upload

1. Supabase Dashboard → **Authentication** → **Email Templates**
2. For each template below, paste the full HTML into the matching tab:
   - `confirm-signup.html` → **Confirm signup**
   - `magic-link.html` → **Magic Link**
   - `reset-password.html` → **Reset Password**
   - `change-email.html` → **Change Email Address**
3. Save each tab. Changes take effect immediately on new emails.

Test by signing up a fresh test email, triggering a password reset on it, and
confirming the rendered mail looks right in both Gmail web and Gmail mobile.
