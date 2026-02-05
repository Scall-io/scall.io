"use client";

import { useState } from "react";

export default function TokenPage() {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [fromAmount, setFromAmount] = useState("1000");
  const [toAmount, setToAmount] = useState("22222.22");
  const [exchangeRateLabel, setExchangeRateLabel] = useState("1 USDC = 22.22 CALL");
  const [priceImpactLabel, setPriceImpactLabel] = useState("< 0.1%");
  const [priceImpactIsPositive, setPriceImpactIsPositive] = useState(true);

  const isBuyMode = mode === "buy";

  const handleToggleMode = () => {
    setMode((prev) => {
      const next = prev === "buy" ? "sell" : "buy";

      if (next === "buy") {
        setFromAmount("1000");
        setToAmount("22222.22");
        setExchangeRateLabel("1 USDC = 22.22 CALL");
        setPriceImpactLabel("< 0.1%");
        setPriceImpactIsPositive(true);
      } else {
        setFromAmount("5000");
        setToAmount("225.00");
        setExchangeRateLabel("1 CALL = 0.045 USDC");
        setPriceImpactLabel("0.3%");
        setPriceImpactIsPositive(false);
      }

      return next;
    });
  };

  const handleSetMax = () => {
    if (isBuyMode) {
      setFromAmount("5000");
      setToAmount("111111.11");
    } else {
      setFromAmount("12450");
      setToAmount("560.25");
    }
  };

  return (
    <main
      id="call-token-page"
      className="pt-20 sm:pt-24 pb-10 sm:pb-12 flex-1"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Swap section */}
        <section id="swap-section" className="flex justify-center mt-6 sm:mt-8 mb-8">
          <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 md:p-8 shadow-sm w-full max-w-lg">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 mb-6 md:mb-8">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Swap
              </h2>
              <div className="flex items-center rounded-full px-3 py-1">
                <span className="text-xs font-semibold text-pink-600 uppercase tracking-wide">
                  Powered by Uniswap
                </span>
              </div>
            </div>

            <div className="space-y-4">
              {/* From */}
              <div>
                <label className="text-sm text-gray-600 mb-2 block">From</label>
                <div
                  id="from-input"
                  className={[
                    "rounded-xl p-4 border",
                    isBuyMode
                      ? "bg-gray-50 border-gray-300"
                      : "bg-primary/5 border-primary/20",
                  ].join(" ")}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4 mb-2">
                    {isBuyMode ? (
                      <>
                        <span
                          id="from-token"
                          className="bg-transparent text-lg font-semibold text-gray-900 focus:outline-none"
                        >
                          USDC
                        </span>

                        <span id="from-balance" className="text-sm text-gray-500">
                          Balance: 5,000 USDC
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-gradient-to-r from-primary to-secondary rounded-full flex items-center justify-center mr-2">
                            <i className="fas fa-coins text-white text-sm" />
                          </div>
                          <span className="text-lg font-semibold text-gray-900">
                            CALL
                          </span>
                        </div>
                        <span className="text-sm text-gray-500">
                          Balance: 12,450 CALL
                        </span>
                      </>
                    )}
                  </div>
                  <input
                    id="from-amount"
                    type="number"
                    value={fromAmount}
                    onChange={(e) => setFromAmount(e.target.value)}
                    className="w-full bg-transparent text-xl sm:text-2xl font-bold text-gray-900 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSetMax}
                    className="text-xs text-primary hover:text-secondary font-semibold mt-2"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Swap arrow */}
              <div className="flex justify-center py-1">
                <button
                  type="button"
                  onClick={handleToggleMode}
                  className="cursor-pointer w-12 h-12 bg-gradient-to-r from-primary to-secondary rounded-full flex items-center justify-center hover:shadow-lg hover:shadow-primary/30 transition transform hover:scale-110 group"
                >
                  <i
                    id="swap-arrow"
                    className="fas fa-exchange-alt text-white text-lg group-hover:rotate-180 transition-transform duration-300"
                  />
                </button>
              </div>

              {/* To */}
              <div>
                <label className="text-sm text-gray-600 mb-2 block">To</label>
                <div
                  id="to-input"
                  className={[
                    "rounded-xl p-4 border",
                    isBuyMode
                      ? "bg-primary/5 border-primary/20"
                      : "bg-gray-50 border-gray-300",
                  ].join(" ")}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4 mb-2">
                    {isBuyMode ? (
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-gradient-to-r from-primary to-secondary rounded-full flex items-center justify-center mr-2">
                          <i className="fas fa-coins text-white text-sm" />
                        </div>
                        <span
                          id="to-token"
                          className="text-lg font-semibold text-gray-900"
                        >
                          CALL
                        </span>
                      </div>
                    ) : (
                      <>
                        <select className="bg-transparent text-lg font-semibold text-gray-900 focus:outline-none">
                          <option>USDC</option>
                          <option>ETH</option>
                          <option>BTC</option>
                        </select>
                        <span className="text-sm text-gray-500">
                          Balance: 5,000 USDC
                        </span>
                      </>
                    )}

                    {isBuyMode && (
                      <span id="to-balance" className="text-sm text-gray-500">
                        Balance: 12,450 CALL
                      </span>
                    )}
                  </div>
                  <input
                    id="to-amount"
                    type="number"
                    value={toAmount}
                    readOnly
                    className={[
                      "w-full bg-transparent text-xl sm:text-2xl font-bold focus:outline-none",
                      isBuyMode ? "text-primary" : "text-gray-900",
                    ].join(" ")}
                  />
                </div>
              </div>

              {/* Swap details */}
              <div
                id="swap-details"
                className={[
                  "rounded-xl p-4 border",
                  isBuyMode
                    ? "bg-blue-50 border-blue-200"
                    : "bg-orange-50 border-orange-200",
                ].join(" ")}
              >
                <div className="flex items-center justify-between text-sm gap-4">
                  <span className="text-gray-600 shrink-0">Exchange Rate</span>
                  <span
                    id="exchange-rate"
                    className="font-semibold text-gray-900 text-right break-words"
                  >
                    {exchangeRateLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm gap-4 mt-2">
                  <span className="text-gray-600 shrink-0">Price Impact</span>
                  <span
                    id="price-impact"
                    className={[
                      "font-semibold text-right",
                      priceImpactIsPositive ? "text-green-600" : "text-orange-600",
                    ].join(" ")}
                  >
                    {priceImpactLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm gap-4 mt-2">
                  <span className="text-gray-600 shrink-0">Network Fee</span>
                  <span className="font-semibold text-gray-900 text-right">
                    ~$2.50
                  </span>
                </div>
              </div>

              {/* Call to action button */}
              <button
                id="swap-button"
                type="button"
                className={[
                  "cursor-pointer w-full py-3 sm:py-4 rounded-xl font-bold text-white hover:shadow-lg transition",
                  isBuyMode
                    ? "bg-gradient-to-r from-green-500 to-green-600 hover:shadow-green-500/50"
                    : "bg-gradient-to-r from-red-500 to-red-600 hover:shadow-red-500/50",
                ].join(" ")}
              >
                <span id="swap-text">
                  {isBuyMode ? "Buy CALL Tokens" : "Sell CALL Tokens"}
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* Hero */}
        <section id="token-hero" className="text-center mb-10 sm:mb-12">
          <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-r from-primary to-secondary rounded-full flex items-center justify-center mx-auto mb-5 sm:mb-6">
            <i className="fas fa-coins text-white text-3xl sm:text-4xl" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold mb-3 sm:mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            CALL Token
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-gray-600 max-w-2xl mx-auto">
            The governance token powering the Scall.io ecosystem. Participate in
            protocol governance and earn from protocol fees.
          </p>
        </section>

        {/* Token stats */}
        <section
          id="token-stats"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-10 sm:mb-12"
        >
          <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 text-center shadow-sm">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-chart-line text-blue-600 text-xl" />
            </div>
            <p className="text-sm text-gray-600 mb-2">Current Price</p>
            <p className="text-2xl font-bold text-gray-900">$0.045</p>
            <p className="text-sm text-green-600 font-semibold">+12.5% 24h</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 text-center shadow-sm">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-coins text-purple-600 text-xl" />
            </div>
            <p className="text-sm text-gray-600 mb-2">Total Supply</p>
            <p className="text-2xl font-bold text-gray-900">1B</p>
            <p className="text-sm text-gray-500">Fixed Supply</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 text-center shadow-sm">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-water text-green-600 text-xl" />
            </div>
            <p className="text-sm text-gray-600 mb-2">Circulating Supply</p>
            <p className="text-2xl font-bold text-gray-900">234M</p>
            <p className="text-sm text-gray-500">23.4% of total</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 text-center shadow-sm">
            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-chart-pie text-orange-600 text-xl" />
            </div>
            <p className="text-sm text-gray-600 mb-2">Market Cap</p>
            <p className="text-2xl font-bold text-gray-900">$10.5M</p>
            <p className="text-sm text-gray-500">Fully Diluted: $45M</p>
          </div>
        </section>

        {/* Token info (distribution + utility) */}
        <section
          id="token-info-section"
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 mb-10 sm:mb-12"
        >
          {/* Distribution */}
          <div
            id="token-distribution"
            className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm"
          >
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-5 sm:mb-6">
              Token Distribution
            </h2>

            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-xl gap-4">
                <div className="flex items-center min-w-0">
                  <div className="w-4 h-4 bg-green-500 rounded-full mr-3 shrink-0" />
                  <span className="font-semibold text-gray-900 truncate">
                    Liquidity Providers
                  </span>
                </div>
                <span className="text-xl font-bold text-green-600 shrink-0">
                  90%
                </span>
              </div>

              <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl gap-4">
                <div className="flex items-center min-w-0">
                  <div className="w-4 h-4 bg-blue-500 rounded-full mr-3 shrink-0" />
                  <span className="font-semibold text-gray-900 truncate">
                    Team
                  </span>
                </div>
                <span className="text-xl font-bold text-blue-600 shrink-0">
                  10%
                </span>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4">
              <h3 className="font-bold text-gray-900 mb-3">
                Distribution Details
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">LP Rewards Pool</span>
                  <span className="font-semibold text-right">900M CALL</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Team Allocation</span>
                  <span className="font-semibold text-right">100M CALL</span>
                </div>
              </div>
            </div>
          </div>

          {/* Utility */}
          <div
            id="token-utility"
            className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 md:p-8 shadow-sm"
          >
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-5 sm:mb-6">
              Token Utility
            </h2>

            <div className="space-y-6">
              <div className="flex items-start">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mr-4 flex-shrink-0">
                  <i className="fas fa-vote-yea text-purple-600 text-xl" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">
                    Governance Rights
                  </h3>
                  <p className="text-gray-600 text-sm">
                    Vote on protocol upgrades, parameter changes, and treasury
                    management decisions.
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mr-4 flex-shrink-0">
                  <i className="fas fa-percentage text-green-600 text-xl" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">
                    Protocol Fee Sharing
                  </h3>
                  <p className="text-gray-600 text-sm">
                    Earn a portion of protocol fees generated from trading and
                    liquidity provision activities.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20 rounded-xl p-4 mt-6">
              <div className="flex items-center mb-2">
                <i className="fas fa-info-circle text-primary mr-2" />
                <span className="font-semibold text-gray-900">Coming Soon</span>
              </div>
              <p className="text-sm text-gray-700">
                Governance portal will be available in Q2 2026.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
