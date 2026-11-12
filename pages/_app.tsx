import type { AppProps } from 'next/app'
import Head from 'next/head'
import { LanguageProvider } from '../src/ui/i18n'
import './globals.css'
export default function App({ Component, pageProps }: AppProps) {
  return (
    <LanguageProvider initialLanguage={pageProps.lang}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <link rel="icon" href="/mark.svg" />
      </Head>
      <Component {...pageProps} />
    </LanguageProvider>
  )
}
