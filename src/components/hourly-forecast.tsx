'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WeatherData } from '@/lib/types';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Line, LineChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import { Clock } from 'lucide-react';
import { useMemo } from 'react';

export function HourlyForecast({ weatherData }: { weatherData: WeatherData }) {
  const chartData = useMemo(() => {
    return weatherData.hourly.map(h => ({
      time: h.time,
      temp: h.temp,
    }));
  }, [weatherData]);

  const chartConfig = {
    temp: {
      label: "Temp (°C)",
      color: "hsl(var(--primary))",
    },
  };

  return (
    <Card className="col-span-4 md:col-span-2 lg:col-span-1">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Hourly Forecast</CardTitle>
        <Clock className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent className="h-[100px]">
        <ChartContainer config={chartConfig} className="w-full h-full">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="time" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} tickLine={false} axisLine={false} domain={['dataMin - 2', 'dataMax + 2']}/>
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" hideLabel />} />
            <Line dataKey="temp" type="monotone" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
