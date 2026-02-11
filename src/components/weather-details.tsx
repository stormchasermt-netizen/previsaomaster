import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WeatherData } from '@/lib/types';
import { Droplets, Wind, Sun, Umbrella } from 'lucide-react';

export function WeatherDetails({ weatherData }: { weatherData: WeatherData }) {
  const { humidity, windSpeed, uvIndex, precipitation } = weatherData.details;

  const details = [
    {
      icon: <Droplets className="h-6 w-6 text-primary" />,
      title: 'Humidity',
      value: `${humidity}%`,
      description: 'The amount of moisture in the air.',
    },
    {
      icon: <Wind className="h-6 w-6 text-primary" />,
      title: 'Wind Speed',
      value: `${windSpeed} km/h`,
      description: 'Current wind speed.',
    },
    {
      icon: <Sun className="h-6 w-6 text-primary" />,
      title: 'UV Index',
      value: `${uvIndex} of 11`,
      description: 'Risk of harm from UV radiation.',
    },
    {
      icon: <Umbrella className="h-6 w-6 text-primary" />,
      title: 'Precipitation',
      value: `${precipitation}%`,
      description: 'Probability of rain or snow.',
    },
  ];

  return (
    <>
      {details.map((detail, index) => (
        <Card key={index} className="col-span-2 md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{detail.title}</CardTitle>
            {detail.icon}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{detail.value}</div>
            <p className="text-xs text-muted-foreground">{detail.description}</p>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
