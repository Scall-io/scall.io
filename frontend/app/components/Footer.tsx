import Link from "next/link";
import Image from "next/image";
import { useLocale } from "next-intl";

export default function Footer() {
  const locale = useLocale();
  const base = `/${locale}`;

  return (
    <footer id="footer" className="bg-gray-900 text-white py-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div>
            <Link href={base} className="flex items-center mb-2">
              <Image
                src="/images/logo/logo_wb.png"
                alt="Scall Logo"
                width={150}     // tu peux ajuster
                height={150}
                className="rounded" // retire-le si tu veux un logo carré
              />
            </Link>
            <p className="text-gray-400 text-sm">
              The leading perpetual options protocol in DeFi.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <a href={`/${locale}/trade`} className="hover:text-white transition">
                  Trade
                </a>
              </li>
              <li>
                <a href={`/${locale}/earn`} className="hover:text-white transition">
                  Earn
                </a>
              </li>
              <li>
                <a href={`/${locale}/dashboard`} className="hover:text-white transition">
                  Dashboard
                </a>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="font-semibold mb-4">Resources</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <a href="#" className="hover:text-white transition">
                  Documentation
                </a>
              </li>
              <li>
                <a href={`/${locale}/how-it-works`} className="hover:text-white transition">
                  How It Works
                </a>
              </li>
              <li>
                <a href={`/${locale}#faq-section`} className="hover:text-white transition">
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          {/* You can add a 4th column here (Community, Legal, etc.) */}
          <div>
            <h4 className="font-semibold mb-4">Community</h4>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>
                <a href="https://x.com/Scall_io_App" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">
                  Twitter
                </a>
              </li>
              <li>
                <a href="https://t.me/+yQJeRfGFlCE0NTA0" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">
                  Telegram
                </a>
              </li>
              <li>
                <a href="mailto:support@scall.io" className="hover:text-white transition">
                    Support
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom line */}
        <div className="border-t border-gray-800 pt-6 flex flex-col md:flex-row items-center justify-between text-xs text-gray-500 gap-2">
          <span>© {new Date().getFullYear()} Scall.io. All rights reserved.</span>
          <div className="flex gap-4">
            <a href="#" className="hover:text-white transition">
              Terms
            </a>
            <a href="#" className="hover:text-white transition">
              Privacy
            </a>
            <a href="#" className="hover:text-white transition">
              Cookies
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
