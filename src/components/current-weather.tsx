import { Card, CardContent } from '@/components/ui/card';
import type { WeatherData } from '@/lib/types';
import { WeatherIcon } from '@/lib/weather-icons';
import { format } from 'date-fns';

export function CurrentWeather({ weatherData }: { weatherData: WeatherData }) {
  const currentDate = format(new Date(), "EEEE, MMMM do");

  return (
    <Card className="col-span-4 md:col-span-2 lg:col-span-3 bg-primary/10 border-primary/20">
      <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-6">
          <WeatherIcon iconName={weatherData.currentWeatherIcon} className="w-20 h-20 text-primary" />
          <div>
            <p className="text-lg font-medium text-primary-foreground">{weatherData.city}, {weatherData.country}</p>
            <p className="text-6xl font-bold text-primary-foreground">{Math.round(weatherData.currentTemp)}°</p>
            <p className="text-muted-foreground capitalize">{weatherData.currentWeather}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-primary-foreground">{currentDate}</p>
          <p className="text-muted-foreground">High: {Math.round(weatherData.daily[0].high)}° / Low: {Math.round(weatherData.daily[0].low)}°</p>
        </div>
      </CardContent>
    </Card>
  );
}
