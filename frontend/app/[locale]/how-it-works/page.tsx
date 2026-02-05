import { useLocale } from "next-intl";
import Link from "next/link";

export default function HowItWorksPage() {
  const locale = useLocale();

  return (
    <main
      id="how-it-works-page"
      className="pt-20 sm:pt-24 pb-10 sm:pb-12 bg-light text-gray-900"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        {/* Page header */}
        <section id="page-header" className="text-center mb-10 sm:mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold mb-3 sm:mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            How It Works
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-gray-600 max-w-2xl mx-auto">
            Learn how to use Scall.io to trade perpetual options and provide
            liquidity
          </p>
        </section>

        {/* Using Collateral */}
        <section id="collateral-section" className="mb-12 sm:mb-20">
          <div className="flex items-center mb-6 sm:mb-8">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center mr-3 sm:mr-4">
              <i className="fas fa-wallet text-blue-600 text-xl sm:text-2xl" />
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Using Collateral
              </h2>
              <p className="text-sm sm:text-base text-gray-600 mt-1">
                Deposit USDC to start trading perpetual options
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 md:gap-8 mb-6 sm:mb-8">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm">
              <div className="flex items-start mb-4">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mr-4 flex-shrink-0">
                  <span className="text-primary font-bold text-lg">1</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">
                    Deposit Collateral
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    Navigate to the Dashboard and deposit USDC into your
                    collateral account. This acts as your trading balance for
                    opening perpetual options positions.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm">
              <div className="flex items-start mb-4">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mr-4 flex-shrink-0">
                  <span className="text-primary font-bold text-lg">2</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-2">
                    Monitor Your Balance
                  </h3>
                  <p className="text-gray-600 leading-relaxed text-sm sm:text-base">
                    Your collateral covers rent paid each second for all open
                    positions. Keep track of your total collateral, rent costs,
                    and withdrawable amounts in real-time.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trading section */}
        <section id="trading-section" className="mb-12 sm:mb-20">
          <div className="flex items-center mb-6 sm:mb-8">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-xl flex items-center justify-center mr-3 sm:mr-4">
              <i className="fas fa-chart-line text-green-600 text-xl sm:text-2xl" />
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Opening Perpetual Options
              </h2>
              <p className="text-sm sm:text-base text-gray-600 mt-1">
                Trade calls and puts on BTC, ETH and other tokens with flexible
                positions
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-start mb-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
                  <span className="text-green-600 font-bold text-lg">1</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                    Choose Type
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Select Call (bullish) or Put (bearish) based on your market
                    outlook.
                  </p>
                </div>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-gray-700">
                  <strong>Call:</strong> Profit when price goes up
                </p>
                <p className="text-xs text-gray-700 mt-1">
                  <strong>Put:</strong> Profit when price goes down
                </p>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-start mb-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
                  <span className="text-green-600 font-bold text-lg">2</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                    Select Asset &amp; Strike
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Pick your asset (BTC/ETH) and strike price from available
                    options.
                  </p>
                </div>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-gray-700">
                  <strong>Strike:</strong> The price level where your option
                  becomes profitable
                </p>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-start mb-4">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
                  <span className="text-green-600 font-bold text-lg">3</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                    Set Amount &amp; Open
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Choose your position size and confirm the rent cost.
                  </p>
                </div>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-gray-700">
                  <strong>Weekly Rent:</strong> The cost to keep your position
                  open. Calculated for a week.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border-2 border-orange-300 rounded-2xl p-5 sm:p-6">
            <div className="flex items-start">
              <i className="fas fa-lightbulb text-orange-500 text-xl sm:text-2xl mr-3 sm:mr-4 mt-1" />
              <div className="min-w-0">
                <h4 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                  Trading Tips
                </h4>
                <ul className="space-y-2 text-gray-700 text-sm sm:text-base">
                  <li className="flex items-start">
                    <i className="fas fa-check text-orange-500 mr-2 mt-1" />
                    <span>
                      Execute positions when they&apos;re profitable to realize
                      gains
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="fas fa-check text-orange-500 mr-2 mt-1" />
                    <span>
                      Close positions to stop paying rent if market moves against
                      you
                    </span>
                  </li>
                  <li className="flex items-start">
                    <i className="fas fa-check text-orange-500 mr-2 mt-1" />
                    <span>
                      Monitor your P&amp;L and rent costs regularly in the
                      Dashboard
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Providing Liquidity */}
        <section id="liquidity-section" className="mb-12 sm:mb-20">
          <div className="flex items-center mb-6 sm:mb-8">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-purple-100 rounded-xl flex items-center justify-center mr-3 sm:mr-4">
              <i className="fas fa-coins text-purple-600 text-xl sm:text-2xl" />
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Providing Liquidity
              </h2>
              <p className="text-sm sm:text-base text-gray-600 mt-1">
                Earn passive income by providing liquidity to traders
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-start mb-4">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
                  <span className="text-purple-600 font-bold text-lg">1</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                    Choose Side
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Select Call Liquidity (deposit BTC/ETH) or Put Liquidity
                    (deposit USDC).
                  </p>
                </div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-xs text-gray-700">
                  <strong>Call LP:</strong> Earn from call traders
                </p>
                <p className="text-xs text-gray-700 mt-1">
                  <strong>Put LP:</strong> Earn from put traders
                </p>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-start mb-4">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
                  <span className="text-purple-600 font-bold text-lg">2</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                    Deposit Amount
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Enter the amount you want to provide and review the
                    estimated APR.
                  </p>
                </div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-xs text-gray-700">
                  <strong>APR:</strong> Annual percentage rate you&apos;ll earn
                  from rent payments if the whole liquidity is used.
                </p>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-start mb-4">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mr-3 flex-shrink-0">
                  <span className="text-purple-600 font-bold text-lg">3</span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-2">
                    Monitor your position
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Keep an eye on your liquidity and claim rewards.
                  </p>
                </div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <p className="text-xs text-gray-700">
                  <strong>Trade:</strong> You can trade your position at any
                  time.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
            <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-4">
              Managing Your LP Positions
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-start mb-3">
                  <i className="fas fa-coins text-green-600 text-xl mr-3 mt-1" />
                  <div className="min-w-0">
                    <h4 className="font-semibold text-gray-900 mb-1">
                      Claim Rewards
                    </h4>
                    <p className="text-sm text-gray-600">
                      Collect your accumulated earnings from rent payments
                      anytime from the Dashboard.
                    </p>
                  </div>
                </div>

                <div className="flex items-start">
                  <i className="fas fa-arrow-down text-blue-600 text-xl mr-3 mt-1" />
                  <div className="min-w-0">
                    <h4 className="font-semibold text-gray-900 mb-1">
                      Withdraw Liquidity
                    </h4>
                    <p className="text-sm text-gray-600">
                      Remove available liquidity from your positions at any
                      time. Locked amounts will be available when traders close
                      positions.
                    </p>
                  </div>
                </div>
              </div>

              {/* Right column intentionally left for future content (keeps layout balanced on desktop) */}
              <div className="hidden md:block" />
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section
          id="getting-started-cta"
          className="bg-gradient-to-br from-primary to-secondary rounded-3xl p-6 sm:p-10 md:p-12 text-center text-white"
        >
          <h2 className="text-2xl sm:text-4xl font-bold mb-3 sm:mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-base sm:text-lg md:text-xl text-white/90 mb-6 sm:mb-8 max-w-2xl mx-auto">
            Connect your wallet and start trading perpetual options or providing
            liquidity today
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link
              href={`/${locale}/trade`}
              className="cursor-pointer w-full sm:w-auto bg-white/10 backdrop-blur-sm border-2 border-white text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg hover:bg-white/20 transition"
            >
              Start Trading
            </Link>
            <Link
              href={`/${locale}/liquidity`}
              className="cursor-pointer w-full sm:w-auto bg-white/10 backdrop-blur-sm border-2 border-white text-white px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg hover:bg-white/20 transition"
            >
              Provide Liquidity
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
