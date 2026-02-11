'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MapPin, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export const LocationSearch = ({ onSearch, currentCity }: { onSearch: (city: string) => void, currentCity: string }) => {
  const [query, setQuery] = useState('');
  const { toast } = useToast();

  const handleSearch = () => {
    if (query.trim()) {
      onSearch(query.trim());
      setQuery('');
    } else {
       toast({
        title: "Empty search",
        description: "Please enter a city name to search.",
        variant: "destructive",
      });
    }
  };

  const handleGeolocation = () => {
    toast({
      title: "Feature coming soon",
      description: "Using your current location will be available in a future update.",
    })
  }

  return (
    <div className="space-y-2">
       <p className="text-sm font-medium text-muted-foreground px-2">Search Location</p>
      <div className="flex gap-2 px-2">
        <Input 
          value={query} 
          onChange={(e) => setQuery(e.target.value)} 
          placeholder="e.g., London" 
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="bg-background focus:bg-white"
        />
        <Button size="icon" variant="outline" onClick={handleSearch} className="bg-background hover:bg-accent/50">
          <Search className="h-4 w-4" />
        </Button>
      </div>
      <div className="px-2">
        <Button variant="ghost" className="w-full justify-start gap-2" onClick={handleGeolocation}>
          <MapPin className="h-4 w-4" /> Use current location
        </Button>
      </div>
    </div>
  );
};
