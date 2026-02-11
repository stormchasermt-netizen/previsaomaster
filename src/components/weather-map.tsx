'use client';
import { APIProvider, Map, Marker } from '@vis.gl/react-google-maps';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, WifiOff } from 'lucide-react';

export function WeatherMap({ lat, lng, city }: { lat: number; lng: number; city: string }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <Card className="col-span-4 md:col-span-2 h-[250px] flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            Interactive Map
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-grow flex flex-col items-center justify-center text-center bg-muted/50 rounded-b-lg">
          <WifiOff className="w-10 h-10 text-muted-foreground mb-4" />
          <p className="font-semibold">Map Unavailable</p>
          <p className="text-sm text-muted-foreground">
            Google Maps API Key not configured.
          </p>
           <p className="text-xs text-muted-foreground mt-2">
            Please set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in your environment.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="col-span-4 md:col-span-2 h-[250px] flex flex-col overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-muted-foreground" />
          Interactive Map
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-grow p-0 rounded-b-lg">
        <APIProvider apiKey={apiKey}>
          <Map
            center={{ lat, lng }}
            zoom={9}
            mapId="previsao-master-map-dark"
            disableDefaultUI={true}
            gestureHandling={'greedy'}
            style={{ width: '100%', height: '100%' }}
            styles={[
              { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
              { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
              { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
              {
                featureType: "administrative.locality",
                elementType: "labels.text.fill",
                stylers: [{ color: "#d59563" }],
              },
              {
                featureType: "poi",
                elementType: "labels.text.fill",
                stylers: [{ color: "#d59563" }],
              },
              {
                featureType: "poi.park",
                elementType: "geometry",
                stylers: [{ color: "#263c3f" }],
              },
              {
                featureType: "poi.park",
                elementType: "labels.text.fill",
                stylers: [{ color: "#6b9a76" }],
              },
              {
                featureType: "road",
                elementType: "geometry",
                stylers: [{ color: "#38414e" }],
              },
              {
                featureType: "road",
                elementType: "geometry.stroke",
                stylers: [{ color: "#212a37" }],
              },
              {
                featureType: "road",
                elementType: "labels.text.fill",
                stylers: [{ color: "#9ca5b3" }],
              },
              {
                featureType: "road.highway",
                elementType: "geometry",
                stylers: [{ color: "#746855" }],
              },
              {
                featureType: "road.highway",
                elementType: "geometry.stroke",
                stylers: [{ color: "#1f2835" }],
              },
              {
                featureType: "road.highway",
                elementType: "labels.text.fill",
                stylers: [{ color: "#f3d19c" }],
              },
              {
                featureType: "transit",
                elementType: "geometry",
                stylers: [{ color: "#2f3948" }],
              },
              {
                featureType: "transit.station",
                elementType: "labels.text.fill",
                stylers: [{ color: "#d59563" }],
              },
              {
                featureType: "water",
                elementType: "geometry",
                stylers: [{ color: "#17263c" }],
              },
              {
                featureType: "water",
                elementType: "labels.text.fill",
                stylers: [{ color: "#515c6d" }],
              },
              {
                featureType: "water",
                elementType: "labels.text.stroke",
                stylers: [{ color: "#17263c" }],
              },
            ]}
          >
            <Marker position={{ lat, lng }} title={city} />
          </Map>
        </APIProvider>
      </CardContent>
    </Card>
  );
}
