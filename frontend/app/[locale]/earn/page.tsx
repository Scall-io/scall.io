"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";

import { getBtcPrice, getUsdcBalance } from "@/web3/functions";
import { publicClient, ADDRESSES, Contracts } from "@/web3/contracts";
import Toast from "@/app/components/Toast";
import TransactionModal, {
  TxStep,
} from "@/app/components/TransactionModal";

import MarketPoolABI from "@/web3/ABI/MarketPool.json";
import MainABI from "@/web3/ABI/Main.json";
import ProtocolInfosABI from "@/web3/ABI/ProtocolInfos.json";

type MarketInfo = {
  index: number;
  addr: `0x${string}`;
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  yield: bigint; // 18 decimals, e.g. 30% = 30e16
};

type StrikeOption = {
  strikeIndex: number; // index in the full intervals array
  price: number; // formatted price
};

export default function EarnPage() {
  const [lpType, setLpType] = useState<"call" | "put">("call");
  const { address } = useAccount();
  const [protocolFeePct, setProtocolFeePct] = useState<number>(0);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info" | "warning";
  } | null>(null);

  const showToast = (
    message: string,
    type: "success" | "error" | "info" | "warning" = "info"
  ) => {
    setToast({ message, type });
  };

  const [isProcessingDeposit, setIsProcessingDeposit] = useState(false);

  const [btcPrice, setBtcPrice] = useState<number | null>(null);

  // BTC (cbBTC) Balance State
  const [btcBalance, setBtcBalance] = useState<number | null>(null);
  const [cbBtcDecimals, setCbBtcDecimals] = useState<number | null>(null);

  // USDC Balance State
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const USDC_DECIMALS = 6;

  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [selectedMarketIndex, setSelectedMarketIndex] = useState<number>(0);
  const [selectedAsset, setSelectedAsset] = useState<`0x${string}` | null>(
    null
  );

  const [poolStats, setPoolStats] = useState<{
    totalPoolSize: number;
    totalOpenInterest: number;
    utilizationPct: number;
  } | null>(null);

  const [intervals, setIntervals] = useState<number[]>([]);
  const [strikePosition, setStrikePosition] = useState<number>(0);

  const [amount, setAmount] = useState<string>("0.0");
  const [percent, setPercent] = useState<number>(0);

  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);
  const [isLoadingIntervals, setIsLoadingIntervals] = useState(false);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  // On-chain writers
  const { writeContractAsync } = useWriteContract();
  const { writeContractAsync: writeTokenAsync } = useWriteContract();

  // Transaction modal state
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txSteps, setTxSteps] = useState<TxStep[]>([]);

  // ---------- Load BTC Price ----------
  useEffect(() => {
    const load = async () => {
      const price = await getBtcPrice();
      if (price !== null) setBtcPrice(price);
    };
    load();
  }, []);

  // ---------- Load Balances (cbBTC and USDC) ----------
  useEffect(() => {
    if (!address) {
      setBtcBalance(null);
      setCbBtcDecimals(null);
      setUsdcBalance(null);
      return;
    }

    const loadBalances = async () => {
      try {
        setIsLoadingBalances(true);

        const [decimalsRaw, btcRaw] = await Promise.all([
          publicClient.readContract({
            address: ADDRESSES.cbBTC,
            abi: Contracts.ABI.ERC20,
            functionName: "decimals",
          }) as Promise<number | bigint>,
          publicClient.readContract({
            address: ADDRESSES.cbBTC,
            abi: Contracts.ABI.ERC20,
            functionName: "balanceOf",
            args: [address],
          }) as Promise<bigint>,
        ]);

        const usdcBalanceRaw = await getUsdcBalance(address);

        const decimals =
          typeof decimalsRaw === "bigint" ? Number(decimalsRaw) : decimalsRaw;

        const btcBalanceFormatted = parseFloat(formatUnits(btcRaw, decimals));
        setCbBtcDecimals(decimals);
        setBtcBalance(btcBalanceFormatted);
        setUsdcBalance(usdcBalanceRaw);
      } catch (e) {
        console.error("Error loading balances:", e);
        setBtcBalance(null);
        setCbBtcDecimals(null);
        setUsdcBalance(null);
      } finally {
        setIsLoadingBalances(false);
      }
    };

    loadBalances();
  }, [address]);

  // ---------- Load Markets from Main ----------
  useEffect(() => {
    const loadMarkets = async () => {
      try {
        setIsLoadingMarkets(true);

        const countBN = (await publicClient.readContract({
          address: ADDRESSES.Main,
          abi: MainABI,
          functionName: "getMarketCount",
        })) as bigint;

        const count = Number(countBN);
        const infos: MarketInfo[] = [];

        for (let i = 0; i < count; i++) {
          const info = (await publicClient.readContract({
            address: ADDRESSES.Main,
            abi: MainABI,
            functionName: "getIdToMarketInfos",
            args: [BigInt(i)],
          })) as any;

          infos.push({
            index: i,
            addr: info.addr as `0x${string}`,
            tokenA: info.tokenA as `0x${string}`,
            tokenB: info.tokenB as `0x${string}`,
            yield: info.yield as bigint,
          });
        }

        setMarkets(infos);
        if (infos.length > 0) {
          setSelectedAsset(infos[0].tokenA as `0x${string}`);
          setSelectedMarketIndex(infos[0].index);
        }
      } catch (e) {
        console.error("Error loading markets:", e);
      } finally {
        setIsLoadingMarkets(false);
      }
    };

    loadMarkets();
  }, []);

  // ---------- Load Protocol Fees ----------
  useEffect(() => {
    const loadProtocolFees = async () => {
      try {
        const raw = (await publicClient.readContract({
          address: ADDRESSES.Main,
          abi: MainABI,
          functionName: "getFees",
        })) as bigint;

        const dec = Number(formatUnits(raw, 18));
        setProtocolFeePct(dec);
      } catch (err) {
        console.error("Error loading protocol fees:", err);
      }
    };

    loadProtocolFees();
  }, []);

  const selectedMarket = useMemo(
    () => markets.find((m) => m.index === selectedMarketIndex) || null,
    [markets, selectedMarketIndex]
  );

  // Unique asset list (from tokenA)
  type AssetOption = {
    tokenA: `0x${string}`;
    label: string;
  };

  const getAssetLabel = (tokenA: `0x${string}`) => {
    return tokenA.toLowerCase() === ADDRESSES.cbBTC.toLowerCase()
      ? "Bitcoin (BTC)"
      : "Ethereum (ETH)";
  };

  const assetOptions: AssetOption[] = useMemo(() => {
    const seen = new Set<string>();
    const options: AssetOption[] = [];

    for (const m of markets) {
      const key = m.tokenA.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        options.push({
          tokenA: m.tokenA,
          label: getAssetLabel(m.tokenA),
        });
      }
    }

    return options;
  }, [markets]);

  // All APR options for the selected asset (each APR = one market)
  const aprOptions = useMemo(() => {
    if (!selectedAsset) return [];
    return markets.filter(
      (m) => m.tokenA.toLowerCase() === selectedAsset.toLowerCase()
    );
  }, [markets, selectedAsset]);

  // ---------- Load Market Infos (Pool Stats) ----------
  const loadPoolStats = useCallback(async () => {
    if (!selectedMarket) {
      setPoolStats(null);
      return;
    }

    try {
      const marketIndex = BigInt(selectedMarket.index);

      const [liquidityArr, openInterestArr] = await Promise.all([
        publicClient.readContract({
          address: ADDRESSES.ProtocolInfos,
          abi: ProtocolInfosABI,
          functionName: "getMarketLiquidityProvided",
          args: [marketIndex],
        }) as Promise<bigint[]>,
        publicClient.readContract({
          address: ADDRESSES.ProtocolInfos,
          abi: ProtocolInfosABI,
          functionName: "getMarketOpenInterest",
          args: [marketIndex],
        }) as Promise<bigint[]>,
      ]);

      const callLiquidityRaw = liquidityArr[0];
      const putLiquidityRaw = liquidityArr[1];

      const callOpenInterestRaw = openInterestArr[0];
      const putOpenInterestRaw = openInterestArr[1];

      let totalPoolSizeUSD = 0;
      let totalOpenInterestUSD = 0;

      const callAssetAmount = parseFloat(formatUnits(callLiquidityRaw, 18));
      const callOIAmount = parseFloat(formatUnits(callOpenInterestRaw, 18));

      const isBtcMarket =
        selectedMarket.tokenA.toLowerCase() === ADDRESSES.cbBTC.toLowerCase();
      const assetPrice = isBtcMarket && btcPrice != null ? btcPrice : 1;

      const callPoolSizeUSD = callAssetAmount * assetPrice;
      const callOpenInterestUSD = callOIAmount * assetPrice;

      const putPoolSizeUSD = parseFloat(formatUnits(putLiquidityRaw, 18));
      const putOpenInterestUSD = parseFloat(formatUnits(putOpenInterestRaw, 18));

      totalPoolSizeUSD = callPoolSizeUSD + putPoolSizeUSD;
      totalOpenInterestUSD = callOpenInterestUSD + putOpenInterestUSD;

      const utilizationPct =
        totalPoolSizeUSD > 0
          ? (totalOpenInterestUSD / totalPoolSizeUSD) * 100
          : 0;

      setPoolStats({
        totalPoolSize: totalPoolSizeUSD,
        totalOpenInterest: totalOpenInterestUSD,
        utilizationPct,
      });
    } catch (e) {
      console.error("Error loading pool stats", e);
      setPoolStats(null);
    }
  }, [selectedMarket, btcPrice]);

  useEffect(() => {
    loadPoolStats();
  }, [selectedMarket, btcPrice, loadPoolStats]);

  // ---------- Load Intervals ----------
  useEffect(() => {
    if (!selectedMarket) {
      setIntervals([]);
      return;
    }

    const loadIntervals = async () => {
      try {
        setIsLoadingIntervals(true);

        const [lengthBN, intervalsBN] = await Promise.all([
          publicClient.readContract({
            address: selectedMarket.addr,
            abi: MarketPoolABI,
            functionName: "getIntervalLength",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: selectedMarket.addr,
            abi: MarketPoolABI,
            functionName: "getIntervals",
          }) as Promise<bigint[]>,
        ]);

        const length = Number(lengthBN);
        const arr = intervalsBN.slice(0, length).map((v) => {
          return parseFloat(formatUnits(v, 18));
        });

        setIntervals(arr);
        setStrikePosition(0);
      } catch (e) {
        console.error("Error loading intervals:", e);
        setIntervals([]);
      } finally {
        setIsLoadingIntervals(false);
      }
    };

    loadIntervals();
  }, [selectedMarket]);

  useEffect(() => {
    setStrikePosition(0);
  }, [lpType, intervals.length]);

  // ---------- Strike options ----------
  const strikeOptions: StrikeOption[] = useMemo(() => {
    if (!intervals.length) return [];

    const half = Math.floor(intervals.length / 2);
    if (lpType === "call") {
      return intervals.slice(half).map((price, idx) => ({
        strikeIndex: half + idx,
        price,
      }));
    } else {
      return intervals.slice(0, half).map((price, idx) => ({
        strikeIndex: idx,
        price,
      }));
    }
  }, [intervals, lpType]);

  const currentStrikeOption =
    strikeOptions.length > 0
      ? strikeOptions[Math.min(strikePosition, strikeOptions.length - 1)]
      : null;

  // Token / balance depending on Call/Put
  const currentAssetBalance = lpType === "call" ? btcBalance : usdcBalance;
  const currentAssetSymbol = lpType === "call" ? "BTC" : "USDC";
  const currentAssetDecimals = lpType === "call" ? cbBtcDecimals : USDC_DECIMALS;
  const currentAssetAddress =
    lpType === "call"
      ? selectedMarket?.tokenA ?? ADDRESSES.cbBTC
      : selectedMarket?.tokenB ?? ADDRESSES.USDC;

  // ---------- Amount slider ----------
  const handlePercentChange = (value: number) => {
    setPercent(value);
    if (currentAssetBalance !== null) {
      const newAmount = (currentAssetBalance * value) / 100;
      const precision = lpType === "call" ? 6 : 2;
      setAmount(newAmount.toFixed(precision));
    }
  };

  const handleMaxClick = () => {
    if (currentAssetBalance !== null) {
      setAmount(currentAssetBalance.toString());
      setPercent(100);
    }
  };

  // USD value of the amount entered
  const usdValue = useMemo(() => {
    const n = Number(amount);
    if (isNaN(n) || n <= 0) return 0;

    if (lpType === "call" && btcPrice !== null) {
      return n * btcPrice;
    } else if (lpType === "put") {
      return n;
    }
    return 0;
  }, [amount, btcPrice, lpType]);

  // ---------- APR & Earnings ----------
  const aprDecimal = useMemo(() => {
    if (!selectedMarket) return 0;
    return Number(formatUnits(selectedMarket.yield, 18));
  }, [selectedMarket]);

  const aprPercent = aprDecimal * 100;

  const openInterestUSD = useMemo(() => {
    const n = Number(amount);
    if (!currentStrikeOption || isNaN(n) || n <= 0) return 0;
    // We use the USD value committed as OI baseline
    return usdValue;
  }, [currentStrikeOption, amount, usdValue]);

  const estimatedYearlyEarnings = aprDecimal * openInterestUSD;
  const estimatedWeeklyEarnings = estimatedYearlyEarnings / 52;

  const yourOpenInterest = openInterestUSD;

  const yourSharePct = useMemo(() => {
    if (!poolStats || poolStats.totalPoolSize <= 0) return 0;
    return (yourOpenInterest / (yourOpenInterest + poolStats.totalPoolSize)) * 100;
  }, [poolStats, yourOpenInterest]);

  const rewardBreakdown = useMemo(() => {
    const total = estimatedWeeklyEarnings;

    const feePct = protocolFeePct;
    const incentivePct = 0;
    const premiumsPct = Math.max(0, 1 - feePct - incentivePct);

    const optionPremiums = total * premiumsPct;
    const protocolFees = total * feePct;
    const incentives = total * incentivePct;

    return {
      optionPremiums,
      protocolFees,
      incentives,
      total,
    };
  }, [estimatedWeeklyEarnings, protocolFeePct]);

  const getMarketLabel = (m: MarketInfo) => {
    return getAssetLabel(m.tokenA);
  };

  // ---------- Deposit liquidity with TransactionModal ----------
  const handleDeposit = async () => {
    if (!address) {
      showToast("Connect your wallet first.", "error");
      return;
    }
    if (!selectedMarket) {
      showToast("No market selected.", "error");
      return;
    }
    if (!currentStrikeOption) {
      showToast("No strike price available.", "error");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      showToast("Enter a valid amount.", "error");
      return;
    }
    if (currentAssetDecimals == null) {
      showToast("Token decimals not loaded yet. Please wait.", "error");
      return;
    }
    if (currentAssetBalance !== null && Number(amount) > currentAssetBalance) {
      showToast(
        `You don't have enough ${currentAssetSymbol} to deposit this amount.`,
        "error"
      );
      return;
    }
    if (!currentAssetAddress) {
      showToast("Token information not loaded yet. Please wait.", "error");
      return;
    }

    try {
      setIsProcessingDeposit(true);

      const owner = address as `0x${string}`;
      const parsedAmount = parseUnits(amount, currentAssetDecimals);

      // 1) Check balance + allowance
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({
          address: currentAssetAddress,
          abi: Contracts.ABI.ERC20,
          functionName: "balanceOf",
          args: [owner],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: currentAssetAddress,
          abi: Contracts.ABI.ERC20,
          functionName: "allowance",
          args: [owner, selectedMarket.addr],
        }) as Promise<bigint>,
      ]);

      if (balance < parsedAmount) {
        showToast(
          `Insufficient ${currentAssetSymbol} balance to deposit.`,
          "error"
        );
        setIsProcessingDeposit(false);
        return;
      }

      const needsApproval = allowance < parsedAmount;

      // Build tx steps for modal
      const initialSteps: TxStep[] = [];

      if (needsApproval) {
        initialSteps.push({
          id: "approval",
          title: `${currentAssetSymbol} Approval`,
          description: `Allow the pool to spend your ${currentAssetSymbol}.`,
          status: "upcoming",
        });
      }

      initialSteps.push({
        id: "deposit",
        title: "Deposit Liquidity",
        description: `Deposit ${amount} ${currentAssetSymbol} as ${lpType.toUpperCase()} liquidity.`,
        status: "upcoming",
      });

      setTxSteps(initialSteps);
      setTxModalOpen(true);

      // 2) Approval step (if needed)
      if (needsApproval) {
        setTxSteps((prev) =>
          prev.map((s) =>
            s.id === "approval" ? { ...s, status: "pending" } : s
          )
        );

        try {
          const approveHash = await writeTokenAsync({
            address: currentAssetAddress,
            abi: Contracts.ABI.ERC20,
            functionName: "approve",
            args: [selectedMarket.addr, parsedAmount],
          });

          await publicClient.waitForTransactionReceipt({ hash: approveHash });

          setTxSteps((prev) =>
            prev.map((s) =>
              s.id === "approval" ? { ...s, status: "completed" } : s
            )
          );

          showToast(
            `Approval confirmed for ${currentAssetSymbol} deposit.`,
            "info"
          );
        } catch (err: any) {
          console.error("Approval tx error", err);
          setTxSteps((prev) =>
            prev.map((s) =>
              s.id === "approval" ? { ...s, status: "error" } : s
            )
          );
          showToast(
            err?.shortMessage ||
              err?.message ||
              "Approval transaction failed",
            "error"
          );
          setIsProcessingDeposit(false);
          return;
        }
      }

      // 3) Deposit step
      setTxSteps((prev) =>
        prev.map((s) =>
          s.id === "deposit" ? { ...s, status: "pending" } : s
        )
      );

      const intervalLength = intervals.length;
      const half = Math.floor(intervalLength / 2);
      let strikeParam = currentStrikeOption.strikeIndex;
      if (lpType === "call") {
        strikeParam = strikeParam - half;
      }
      const isCall = lpType === "call";

      const depositHash = await writeContractAsync({
        address: selectedMarket.addr,
        abi: MarketPoolABI,
        functionName: "deposit",
        args: [isCall, BigInt(strikeParam), parsedAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash: depositHash });

      setTxSteps((prev) =>
        prev.map((s) =>
          s.id === "deposit" ? { ...s, status: "completed" } : s
        )
      );

      showToast(
        isCall
          ? "Call liquidity deposit confirmed onchain."
          : "Put liquidity deposit confirmed onchain.",
        "success"
      );

      // Optionally refresh stats/balances
      await loadPoolStats();
    } catch (err: any) {
      console.error(err);
      setTxSteps((prev) =>
        prev.map((s) =>
          s.id === "deposit" ? { ...s, status: "error" } : s
        )
      );
      showToast(
        err?.shortMessage || err?.message || "Deposit transaction failed",
        "error"
      );
    } finally {
      setIsProcessingDeposit(false);
    }
  };

  return (
    <main id="earn-page" className="pt-24 pb-12">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <TransactionModal
        isOpen={txModalOpen}
        steps={txSteps}
        onClose={() => {
          setTxModalOpen(false);
          setTxSteps([]);
        }}
      />

      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: main liquidity card */}
          <div
            id="liquidity-card"
            className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-8 shadow-sm"
          >
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold mb-2 text-gray-900">
                  Provide Liquidity
                </h1>
                <p className="text-gray-600">
                  Earn weekly rewards by providing liquidity to option markets
                </p>
              </div>
              <div id="current-price-display" className="text-right">
                <p className="text-sm text-gray-500 mb-1">BTC Price</p>
                <p className="text-3xl font-bold text-green-600">
                  {btcPrice !== null
                    ? `$${btcPrice.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : "-"}
                </p>
                <p className="text-sm text-green-600">+2.45%</p>
              </div>
            </div>

            {/* Call / Put toggle */}
            <div
              id="liquidity-type-toggle"
              className="flex bg-gray-100 rounded-xl p-1.5 mb-6"
            >
              <button
                onClick={() => setLpType("call")}
                className={`cursor-pointer flex-1 py-3 rounded-lg font-semibold transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] ${
                  lpType === "call"
                    ? "bg-green-500 text-white"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <i className="fas fa-arrow-trend-up mr-2" />
                Call Liquidity
              </button>

              <button
                onClick={() => setLpType("put")}
                className={`cursor-pointer flex-1 py-3 rounded-lg font-semibold transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] ${
                  lpType === "put"
                    ? "bg-red-500 text-white"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <i className="fas fa-arrow-trend-down mr-2" />
                Put Liquidity
              </button>
            </div>

            {/* Asset selector */}
            <div id="asset-selector" className="mb-6">
              <label className="cursor-pointer flex items-center text-sm text-gray-600 mb-3">
                Asset
                <i
                  className="fas fa-circle-info ml-2 text-gray-400 cursor-help"
                  title="Choose the underlying asset for liquidity provision"
                />
              </label>
              <select
                id="asset-dropdown"
                className="cursor-pointer w-full bg-white border border-gray-300 rounded-xl px-4 py-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
                value={selectedAsset ?? ""}
                onChange={(e) => {
                  const token = e.target.value as `0x${string}`;
                  setSelectedAsset(token);

                  const firstMarketForAsset = markets.find(
                    (m) => m.tokenA.toLowerCase() === token.toLowerCase()
                  );
                  if (firstMarketForAsset) {
                    setSelectedMarketIndex(firstMarketForAsset.index);
                  }
                }}
                disabled={isLoadingMarkets || !assetOptions.length}
              >
                {isLoadingMarkets && <option>Loading assets...</option>}
                {!isLoadingMarkets && !assetOptions.length && (
                  <option>No assets available</option>
                )}
                {!isLoadingMarkets &&
                  assetOptions.map((opt) => (
                    <option key={opt.tokenA} value={opt.tokenA}>
                      {opt.label}
                    </option>
                  ))}
              </select>
            </div>

            {/* Strike selector */}
            <div id="strike-display" className="mb-6">
              <label className="flex items-center text-sm text-gray-600 mb-3">
                Strike Price
                <i
                  className="fas fa-circle-info ml-2 text-gray-400 cursor-help"
                  title="Select the strike price for this liquidity pool"
                />
              </label>
              <div className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-4 text-gray-900">
                {isLoadingIntervals ? (
                  <span className="text-gray-500">Loading strikes...</span>
                ) : strikeOptions.length === 0 ? (
                  <span className="text-gray-500">
                    No strikes available for this market.
                  </span>
                ) : (
                  <select
                    className="w-full bg-transparent font-semibold focus:outline-none cursor-pointer"
                    value={strikePosition}
                    onChange={(e) => setStrikePosition(Number(e.target.value))}
                  >
                    {strikeOptions.map((opt, idx) => (
                      <option key={opt.strikeIndex} value={idx}>
                        {`$${opt.price.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* APR & Liquidity selector */}
            <div id="apr-liquidity-display" className="mb-6">
              <label className="flex items-center text-sm text-gray-600 mb-4">
                <span className="flex items-center">
                  APR &amp; Liquidity Available
                  <i
                    className="fas fa-circle-info ml-2 text-gray-400 cursor-help"
                    title="Select an APR tier to provide liquidity. Higher APR = higher earnings for liquidity providers"
                  />
                </span>
              </label>

              {(!selectedAsset || !aprOptions.length) && (
                <div className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-4 text-gray-500 text-sm">
                  No APR options available for this asset.
                </div>
              )}

              {selectedAsset && aprOptions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {aprOptions.map((m, idx) => {
                    const aprDec = Number(formatUnits(m.yield, 18));
                    const aprPct = aprDec * 100;
                    const isActive = m.index === selectedMarketIndex;

                    const tierLabels = [
                      "Ultra Low",
                      "Low Cost",
                      "Balanced",
                      "Premium",
                      "High Yield",
                      "Ultra High",
                      "Maximum",
                    ];
                    const tierLabel = tierLabels[idx % tierLabels.length];

                    const gradientStyles = [
                      {
                        card: "from-emerald-50 to-emerald-100 border-emerald-300",
                        activeBorder: "border-emerald-500",
                        textMain: "text-emerald-800",
                        textSub: "text-emerald-600",
                        boxBg: "bg-white/60",
                        boxText: "text-emerald-900",
                        boxSub: "text-emerald-600",
                      },
                      {
                        card: "from-blue-50 to-blue-100 border-blue-300",
                        activeBorder: "border-blue-500",
                        textMain: "text-blue-800",
                        textSub: "text-blue-600",
                        boxBg: "bg-white/60",
                        boxText: "text-blue-900",
                        boxSub: "text-blue-600",
                      },
                      {
                        card: "from-purple-50 to-purple-100 border-purple-300",
                        activeBorder: "border-purple-500",
                        textMain: "text-purple-800",
                        textSub: "text-purple-600",
                        boxBg: "bg-white/80",
                        boxText: "text-purple-900",
                        boxSub: "text-purple-600",
                      },
                    ];
                    const style = gradientStyles[idx % gradientStyles.length];

                    return (
                      <button
                        key={m.index}
                        type="button"
                        onClick={() => setSelectedMarketIndex(m.index)}
                        className={[
                          "apr-option bg-gradient-to-br rounded-xl p-5 w-full cursor-pointer transition border-2",
                          style.card,
                          isActive
                            ? `${style.activeBorder} shadow-md`
                            : "hover:shadow-lg",
                        ].join(" ")}
                      >
                        <div className="text-center">
                          <div className="mb-3">
                            <span
                              className={`font-bold text-2xl block ${style.textMain}`}
                            >
                              {aprPct.toFixed(2)}%
                            </span>
                            <span
                              className={`text-sm font-medium ${style.textSub}`}
                            >
                              {tierLabel}
                            </span>
                          </div>
                          <div className={`${style.boxBg} rounded-lg p-3`}>
                            <p className={`font-bold text-lg ${style.boxText}`}>
                              —
                            </p>
                            <p
                              className={`text-xs font-medium ${style.boxSub}`}
                            >
                              Available (coming soon)
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedMarket && (
                <div
                  id="selected-apr-info"
                  className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">
                      Selected APR Tier:
                    </span>
                    <span
                      id="selected-apr-value"
                      className="font-bold text-lg text-primary"
                    >
                      {(
                        Number(formatUnits(selectedMarket.yield, 18)) * 100
                      ).toFixed(2)}
                      %
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Amount selector */}
            <div id="amount-selector" className="mb-6">
              <label className="flex items-center justify-between text-sm text-gray-600 mb-3">
                <span id="amount-label">
                  Amount ({currentAssetSymbol})
                </span>
                <span id="balance-display" className="text-gray-500">
                  Balance:{" "}
                  {isLoadingBalances
                    ? "Loading..."
                    : currentAssetBalance !== null
                    ? `${currentAssetBalance.toFixed(
                        currentAssetSymbol === "BTC" ? 6 : 2
                      )} ${currentAssetSymbol}`
                    : `- ${currentAssetSymbol}`}
                </span>
              </label>
              <div className="bg-gray-50 border border-gray-300 rounded-xl p-4 mb-4">
                <input
                  id="amount-input"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  step={currentAssetSymbol === "BTC" ? 0.000001 : 0.01}
                  className="w-full bg-transparent text-2xl font-bold text-gray-900 focus:outline-none"
                />
                <div className="flex items-center justify-between mt-3">
                  <span id="usd-value" className="text-sm text-gray-500">
                    {usdValue > 0
                      ? `~$${usdValue.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "~$0.00"}
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer text-xs text-primary hover:text-secondary font-semibold"
                    onClick={handleMaxClick}
                  >
                    MAX
                  </button>
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={percent}
                onChange={(e) => handlePercentChange(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Estimated earnings */}
            <div
              id="earnings-display"
              className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-700">
                  Estimated Weekly Earnings
                </span>
                <span className="text-2xl font-bold text-green-600">
                  {`$${estimatedWeeklyEarnings.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Estimated APR</span>
                <span className="text-green-600 font-semibold">
                  {`${aprPercent.toFixed(2)}%`}
                </span>
              </div>
            </div>

            <button
              id="deposit-liquidity-btn"
              className="cursor-pointer w-full bg-gradient-to-r from-primary to-secondary py-4 rounded-xl font-bold text-lg text-white hover:shadow-lg hover:shadow-primary/50 transition disabled:opacity-60 disabled:cursor-not-allowed"
              onClick={handleDeposit}
              disabled={isProcessingDeposit || !address}
            >
              {isProcessingDeposit
                ? "Depositing..."
                : lpType === "call"
                ? "Deposit Call Liquidity"
                : "Deposit Put Liquidity"}
            </button>

            {/* Info cards */}
            <div id="info-cards" className="grid grid-cols-3 gap-4 mt-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <i className="fas fa-percentage text-green-600 text-xl mb-2" />
                <p className="text-xs text-gray-600 mb-1">Current APR</p>
                <p className="text-sm font-semibold text-green-700">18.5%</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                <i className="fas fa-clock text-blue-600 text-xl mb-2" />
                <p className="text-xs text-gray-600 mb-1">Lock Period</p>
                <p className="text-sm font-semibold text-blue-700">7 Days</p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
                <i className="fas fa-coins text-purple-600 text-xl mb-2" />
                <p className="text-xs text-gray-600 mb-1">Total Rewards</p>
                <p className="text-sm font-semibold text-gray-900">$2.4M</p>
              </div>
            </div>
          </div>

          {/* Right sidebar */}
          <div id="sidebar" className="space-y-6">
            <div
              id="liquidity-summary-card"
              className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm"
            >
              <h3 className="text-lg font-bold mb-4 text-gray-900">
                Liquidity Summary
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Liquidity Type</span>
                  <span
                    id="summary-type"
                    className={`px-2 py-1 rounded text-sm font-semibold ${
                      lpType === "call"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {lpType.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Market</span>
                  <span
                    id="summary-asset"
                    className="font-semibold text-gray-900"
                  >
                    {selectedMarket
                      ? `${getMarketLabel(selectedMarket)} - ${aprPercent.toFixed(
                          2
                        )}% APR`
                      : "None"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Strike Price</span>
                  <span
                    id="summary-strike"
                    className="font-semibold text-gray-900"
                  >
                    {currentStrikeOption
                      ? `$${currentStrikeOption.price.toLocaleString(
                          undefined,
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }
                        )}`
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Amount</span>
                  <span
                    id="summary-amount"
                    className="font-semibold text-gray-900"
                  >
                    {amount || "0"} {currentAssetSymbol}
                  </span>
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-gray-600">
                      Estimated Weekly Earnings
                    </span>
                    <span
                      id="summary-earnings"
                      className="font-bold text-lg text-green-600"
                    >
                      {`$${estimatedWeeklyEarnings.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">
                      Estimated APR
                    </span>
                    <span
                      id="summary-apr"
                      className="font-semibold text-green-600"
                    >
                      {`${aprPercent.toFixed(2)}%`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div
              id="pool-statistics-card"
              className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm"
            >
              <h3 className="text-lg font-bold mb-4 text-gray-900">
                Pool Statistics
              </h3>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Total Pool Size</span>
                  <span className="font-semibold text-gray-900">
                    {poolStats
                      ? `$${poolStats.totalPoolSize.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "-"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Total Open Interest</span>
                  <span className="font-semibold text-gray-900">
                    {poolStats
                      ? `$${poolStats.totalOpenInterest.toLocaleString(
                          undefined,
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }
                        )}`
                      : "-"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Utilization</span>
                  <span className="font-semibold text-gray-900">
                    {poolStats
                      ? `${poolStats.utilizationPct.toFixed(2)}%`
                      : "-"}
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-gray-200 pt-3 mt-2">
                  <span className="text-gray-600">Your Share</span>
                  <span className="font-semibold text-primary">
                    {poolStats ? `${yourSharePct.toFixed(2)}%` : "-"}
                  </span>
                </div>
              </div>
            </div>

            <div
              id="rewards-card"
              className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm"
            >
              <h3 className="text-lg font-bold mb-4 text-gray-900">
                Rewards Breakdown
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Option Premiums</span>
                  <span className="font-semibold text-gray-900">
                    $
                    {rewardBreakdown.optionPremiums.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Protocol Fees</span>
                  <span className="font-semibold text-gray-900">
                    $
                    {rewardBreakdown.protocolFees.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    ({(protocolFeePct * 100).toFixed(2)}%)
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Incentives</span>
                  <span className="font-semibold text-gray-900">
                    $
                    {rewardBreakdown.incentives.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    (0.00%)
                  </span>
                </div>

                <div className="border-t border-gray-200 pt-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">
                    Total Weekly
                  </span>
                  <span className="font-bold text-green-600">
                    $
                    {rewardBreakdown.total.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Education cards */}
        <div
          id="education-section"
          className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-primary hover:shadow-md transition cursor-pointer">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
              <i className="fas fa-hand-holding-dollar text-green-600 text-xl" />
            </div>
            <h4 className="text-lg font-bold mb-2 text-gray-900">
              Call Liquidity
            </h4>
            <p className="text-sm text-gray-600">
              Provide BTC to earn from call option premiums. Higher returns when
              market is bullish.
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-primary hover:shadow-md transition cursor-pointer">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mb-4">
              <i className="fas fa-shield-halved text-red-600 text-xl" />
            </div>
            <h4 className="text-lg font-bold mb-2 text-gray-900">
              Put Liquidity
            </h4>
            <p className="text-sm text-gray-600">
              Provide USDC to earn from put option premiums. Stable returns with
              downside protection.
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-primary hover:shadow-md transition cursor-pointer">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
              <i className="fas fa-infinity text-purple-600 text-xl" />
            </div>
            <h4 className="text-lg font-bold mb-2 text-gray-900">
              Perpetual Options
            </h4>
            <p className="text-sm text-gray-600">
              Get paid each seconds by traders positions. Earn continuously as
              long as your liquidity is locked.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
