// next.config.ts
import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Tell next-intl where your i18n config is
const withNextIntl = createNextIntlPlugin('./i18n.ts');

const nextConfig: NextConfig = {
  // your other config if you add some later
};

export default withNextIntl(nextConfig);
