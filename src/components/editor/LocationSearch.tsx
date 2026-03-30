import { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface SearchResult {
  place_name: string;
  center: [number, number];
}

interface LocationSearchProps {
  token: string;
  onSelect: (center: [number, number], name: string) => void;
}

const LocationSearch = ({ token, onSelect }: LocationSearchProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (!query) setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [query]);

  const search = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(value)}.json?access_token=${token}&limit=5`
        );
        const data = await res.json();
        const items: SearchResult[] = (data.features || []).map((f: any) => ({
          place_name: f.place_name,
          center: f.center as [number, number],
        }));
        setResults(items);
        setOpen(items.length > 0);
      } catch {
        setResults([]);
      }
    }, 300);
  };

  const handleSelect = (result: SearchResult) => {
    onSelect(result.center, result.place_name);
    setQuery(result.place_name.split(',')[0]);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {expanded ? (
        <div className="flex items-center gap-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search location…"
              className="h-8 w-48 pl-7 pr-7 text-xs"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); setOpen(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Search location"
        >
          <Search className="h-4 w-4" />
        </button>
      )}

      {open && (
        <div className="absolute top-full mt-1 right-0 w-72 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b border-border last:border-0 truncate"
            >
              {r.place_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LocationSearch;
