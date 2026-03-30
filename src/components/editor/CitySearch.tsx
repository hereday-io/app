import { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface CityResult {
  place_name: string;
  center: [number, number];
}

interface CitySearchProps {
  value: string;
  onChange: (city: string, center: [number, number] | null) => void;
  token: string;
  placeholder?: string;
}

const CitySearch = ({ value, onChange, token, placeholder = 'San Francisco' }: CitySearchProps) => {
  const [results, setResults] = useState<CityResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleInput = (val: string) => {
    onChange(val, null);
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(val)}.json?access_token=${token}&types=place,locality,neighborhood,address&limit=5`
        );
        const data = await res.json();
        const items: CityResult[] = (data.features || []).map((f: any) => ({
          place_name: f.place_name,
          center: f.center as [number, number],
        }));
        setResults(items);
        setOpen(items.length > 0);
        setActiveIndex(-1);
      } catch {
        setResults([]);
      }
    }, 300);
  };

  const handleSelect = (result: CityResult) => {
    onChange(result.place_name.split(',')[0], result.center);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          handleSelect(results[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder={placeholder}
        />
        <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>

      {open && (
        <div className="absolute top-full mt-1 left-0 w-full bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => handleSelect(r)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors border-b border-border last:border-0 truncate ${
                i === activeIndex ? 'bg-muted text-foreground' : 'hover:bg-muted'
              }`}
            >
              {r.place_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CitySearch;
