import {getRequestConfig} from 'next-intl/server';

const availableLocales = ['en', 'fr'] as const;
const fallbackLocale = 'en';

export default getRequestConfig(async ({locale}) => {
  // Make sure we always have a valid locale
  const currentLocale =
    locale && availableLocales.includes(locale as any)
      ? locale
      : fallbackLocale;

  return {
    // ✅ Required by RequestConfig
    locale: currentLocale,

    // ✅ Load the JSON from /messages
    messages: (await import(`./messages/${currentLocale}.json`)).default
  };
});

