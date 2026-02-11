'use server';

/**
 * @fileOverview Generates a weather forecast using AI based on real-time and historical data.
 *
 * - generateForecast - A function that generates a weather forecast.
 * - GenerateForecastInput - The input type for the generateForecast function.
 * - GenerateForecastOutput - The return type for the generateForecast function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateForecastInputSchema = z.object({
  location: z.string().describe('The location for which to generate the weather forecast.'),
  date: z.string().describe('The date for which to generate the weather forecast (YYYY-MM-DD).'),
});
export type GenerateForecastInput = z.infer<typeof GenerateForecastInputSchema>;

const GenerateForecastOutputSchema = z.object({
  forecast: z.string().describe('The weather forecast for the specified location and date.'),
});
export type GenerateForecastOutput = z.infer<typeof GenerateForecastOutputSchema>;

export async function generateForecast(input: GenerateForecastInput): Promise<GenerateForecastOutput> {
  return generateForecastFlow(input);
}

const weatherForecastPrompt = ai.definePrompt({
  name: 'weatherForecastPrompt',
  input: {schema: GenerateForecastInputSchema},
  output: {schema: GenerateForecastOutputSchema},
  prompt: `You are a weather forecasting expert. Generate a detailed weather forecast for the following location and date, using all available real-time and historical data.

Location: {{{location}}}
Date: {{{date}}}

Forecast:`,
});

const generateForecastFlow = ai.defineFlow(
  {
    name: 'generateForecastFlow',
    inputSchema: GenerateForecastInputSchema,
    outputSchema: GenerateForecastOutputSchema,
  },
  async input => {
    const {output} = await weatherForecastPrompt(input);
    return output!;
  }
);
