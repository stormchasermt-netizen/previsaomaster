'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, Plus, Trash2, Wind, Droplet, Thermometer } from 'lucide-react';
import type { WeatherData } from '@/lib/types';

interface Alert {
  id: number;
  metric: 'temp' | 'wind' | 'rain';
  condition: 'above' | 'below';
  value: number;
  enabled: boolean;
}

const initialAlerts: Alert[] = [
  { id: 1, metric: 'temp', condition: 'above', value: 30, enabled: true },
  { id: 2, metric: 'wind', condition: 'above', value: 50, enabled: false },
];

const metricIcons = {
  temp: <Thermometer className="w-4 h-4 mr-2" />,
  wind: <Wind className="w-4 h-4 mr-2" />,
  rain: <Droplet className="w-4 h-4 mr-2" />,
};

const metricLabels = {
  temp: 'Temperature (°C)',
  wind: 'Wind Speed (km/h)',
  rain: 'Precipitation (%)',
};

export function AlertsPanel({ weatherData }: { weatherData: WeatherData | null }) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const toggleAlert = (id: number) => {
    setAlerts(alerts.map(alert => alert.id === id ? { ...alert, enabled: !alert.enabled } : alert));
  };
  
  const deleteAlert = (id: number) => {
    setAlerts(alerts.filter(alert => alert.id !== id));
  };

  const addAlert = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newAlert: Alert = {
      id: Date.now(),
      metric: formData.get('metric') as 'temp' | 'wind' | 'rain',
      condition: formData.get('condition') as 'above' | 'below',
      value: Number(formData.get('value')),
      enabled: true,
    };
    setAlerts([...alerts, newAlert]);
    setIsDialogOpen(false);
  };
  
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Custom Alerts</CardTitle>
            <CardDescription>Get notified about specific weather conditions.</CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost"><Plus className="h-5 w-5" /></Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Alert</DialogTitle>
              </DialogHeader>
              <form onSubmit={addAlert}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="metric" className="text-right">Metric</Label>
                    <Select name="metric" defaultValue="temp">
                      <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select a metric" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="temp">Temperature</SelectItem>
                        <SelectItem value="wind">Wind Speed</SelectItem>
                        <SelectItem value="rain">Precipitation</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="condition" className="text-right">Condition</Label>
                     <Select name="condition" defaultValue="above">
                      <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select a condition" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="above">Is Above</SelectItem>
                        <SelectItem value="below">Is Below</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                   <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="value" className="text-right">Value</Label>
                    <Input id="value" name="value" type="number" defaultValue="25" className="col-span-3" required />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit">Create Alert</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {alerts.length > 0 ? alerts.map(alert => {
            const isTriggered = weatherData && alert.enabled && (
              (alert.metric === 'temp' && (alert.condition === 'above' ? weatherData.currentTemp > alert.value : weatherData.currentTemp < alert.value)) ||
              (alert.metric === 'wind' && (alert.condition === 'above' ? weatherData.details.windSpeed > alert.value : weatherData.details.windSpeed < alert.value)) ||
              (alert.metric === 'rain' && (alert.condition === 'above' ? weatherData.details.precipitation > alert.value : weatherData.details.precipitation < alert.value))
            );

            return (
              <div key={alert.id} className={`flex items-center justify-between p-3 rounded-lg ${isTriggered ? 'bg-accent/30 border border-accent' : 'bg-secondary'}`}>
                <div className="flex items-center">
                  {isTriggered && <Bell className="h-4 w-4 mr-3 text-accent-foreground animate-pulse" />}
                  {metricIcons[alert.metric]}
                  <span className="text-sm font-medium">{metricLabels[alert.metric]} is {alert.condition} {alert.value}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={alert.enabled} onCheckedChange={() => toggleAlert(alert.id)} />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteAlert(alert.id)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            );
          }) : (
            <div className="text-center text-muted-foreground py-8">
              <Bell className="mx-auto h-8 w-8 mb-2"/>
              <p>No custom alerts set.</p>
              <p className="text-xs">Click the '+' to add one.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
