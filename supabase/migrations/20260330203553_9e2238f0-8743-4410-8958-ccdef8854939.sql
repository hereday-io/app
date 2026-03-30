ALTER TABLE public.events ADD COLUMN routes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.events ADD COLUMN pois JSONB NOT NULL DEFAULT '[]'::jsonb;