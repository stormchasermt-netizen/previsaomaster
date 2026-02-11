import { Sun, Cloud, CloudRain, CloudSnow, Wind, Zap, CloudSun, Moon } from 'lucide-react';
import type { LucideProps } from 'lucide-react';

const iconComponents: { [key: string]: React.ElementType } = {
  Sunny: Sun,
  Cloudy: Cloud,
  Rainy: CloudRain,
  Snowy: CloudSnow,
  Windy: Wind,
  Thunderstorm: Zap,
  'Partly cloudy': CloudSun,
  Clear: Moon, // For clear night
};

interface WeatherIconProps extends LucideProps {
  iconName: string;
}

export const WeatherIcon = ({ iconName, ...props }: WeatherIconProps) => {
  // A simple fallback for case-insensitivity and partial matches
  const lowerIconName = iconName.toLowerCase();
  let selectedIconKey = Object.keys(iconComponents).find(key => key.toLowerCase() === lowerIconName);
  
  if (!selectedIconKey) {
     if (lowerIconName.includes('sun')) selectedIconKey = 'Sunny';
     else if (lowerIconName.includes('cloud')) selectedIconKey = 'Cloudy';
     else if (lowerIconName.includes('rain')) selectedIconKey = 'Rainy';
     else if (lowerIconName.includes('snow')) selectedIconKey = 'Snowy';
     else if (lowerIconName.includes('wind')) selectedIconKey = 'Windy';
     else if (lowerIconName.includes('storm')) selectedIconKey = 'Thunderstorm';
     else if (lowerIconName.includes('clear')) selectedIconKey = 'Clear';
  }

  const IconComponent = selectedIconKey ? iconComponents[selectedIconKey] : Sun; // Default to Sun icon

  return <IconComponent {...props} />;
};
