"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useLocale } from "next-intl";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const navLinks = [
  { href: "", label: "Home" },
  { href: "/trade", label: "Trade" },
  { href: "/earn", label: "Earn" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/how-it-works", label: "How It Works" },
];

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const locale = useLocale();
  const pathname = usePathname();
  const base = `/${locale}`;

  return (
    <header
      id="header"
      className="border-b border-gray-200 bg-white/80 backdrop-blur-lg fixed w-full top-0 z-50 shadow-sm"
    >
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Left: logo + nav */}
          <div className="flex items-center space-x-12">
            <Link href={base} className="flex items-center">
              <Image
                src="/images/logo/logo.png"
                alt="Scall Logo"
                width={150}     // tu peux ajuster
                height={150}
                className="rounded" // retire-le si tu veux un logo carré
              />
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center space-x-8">
              {navLinks.map((link) => {
                const fullPath = `${base}${link.href}`;

                const isActive =
                  pathname === fullPath ||
                  (link.href === "" && pathname === base);

                return (
                  <Link
                    key={link.label}
                    href={fullPath}
                    className={
                      isActive
                        ? "text-primary font-semibold transition"
                        : "text-gray-600 hover:text-gray-900 font-medium transition"
                    }
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: wallet + mobile menu */}
          <div className="flex items-center space-x-4">
            {/* Desktop wallet button using RainbowKit */}
            <ConnectButton.Custom>
              {({
                account,
                chain,
                openAccountModal,
                openConnectModal,
                mounted,
              }) => {
                const ready = mounted;
                const connected = ready && account && chain;

                return (
                  <button
                    type="button"
                    onClick={connected ? openAccountModal : openConnectModal}
                    className="
                      hidden md:block 
                      bg-gradient-to-r from-primary to-secondary 
                      px-6 py-2.5 rounded-lg 
                      font-semibold text-white
                      transition-all duration-200 
                      hover:shadow-lg hover:shadow-primary/50 
                      hover:-translate-y-0.5 
                      active:scale-95
                      cursor-pointer
                    "
                  >
                    {connected
                      ? account.displayName // e.g., 0x1234…abcd
                      : "Connect Wallet"}
                  </button>
                );
              }}
            </ConnectButton.Custom>

            {/* Mobile menu toggle */}
            <button
              className="md:hidden text-gray-600 hover:text-gray-900 transition-all duration-200 hover:-translate-y-0.5 hover:scale-110 active:scale-95 cursor-pointer"
              onClick={() => setIsOpen((prev) => !prev)}
              aria-label="Toggle navigation"
            >
              <i className="fas fa-bars text-xl" />
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {isOpen && (
          <nav className="md:hidden mt-4 space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={`${base}${link.href}`}
                className="block px-2 py-2 rounded-lg text-gray-700 hover:bg-gray-100"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}

            {/* Mobile wallet button */}
            <ConnectButton.Custom>
              {({
                account,
                chain,
                openAccountModal,
                openConnectModal,
                mounted,
              }) => {
                const ready = mounted;
                const connected = ready && account && chain;

                return (
                  <button
                    type="button"
                    onClick={connected ? openAccountModal : openConnectModal}
                    className="
                      mt-2 w-full 
                      bg-gradient-to-r from-primary to-secondary 
                      px-4 py-2.5 rounded-lg 
                      font-semibold text-white
                      transition-all duration-200 
                      hover:shadow-lg hover:shadow-primary/40 
                      hover:-translate-y-0.5 
                      active:scale-95
                      cursor-pointer
                    "
                  >
                    {connected
                      ? account.displayName
                      : "Connect Wallet"}
                  </button>
                );
              }}
            </ConnectButton.Custom>
          </nav>
        )}
      </div>
    </header>
  );
}
