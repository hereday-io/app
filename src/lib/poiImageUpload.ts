import { supabase } from '@/integrations/supabase/client';

/**
 * Converts a base64 data URL into a Blob for upload.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',');
  const mimeMatch = /data:([^;]+);base64/.exec(header);
  const mime = mimeMatch?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Uploads a POI image (base64 data URL) to the poi-images storage bucket
 * and returns the public URL. Path layout mirrors event-logos:
 *   {userId}/{eventId}/{poiId}-{timestamp}.{ext}
 *
 * RLS on the bucket requires the first path segment to equal auth.uid(),
 * so callers must pass the authenticated user's id.
 */
export async function uploadPoiImage(
  dataUrl: string,
  userId: string,
  eventId: string,
  poiId: string,
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  const ext = blob.type.split('/')[1]?.split('+')[0] || 'jpg';
  const path = `${userId}/${eventId}/${poiId}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from('poi-images')
    .upload(path, blob, {
      cacheControl: '3600',
      upsert: true,
      contentType: blob.type,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('poi-images').getPublicUrl(path);
  return data.publicUrl;
}

/**
 * True if the string looks like a base64 data URL (as opposed to an
 * already-uploaded https URL).
 */
export function isDataUrl(value: string | undefined): boolean {
  return !!value && value.startsWith('data:');
}
