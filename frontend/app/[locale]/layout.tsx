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

export default async function LocaleLayout(props: {
  children: ReactNode;
  params: Promise<{locale: Locale}>;
}) {
  const {children} = props;
  const {locale} = await props.params;

  if (!locales.includes(locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Header />

      {/* FULL-WIDTH MAIN: removed max-w-5xl, mx-auto, px-4 */}
      <main className="flex-1 w-full" suppressHydrationWarning>
        {children}
      </main>

      <Footer />
    </NextIntlClientProvider>
  );
}
