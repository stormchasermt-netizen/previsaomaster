import './globals.css';
import type { Metadata } from 'next';
import Script from 'next/script';
import { Providers } from './providers';
import AppLayout from '@/components/Layout';

export const metadata: Metadata = {
  title: 'Previsão Master',
  description: 'Um jogo de previsão de tempo severo para a América do Sul.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/react-image-crop/dist/ReactCrop.css" />
      </head>
      <body>
        <Providers>
          <AppLayout>
            {children}
          </AppLayout>
        </Providers>
        <Script src="https://accounts.google.com/gsi/client" async defer />
        <Script src="https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js" />
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=AIzaSyB_w5sufKkLUMOdPVZCjD7YOrv_A9QJm2s&v=weekly&libraries=drawing,geometry`}
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}