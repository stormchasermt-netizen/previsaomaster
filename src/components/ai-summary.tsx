'use client';

import { useState, useEffect, useMemo } from 'react';
import { getAiSummary } from '@/app/actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WeatherData } from '@/lib/types';
import { Bot } from 'lucide-react';

export function AiSummary({ weatherData }: { weatherData: WeatherData | null }) {
  const [summary, setSummary] = useState<string>('Select a location to generate an AI summary.');
  const [isLoading, setIsLoading] = useState(false);

  const dailyData = useMemo(() => {
    if (!weatherData) return null;
    const today = new Date().toLocaleString('en-US', { weekday: 'short' });
    return weatherData.daily.find(d => d.day.startsWith(today)) || weatherData.daily[0];
  }, [weatherData]);
  
  useEffect(() => {
    if (!weatherData || !dailyData) {
      setSummary('Not enough data to generate a summary.');
      return;
    }

    const fetchSummary = async () => {
      setIsLoading(true);
      setSummary('Generating AI summary...');
      try {
        const input = {
          location: weatherData.city,
          date: new Date().toISOString().split('T')[0],
          temperatureHigh: dailyData.high,
          temperatureLow: dailyData.low,
          precipitationProbability: weatherData.details.precipitation / 100,
          windSpeed: weatherData.details.windSpeed,
          weatherDescription: dailyData.description,
        };
        const result = await getAiSummary(input);
        setSummary(result.summary);
      } catch (error) {
        setSummary('Failed to generate AI summary.');
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSummary();
  }, [weatherData, dailyData]);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">AI Daily Summary</CardTitle>
        <Bot className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground pt-4">
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-4 bg-muted rounded w-3/4 animate-pulse"></div>
              <div className="h-4 bg-muted rounded w-full animate-pulse"></div>
              <div className="h-4 bg-muted rounded w-1/2 animate-pulse"></div>
            </div>
          ) : (
            summary
          )}
        </div>
      </CardContent>
    </Card>
  );
}
