'use server';
/**
 * @fileOverview A daily weather summary AI agent.
 *
 * - summarizeDailyWeather - A function that handles the daily weather summary generation.
 * - SummarizeDailyWeatherInput - The input type for the summarizeDailyWeather function.
 * - SummarizeDailyWeatherOutput - The return type for the summarizeDailyWeather function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeDailyWeatherInputSchema = z.object({
  location: z.string().describe('The location for which to summarize the weather.'),
  date: z.string().describe('The date for which to summarize the weather in ISO format (YYYY-MM-DD).'),
  temperatureHigh: z.number().describe('The high temperature in Celsius.'),
  temperatureLow: z.number().describe('The low temperature in Celsius.'),
  precipitationProbability: z.number().describe('The probability of precipitation as a decimal between 0 and 1.'),
  windSpeed: z.number().describe('The average wind speed in kilometers per hour.'),
  weatherDescription: z.string().describe('A detailed description of the weather conditions.'),
});
export type SummarizeDailyWeatherInput = z.infer<typeof SummarizeDailyWeatherInputSchema>;

const SummarizeDailyWeatherOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the daily weather conditions and potential impacts.'),
});
export type SummarizeDailyWeatherOutput = z.infer<typeof SummarizeDailyWeatherOutputSchema>;

export async function summarizeDailyWeather(input: SummarizeDailyWeatherInput): Promise<SummarizeDailyWeatherOutput> {
  return summarizeDailyWeatherFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeDailyWeatherPrompt',
  input: {schema: SummarizeDailyWeatherInputSchema},
  output: {schema: SummarizeDailyWeatherOutputSchema},
  prompt: `You are a weather forecaster, providing daily weather summaries.

  Location: {{{location}}}
  Date: {{{date}}}
  High Temperature: {{{temperatureHigh}}}°C
  Low Temperature: {{{temperatureLow}}}°C
  Precipitation Probability: {{{precipitationProbability}}}
  Wind Speed: {{{windSpeed}}} km/h
  Weather Description: {{{weatherDescription}}}

  Generate a concise summary of the day's weather conditions and potential impacts for the general public.`,
});

const summarizeDailyWeatherFlow = ai.defineFlow(
  {
    name: 'summarizeDailyWeatherFlow',
    inputSchema: SummarizeDailyWeatherInputSchema,
    outputSchema: SummarizeDailyWeatherOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
