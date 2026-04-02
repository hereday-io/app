import { useState, useRef } from 'react';
import { Upload, X, Crown, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

type BrandingStyle = 'none' | 'corner' | 'banner' | 'both';

interface BrandingPanelProps {
  logoUrl: string | null;
  brandingStyle: BrandingStyle;
  onLogoChange: (url: string | null) => void;
  onStyleChange: (style: BrandingStyle) => void;
  isPaid: boolean;
  eventId: string;
  userId: string;
}

const STYLE_OPTIONS: { value: BrandingStyle; label: string; description: string }[] = [
  { value: 'corner', label: 'Corner overlay', description: 'Logo in the bottom-left of the map' },
  { value: 'banner', label: 'Top banner', description: 'Branded bar above the map with logo & event name' },
  { value: 'both', label: 'Both', description: 'Corner logo + top banner bar' },
];

const BrandingPanel = ({ logoUrl, brandingStyle, onLogoChange, onStyleChange, isPaid, eventId, userId }: BrandingPanelProps) => {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${userId}/${eventId}.${ext}`;

    const { error } = await supabase.storage
      .from('event-logos')
      .upload(path, file, { upsert: true });

    if (error) {
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('event-logos').getPublicUrl(path);
    onLogoChange(urlData.publicUrl);
    if (brandingStyle === 'none') onStyleChange('corner');
    setUploading(false);
  };

  const handleRemove = async () => {
    const path = `${userId}/${eventId}`;
    // Try to remove old files (ignore errors)
    await supabase.storage.from('event-logos').remove([`${path}.png`, `${path}.jpg`, `${path}.jpeg`, `${path}.webp`, `${path}.svg`]);
    onLogoChange(null);
    onStyleChange('none');
  };

  if (!isPaid) {
    return (
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
          <Crown className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Custom Branding</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add your event logo to the public map. Upgrade to a paid plan to unlock this feature.
            </p>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs gap-1" disabled>
              <Crown className="h-3 w-3 text-amber-500" /> Upgrade to unlock
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Event Branding</span>
      </div>

      {/* Logo upload */}
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <div className="relative group">
            <img
              src={logoUrl}
              alt="Event logo"
              className="w-14 h-14 rounded-lg object-contain border border-border bg-background p-1"
            />
            <button
              onClick={handleRemove}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-14 h-14 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center transition-colors"
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">
            {logoUrl ? 'Logo uploaded' : 'Upload your event logo'}
          </p>
          {!logoUrl && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs mt-0.5 px-0 text-primary"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : 'Choose file'}
            </Button>
          )}
          {logoUrl && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs mt-0.5 px-0 text-primary"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : 'Replace'}
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* Style picker */}
      {logoUrl && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Display style</p>
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onStyleChange(opt.value)}
              className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                brandingStyle === opt.value
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'hover:bg-secondary text-foreground'
              }`}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-muted-foreground ml-1">— {opt.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default BrandingPanel;
