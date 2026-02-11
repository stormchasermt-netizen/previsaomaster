'use server';

import { summarizeDailyWeather, type SummarizeDailyWeatherInput } from '@/ai/flows/summarize-daily-weather';
import { generateForecast, type GenerateForecastInput } from '@/ai/flows/generate-forecast';

export async function getAiSummary(input: SummarizeDailyWeatherInput) {
  try {
    const summary = await summarizeDailyWeather(input);
    return summary;
  } catch (error) {
    console.error('Error generating AI summary:', error);
    return { summary: 'Could not generate AI summary at this time.' };
  }
}

export async function getAiForecast(input: GenerateForecastInput) {
  try {
    const forecast = await generateForecast(input);
    return forecast;
  } catch (error) {
    console.error('Error generating AI forecast:', error);
    return { forecast: 'Could not generate AI forecast at this time.' };
  }
}
