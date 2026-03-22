import { Providers } from './providers';
import AppLayout from '@/components/Layout';
import I18nClient from '@/components/i18n-client';

export const metadata: Metadata = {
  title: 'Previsão Master',
  description: 'Um jogo de previsão de tempo severo para a América do Sul.',
};

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "COLE_SUA_CHAVE_DE_API_DO_GOOGLE_MAPS_AQUI";
// ID da métrica do GA4 (Fluxo do site). Sobrescreva com NEXT_PUBLIC_GA_MEASUREMENT_ID se necessário.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || 'G-L9DJ8DDGCP';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (GOOGLE_MAPS_API_KEY.startsWith("COLE_SUA_CHAVE")) {
    console.error("ERRO: A chave de API do Google Maps não foi configurada. Edite o arquivo app/layout.tsx ou a variável de ambiente NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.");
  }
  
  return (
    <html lang="pt-BR" className="dark">
      <body>
        <Providers>
          <I18nClient>
            <AppLayout>
              {children}
            </AppLayout>
          </I18nClient>
        </Providers>
        <Script src="/turf.min.js" strategy="beforeInteractive" />
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=weekly&libraries=drawing,geometry&loading=async`}
          strategy="afterInteractive"
        />
        {GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
