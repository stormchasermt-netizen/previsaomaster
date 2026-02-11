import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WeatherData } from '@/lib/types';
import { WeatherIcon } from '@/lib/weather-icons';
import { CalendarDays } from 'lucide-react';

export function SevenDayForecast({ weatherData }: { weatherData: WeatherData }) {
  return (
    <Card className="col-span-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          7-Day Forecast
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {weatherData.daily.map((day, index) => (
            <li key={index} className="flex items-center justify-between py-3">
              <span className="font-medium w-1/4">{day.day}</span>
              <div className="flex items-center gap-2 w-1/2">
                <WeatherIcon iconName={day.icon} className="w-6 h-6 text-primary" />
                <span className="text-muted-foreground capitalize text-sm">{day.description}</span>
              </div>
              <span className="font-medium text-right w-1/4 text-muted-foreground">
                {Math.round(day.high)}° / {Math.round(day.low)}°
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
