-- Add branding columns to events
ALTER TABLE public.events
ADD COLUMN logo_url TEXT,
ADD COLUMN branding_style TEXT NOT NULL DEFAULT 'none';

-- Add paid tier flag to profiles
ALTER TABLE public.profiles
ADD COLUMN is_paid BOOLEAN NOT NULL DEFAULT false;

-- Create storage bucket for event logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-logos', 'event-logos', true);

-- Allow anyone to view logos (public maps need this)
CREATE POLICY "Event logos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'event-logos');

-- Allow authenticated users to upload logos to their own folder
CREATE POLICY "Users can upload event logos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'event-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to update their own logos
CREATE POLICY "Users can update their own logos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'event-logos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow users to delete their own logos
CREATE POLICY "Users can delete their own logos"
ON storage.objects FOR DELETE
USING (bucket_id = 'event-logos' AND auth.uid()::text = (storage.foldername(name))[1]);