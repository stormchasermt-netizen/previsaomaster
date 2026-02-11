export interface HourlyData {
  time: string;
  temp: number;
  icon: string;
}

export interface DailyData {
  day: string;
  high: number;
  low: number;
  icon: string;
  description: string;
}

export interface WeatherDetails {
  humidity: number;
  windSpeed: number;
  uvIndex: number;
  precipitation: number;
}

export interface WeatherData {
  city: string;
  country: string;
  currentTemp: number;
  currentWeather: string;
  currentWeatherIcon: string;
  hourly: HourlyData[];
  daily: DailyData[];
  details: WeatherDetails;
  lat: number;
  lng: number;
}
