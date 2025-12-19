// app/[locale]/layout.tsx
import type {ReactNode} from 'react';
import {NextIntlClientProvider} from 'next-intl';
import {getMessages} from 'next-intl/server';
import {notFound} from 'next/navigation';

import Header from '../components/Header';
import Footer from '../components/Footer';

const locales = ['en', 'fr'] as const;
type Locale = (typeof locales)[number];

export function generateStaticParams() {
  return locales.map((locale) => ({locale}));
}

function isLocale(l: string): l is Locale {
  return (locales as readonly string[]).includes(l);
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) notFound();

  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Header />
      <main className="flex-1 w-full" suppressHydrationWarning>
        {children}
      </main>
      <Footer />
    </NextIntlClientProvider>
  );
}

