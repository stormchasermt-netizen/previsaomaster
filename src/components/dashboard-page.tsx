'use client';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarInset,
  SidebarGroup,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { LocationSearch } from "@/components/location-search";
import { CurrentWeather } from "@/components/current-weather";
import { HourlyForecast } from "@/components/hourly-forecast";
import { SevenDayForecast } from "@/components/seven-day-forecast";
import { WeatherDetails } from "@/components/weather-details";
import { WeatherMap } from "@/components/weather-map";
import { AlertsPanel } from "@/components/alerts-panel";
import { AiSummary } from "@/components/ai-summary";
import type { WeatherData } from "@/lib/types";
import { Cloud, SunMoon, AlertTriangle } from 'lucide-react';
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "./ui/card";

export function DashboardPage({
  weatherData,
  onLocationSearch,
  error,
  currentCity
}: {
  weatherData: WeatherData | null;
  onLocationSearch: (city: string) => void;
  error: string | null;
  currentCity: string;
}) {

  const MainContent = () => {
    if (error) {
      return (
        <Card className="col-span-4 flex flex-col items-center justify-center text-center p-8 h-full">
            <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
            <h2 className="text-xl font-semibold text-destructive">Error</h2>
            <p className="text-muted-foreground">{error}</p>
        </Card>
      );
    }
    if (!weatherData) {
      return <LoadingSkeleton />;
    }
    return (
      <>
        <CurrentWeather weatherData={weatherData} />
        <HourlyForecast weatherData={weatherData} />
        <SevenDayForecast weatherData={weatherData} />
        <WeatherDetails weatherData={weatherData} />
        <WeatherMap lat={weatherData.lat} lng={weatherData.lng} city={weatherData.city} />
        <AlertsPanel weatherData={weatherData} />
        <AiSummary weatherData={weatherData} />
      </>
    );
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen w-full bg-background text-foreground">
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/20 rounded-lg">
                  <Cloud className="h-6 w-6 text-primary" />
                </div>
                <h1 className="text-xl font-bold font-headline">Previsão Master</h1>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <LocationSearch onSearch={onLocationSearch} currentCity={currentCity} />
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 items-center gap-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 lg:h-[60px] lg:px-6 sticky top-0 z-30">
             <SidebarTrigger className="md:hidden" />
             <div className="flex-1">
                <h1 className="font-semibold text-lg">{weatherData?.city || currentCity}</h1>
             </div>
          </header>
          <main className="flex-1 p-4 md:p-6 lg:p-8">
            <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-4 auto-rows-max">
              <MainContent />
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}


function LoadingSkeleton() {
  return (
    <>
      <Skeleton className="col-span-4 md:col-span-2 lg:col-span-3 h-[148px]" />
      <Skeleton className="col-span-4 md:col-span-2 lg:col-span-1 h-[148px]" />
      <Skeleton className="col-span-4 h-[250px]" />
      <Skeleton className="col-span-4 md:col-span-2 h-[250px]" />
      <Skeleton className="col-span-4 md:col-span-2 h-[250px]" />
      <Skeleton className="col-span-4 md:col-span-2 h-[250px]" />
      <Skeleton className="col-span-4 md:col-span-2 h-[250px]" />
    </>
  );
}
