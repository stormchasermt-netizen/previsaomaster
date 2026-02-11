'use client';

import { useState, useEffect } from 'react';
import { DashboardPage } from '@/components/dashboard-page';
import type { WeatherData } from '@/lib/types';
import { CITIES_WEATHER_DATA, DEFAULT_CITY } from '@/lib/mock-data';

export default function Home() {
  const [selectedCity, setSelectedCity] = useState<string>(DEFAULT_CITY);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cityData = CITIES_WEATHER_DATA.find(
      (data) => data.city.toLowerCase() === selectedCity.toLowerCase()
    );
    if (cityData) {
      setWeatherData(cityData);
      setError(null);
    } else {
      setWeatherData(null);
      setError(`Weather data for "${selectedCity}" not found. Please try another city.`);
    }
  }, [selectedCity]);

  const handleLocationSearch = (city: string) => {
    const newCityData = CITIES_WEATHER_DATA.find(
      (data) => data.city.toLowerCase() === city.toLowerCase()
    );
    if (newCityData) {
      setSelectedCity(newCityData.city);
    } else {
      setError(`Weather data for "${city}" not found. Please try a different city like New York, London, or Tokyo.`);
      setWeatherData(null);
    }
  };

  return (
    <DashboardPage
      weatherData={weatherData}
      onLocationSearch={handleLocationSearch}
      error={error}
      currentCity={selectedCity}
    />
  );
}
