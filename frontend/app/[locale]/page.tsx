"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
import { getBtcPrice } from "@/web3/functions";
import { useEffect, useState, useMemo } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";

import { publicClient, ADDRESSES, Contracts } from "@/web3/contracts";
import Toast from "@/app/components/Toast";
import TransactionModal, {
  TxStep,
} from "@/app/components/TransactionModal";
import SelectMenu, { SelectMenuOption } from "@/app/components/SelectMenu";

// --- Types copied from trade.tsx ---
type OptionSide = "CALL" | "PUT";

type MarketInfo = {
  index: number;
  addr: `0x${string}`;
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  yield: bigint; // 18 decimals
};

type StrikeOption = {
  strikeIndex: number;
  price: number; // strike price in USD
};

type AllocationPlanItem = {
  market: MarketInfo;
  amount: number;
};

async function getBtc24hStats() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false",
    { next: { revalidate: 30 } }
  );

  if (!res.ok) return null;

  const data = await res.json();

  return {
    price: data.market_data.current_price.usd,
    high24h: data.market_data.high_24h.usd,
    low24h: data.market_data.low_24h.usd,
    volume24h: data.market_data.total_volume.usd,
    change24hPct: data.market_data.price_change_percentage_24h, // ✅
  };
}

export default function HomePage() {
  const locale = useLocale();
  const { address } = useAccount();

  // --- Global State ---
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [btcStats, setBtcStats] = useState<{
    high24h: number;
    low24h: number;
    volume24h: number;
    change24hPct: number;
  } | null>(null);

  // --- Trade Card State (from trade.tsx) ---
  const [optionType, setOptionType] = useState<OptionSide>("CALL");
  
  // Markets & Selection
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [selectedMarketIndex, setSelectedMarketIndex] = useState<number>(0);
  const [selectedAssetToken, setSelectedAssetToken] = useState<`0x${string}`>(ADDRESSES.cbBTC as `0x${string}`);

  // Intervals & Strikes
  const [intervals, setIntervals] = useState<number[]>([]);
  const [strikePosition, setStrikePosition] = useState<number>(0);

  // Inputs
  const [amount, setAmount] = useState<string>("0.0");
  const [percent, setPercent] = useState<number>(0);

  // Loading States
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);
  const [isLoadingIntervals, setIsLoadingIntervals] = useState(false);
  const [isLoadingAvailable, setIsLoadingAvailable] = useState(false);

  // Liquidity Data
  const [availableLiquidity, setAvailableLiquidity] = useState<number | null>(null);
  const [aprAvailabilities, setAprAvailabilities] = useState<Record<number, number | null>>({});

  // Strike liquidity across APR tiers (used to filter strike list)
  const [strikeLiquidityByIndex, setStrikeLiquidityByIndex] = useState<number[]>([]);
  const [isLoadingStrikeLiquidity, setIsLoadingStrikeLiquidity] = useState(false);

  // UI Modals
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info" | "warning";
  } | null>(null);

  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txSteps, setTxSteps] = useState<TxStep[]>([]);

  // FAQ Accordion State
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const { writeContractAsync, isPending: isOpenPending } = useWriteContract();

  const showToast = (
    message: string,
    type: "success" | "error" | "info" | "warning" = "info"
  ) => {
    setToast({ message, type });
  };

  // --- Derived State (Memoized) ---

  const selectedMarket = useMemo(
    () => markets.find((m) => m.index === selectedMarketIndex) || null,
    [markets, selectedMarketIndex]
  );

  const assetOptions = useMemo(() => {
    const map = new Map<string, { tokenA: `0x${string}`; label: string }>();
    for (const m of markets) {
      const key = m.tokenA.toLowerCase();
      if (!map.has(key)) {
        const label =
          m.tokenA.toLowerCase() === ADDRESSES.cbBTC.toLowerCase()
            ? "Bitcoin (BTC)"
            : "Ethereum (ETH)";
        map.set(key, { tokenA: m.tokenA, label });
      }
    }
    return Array.from(map.values());
  }, [markets]);

  const selectedAssetSymbol = useMemo(() => {
    if (!selectedAssetToken) return "ASSET";
    return selectedAssetToken.toLowerCase() === ADDRESSES.cbBTC.toLowerCase() ? "BTC" : "ETH";
  }, [selectedAssetToken]);

  const aprOptions = useMemo(() => {
    if (!selectedAssetToken) return [];
    return markets
      .filter((m) => m.tokenA.toLowerCase() === selectedAssetToken.toLowerCase())
      .slice(0, 3);
  }, [markets, selectedAssetToken]);

  const totalAvailableLiquidity = useMemo(() => {
    if (!aprOptions.length) return null;
    let sum = 0;
    for (const m of aprOptions) {
      const v = aprAvailabilities[m.index];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        sum += v;
      }
    }
    return sum;
  }, [aprOptions, aprAvailabilities]);

  const allocationPlan = useMemo(() => {
    if (!aprOptions.length) {
      return { items: [] as AllocationPlanItem[], totalUsed: 0, isFullfilled: false };
    }
    const desired = Number(amount);
    if (!Number.isFinite(desired) || desired <= 0) {
      return { items: [], totalUsed: 0, isFullfilled: false };
    }

    const sorted = [...aprOptions].sort((a, b) => {
      if (a.yield === b.yield) return a.index - b.index;
      return a.yield < b.yield ? -1 : 1;
    });

    let remaining = desired;
    const items: AllocationPlanItem[] = [];

    for (const m of sorted) {
      const avail = aprAvailabilities[m.index] ?? 0;
      if (!avail || avail <= 0) continue;
      const use = Math.min(avail, remaining);
      if (use > 0) {
        items.push({ market: m, amount: use });
        remaining -= use;
        if (remaining <= 1e-9) break;
      }
    }
    const totalUsed = items.reduce((sum, it) => sum + it.amount, 0);
    const isFullfilled = totalUsed + 1e-9 >= desired;
    return { items, totalUsed, isFullfilled };
  }, [aprOptions, aprAvailabilities, amount]);

  const strikeOptions: StrikeOption[] = useMemo(() => {
  if (!intervals.length) return [];
  const half = Math.floor(intervals.length / 2);

  // Only show strike prices that have liquidity available (summed across APR tiers)
  const hasLiquidity = (strikeIndex: number) => {
    const v = strikeLiquidityByIndex[strikeIndex] ?? 0;
    return Number.isFinite(v) && v > 0;
  };

  if (optionType === "CALL") {
    return intervals
      .slice(half)
      .map((price, idx) => ({ strikeIndex: half + idx, price }))
      .filter((s) => hasLiquidity(s.strikeIndex));
  }

  return intervals
    .slice(0, half)
    .map((price, idx) => ({ strikeIndex: idx, price }))
    .filter((s) => hasLiquidity(s.strikeIndex));
}, [intervals, optionType, strikeLiquidityByIndex]);

  const currentStrikeOption =
    strikeOptions.length > 0
      ? strikeOptions[Math.min(strikePosition, strikeOptions.length - 1)]
      : null;

  const btcUsdValue = useMemo(() => {
    if (!btcPrice || !amount) return 0;
    const n = Number(amount);
    if (isNaN(n) || n <= 0) return 0;
    return n * btcPrice;
  }, [amount, btcPrice]);

  const costMetrics = useMemo(() => {
    if (!currentStrikeOption) {
      return { weeklyCost: 0, effectiveAprPct: 0 };
    }
    const strikePrice = currentStrikeOption.price;
    const desiredAmount = Number(amount);
    if (!Number.isFinite(desiredAmount) || desiredAmount <= 0) {
      return { weeklyCost: 0, effectiveAprPct: 0 };
    }

    let totalWeeklyCost = 0;
    let effectiveAprDec = 0;

    if (allocationPlan.items.length === 0) {
      if (!selectedMarket) return { weeklyCost: 0, effectiveAprPct: 0 };
      const aprDec = Number(formatUnits(selectedMarket.yield, 18));
      const oi = strikePrice * desiredAmount;
      totalWeeklyCost = (aprDec * oi) / 52;
      effectiveAprDec = aprDec;
    } else {
      for (const it of allocationPlan.items) {
        const aprDecMarket = Number(formatUnits(it.market.yield, 18));
        const oi = strikePrice * it.amount;
        totalWeeklyCost += (aprDecMarket * oi) / 52;
      }
      if (strikePrice > 0 && desiredAmount > 0) {
        effectiveAprDec = (totalWeeklyCost * 52) / (strikePrice * desiredAmount);
      } else {
        effectiveAprDec = 0;
      }
    }

    return {
      weeklyCost: totalWeeklyCost,
      effectiveAprPct: effectiveAprDec * 100,
    };
  }, [allocationPlan, selectedMarket, currentStrikeOption, amount]);

  const { weeklyCost, effectiveAprPct } = costMetrics;

  // --- Effects ---

  // Load BTC Price
  useEffect(() => {
    const loadPrice = async () => {
      const price = await getBtcPrice();
      if (price !== null) setBtcPrice(price);
    };
    loadPrice();
  }, []);

  useEffect(() => {
    const loadStats = async () => {
      const stats = await getBtc24hStats();
      if (!stats) return;

      setBtcPrice(stats.price);
      setBtcStats({
        high24h: stats.high24h,
        low24h: stats.low24h,
        volume24h: stats.volume24h,
        change24hPct: stats.change24hPct,
      });
    };

    loadStats();
  }, []);

  // Load Markets
  useEffect(() => {
    const loadMarkets = async () => {
      try {
        setIsLoadingMarkets(true);
        const countBN = (await publicClient.readContract({
          address: ADDRESSES.Main,
          abi: Contracts.Main.abi,
          functionName: "getMarketCount",
        })) as bigint;

        const count = Number(countBN);
        const infos: MarketInfo[] = [];

        for (let i = 0; i < count; i++) {
          const info = (await publicClient.readContract({
            address: ADDRESSES.Main,
            abi: Contracts.Main.abi,
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
          setSelectedMarketIndex(infos[0].index);
          setSelectedAssetToken(infos[0].tokenA);
        }
      } catch (e) {
        console.error("Error loading markets:", e);
      } finally {
        setIsLoadingMarkets(false);
      }
    };
    loadMarkets();
  }, []);

  // Sync Asset selection
  useEffect(() => {
    if (!selectedAssetToken || !markets.length) return;
    const current = markets.find((m) => m.index === selectedMarketIndex);
    if (current && current.tokenA.toLowerCase() === selectedAssetToken.toLowerCase()) {
      return;
    }
    const candidates = markets.filter((m) => m.tokenA.toLowerCase() === selectedAssetToken.toLowerCase());
    if (candidates.length) {
      setSelectedMarketIndex(candidates[0].index);
    }
  }, [selectedAssetToken, markets, selectedMarketIndex]);

  // Load Intervals
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
            abi: Contracts.MarketPool.abi,
            functionName: "getIntervalLength",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: selectedMarket.addr,
            abi: Contracts.MarketPool.abi,
            functionName: "getIntervals",
          }) as Promise<bigint[]>,
        ]);
        const length = Number(lengthBN);
        const arr = intervalsBN.slice(0, length).map((v) => parseFloat(formatUnits(v, 18)));
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

// Load aggregated strike liquidity across APR tiers (so Strike list only shows strikes with liquidity > 0)
useEffect(() => {
  const loadStrikeLiquidity = async () => {
    if (!intervals.length || !aprOptions.length) {
      setStrikeLiquidityByIndex([]);
      return;
    }
    try {
      setIsLoadingStrikeLiquidity(true);

      // Sum liquidity across the APR markets for the selected asset
      const arrays = await Promise.all(
        aprOptions.map(async (m) => {
          try {
            const arr = (await publicClient.readContract({
              address: ADDRESSES.ProtocolInfos,
              abi: Contracts.ProtocolInfos.abi,
              functionName: "getMarketsAvlLiquidity",
              args: [BigInt(m.index)],
            })) as bigint[];

            return arr.map((v) => Number(formatUnits(v, 18)));
          } catch (e) {
            // If one tier fails, ignore it rather than breaking the widget
            return new Array(intervals.length).fill(0);
          }
        })
      );

      const summed = new Array(intervals.length).fill(0);
      for (const arr of arrays) {
        for (let i = 0; i < summed.length; i++) {
          const v = arr[i] ?? 0;
          if (Number.isFinite(v) && v > 0) summed[i] += v;
        }
      }

      setStrikeLiquidityByIndex(summed);
    } catch (e) {
      console.error("Error loading strike liquidity:", e);
      setStrikeLiquidityByIndex([]);
    } finally {
      setIsLoadingStrikeLiquidity(false);
    }
  };

  loadStrikeLiquidity();
}, [intervals.length, aprOptions]);


  // Reset Strike when type/intervals change
  useEffect(() => {
    setStrikePosition(0);
  }, [optionType, intervals.length]);

  // Load Informational Liquidity (single market)
  useEffect(() => {
    const loadAvailable = async () => {
      if (!selectedMarket || !currentStrikeOption) {
        setAvailableLiquidity(null);
        return;
      }
      try {
        setIsLoadingAvailable(true);
        const strikeWei = parseUnits(currentStrikeOption.price.toString(), 18);
        const info = (await publicClient.readContract({
          address: selectedMarket.addr,
          abi: Contracts.MarketPool.abi,
          functionName: "getStrikeInfos",
          args: [strikeWei],
        })) as any;

        const callLP = parseFloat(formatUnits(info.callLP as bigint, 18));
        const callLU = parseFloat(formatUnits(info.callLU as bigint, 18));
        const callLR = parseFloat(formatUnits(info.callLR as bigint, 18));
        const putLP = parseFloat(formatUnits(info.putLP as bigint, 18));
        const putLU = parseFloat(formatUnits(info.putLU as bigint, 18));
        const putLR = parseFloat(formatUnits(info.putLR as bigint, 18));
        const strike = currentStrikeOption.price;

        let available = 0;
        if (optionType === "CALL") {
          available = callLP - callLU - callLR / strike;
        } else {
          available = (putLP - putLU - putLR * strike) / strike;
        }
        if (!Number.isFinite(available) || available < 0) available = 0;
        setAvailableLiquidity(available);
      } catch (e) {
        console.error("Error loading strike liquidity:", e);
        setAvailableLiquidity(null);
      } finally {
        setIsLoadingAvailable(false);
      }
    };
    loadAvailable();
  }, [selectedMarket, currentStrikeOption, optionType]);

  // Load Liquidity for ALL APR Markets
  useEffect(() => {
    const loadAprAvailabilities = async () => {
      if (!currentStrikeOption || !aprOptions.length) {
        setAprAvailabilities({});
        return;
      }
      try {
        const strikeWei = parseUnits(currentStrikeOption.price.toString(), 18);
        const results: Record<number, number | null> = {};
        for (const m of aprOptions) {
          try {
            const info = (await publicClient.readContract({
              address: m.addr,
              abi: Contracts.MarketPool.abi,
              functionName: "getStrikeInfos",
              args: [strikeWei],
            })) as any;
            
            const callLP = parseFloat(formatUnits(info.callLP as bigint, 18));
            const callLU = parseFloat(formatUnits(info.callLU as bigint, 18));
            const callLR = parseFloat(formatUnits(info.callLR as bigint, 18));
            const putLP = parseFloat(formatUnits(info.putLP as bigint, 18));
            const putLU = parseFloat(formatUnits(info.putLU as bigint, 18));
            const putLR = parseFloat(formatUnits(info.putLR as bigint, 18));
            const strike = currentStrikeOption.price;

            let available = 0;
            if (optionType === "CALL") {
              available = callLP - callLU - callLR / strike;
            } else {
              available = (putLP - putLU - putLR * strike) / strike;
            }
            if (!Number.isFinite(available) || available < 0) available = 0;
            results[m.index] = available;
          } catch (err) {
            results[m.index] = null;
          }
        }
        setAprAvailabilities(results);
      } catch (err) {
        setAprAvailabilities({});
      }
    };
    loadAprAvailabilities();
  }, [aprOptions, currentStrikeOption, optionType]);

  // --- Event Handlers ---

  const handlePercentChange = (value: number) => {
    setPercent(value);
    if (totalAvailableLiquidity !== null) {
      const newAmount = (totalAvailableLiquidity * value) / 100;
      setAmount(newAmount.toFixed(6));
    }
  };

  const handleMaxClick = () => {
    if (totalAvailableLiquidity !== null) {
      setAmount(totalAvailableLiquidity.toFixed(6));
      setPercent(100);
    }
  };

  const handleOpenPosition = async () => {
    setToast(null);

    if (!address) {
      showToast("Connect your wallet first.", "error");
      return;
    }
    if (!selectedMarket) {
      showToast("No market selected.", "error");
      return;
    }
    if (!currentStrikeOption) {
      showToast("No strike price selected.", "error");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      showToast("Enter a valid amount.", "error");
      return;
    }

    if (!allocationPlan.isFullfilled) {
      showToast("Amount exceeds total available liquidity.", "error");
      return;
    }

    try {
      const strikePrice = currentStrikeOption.price;
      const SECONDS_PER_YEAR = 31536000;
      const allocations = allocationPlan.items;

      // 1) Get collateral token and check user balance
      const collateralToken = (await publicClient.readContract({
        address: ADDRESSES.CollateralPool,
        abi: Contracts.CollateralPool.abi,
        functionName: "getCollateralToken",
      })) as `0x${string}`;

      const collateralDecimals = Number(
        (await publicClient.readContract({
          address: collateralToken,
          abi: Contracts.ABI.ERC20,
          functionName: "decimals",
        })) as bigint
      );

      const userCollateralRaw = (await publicClient.readContract({
        address: ADDRESSES.CollateralPool,
        abi: Contracts.CollateralPool.abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;

      const userCollateral = Number(formatUnits(userCollateralRaw, collateralDecimals));

      if (userCollateral <= 0) {
        showToast("You have no collateral deposited.", "error");
        return;
      }

      // 2) Compute total rent
      let totalRentPerSecondUsd = 0;
      for (const alloc of allocations) {
        const aprDecMarket = Number(formatUnits(alloc.market.yield, 18));
        const oiUsd = strikePrice * alloc.amount;
        totalRentPerSecondUsd += (oiUsd * aprDecMarket) / SECONDS_PER_YEAR;
      }

      const rentScaledTotal = parseUnits(
        totalRentPerSecondUsd.toFixed(collateralDecimals),
        collateralDecimals
      );

      // 3) Check permissions
      const canOpen = (await publicClient.readContract({
        address: ADDRESSES.CollateralPool,
        abi: Contracts.CollateralPool.abi,
        functionName: "canOpenContract",
        args: [address, rentScaledTotal],
      })) as boolean;

      if (!canOpen) {
        showToast("Not enough collateral for this position size.", "error");
        return;
      }

      // 4) Set up steps
      const txModalSteps: TxStep[] = allocations.map((alloc, idx) => {
        const aprPctMarket = Number(formatUnits(alloc.market.yield, 18)) * 100;
        const assetSymbol = alloc.market.tokenA.toLowerCase() === ADDRESSES.cbBTC.toLowerCase() ? "BTC" : "ETH";
        return {
          id: `open-${alloc.market.index}-${idx}`,
          title: `Open ${optionType} position`,
          description: `${alloc.amount.toFixed(4)} ${assetSymbol} @ $${strikePrice.toFixed(2)} • APR ${aprPctMarket.toFixed(2)}%`,
          status: idx === 0 ? "pending" : "upcoming",
        };
      });

      setTxSteps(txModalSteps);
      setIsTxModalOpen(true);

      const decimalsTokenA = Number(await publicClient.readContract({ address: selectedMarket.tokenA, abi: Contracts.ABI.ERC20, functionName: "decimals" }));
      const decimalsTokenB = Number(await publicClient.readContract({ address: selectedMarket.tokenB, abi: Contracts.ABI.ERC20, functionName: "decimals" }));

      const intervalLength = intervals.length;
      const half = Math.floor(intervalLength / 2);
      let strikeIndexParam = currentStrikeOption.strikeIndex;
      if (optionType === "CALL") {
        strikeIndexParam = strikeIndexParam - half;
      }

      // 5) Execute Txs
      for (let i = 0; i < allocations.length; i++) {
        const alloc = allocations[i];
        const m = alloc.market;

        setTxSteps((prev) => prev.map((step, idx) => idx === i ? { ...step, status: "pending" } : step));

        let parsedAmount: bigint;
        if (optionType === "CALL") {
          parsedAmount = parseUnits(alloc.amount.toString(), decimalsTokenA);
        } else {
          const amountUsd = (alloc.amount * strikePrice).toString();
          parsedAmount = parseUnits(amountUsd, decimalsTokenB);
        }

        try {
          const hash = await writeContractAsync({
            address: m.addr,
            abi: Contracts.MarketPool.abi,
            functionName: "openContract",
            args: [optionType === "CALL", BigInt(strikeIndexParam), parsedAmount],
          });
          await publicClient.waitForTransactionReceipt({ hash });
          setTxSteps((prev) => prev.map((step, idx) => idx === i ? { ...step, status: "completed" } : step));
        } catch (err) {
          setTxSteps((prev) => prev.map((step, idx) => idx === i ? { ...step, status: "error" } : step));
          throw err;
        }
      }

      showToast("Position transactions sent successfully.", "success");
    } catch (err: any) {
      console.error(err);
      showToast(err?.shortMessage || err?.message || "Transaction failed", "error");
    }
  };

  return (
    <div id="home-page" className="pt-18 bg-light text-gray-900 relative">
      {/* --- Modals --- */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      <TransactionModal
        isOpen={isTxModalOpen}
        steps={txSteps}
        onClose={() => {
          setIsTxModalOpen(false);
          setTxSteps([]);
        }}
      />

      {/* HERO */}
      <section
        id="hero-section"
        className="h-[600px] bg-gradient-to-br from-primary/10 via-secondary/5 to-light relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-grid-pattern opacity-5" />
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center w-full">
            <div className="space-y-6">
              <div className="inline-flex items-center space-x-2 bg-white/80 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-200">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-gray-700">
                  Perpetual Options Protocol
                </span>
              </div>
              <h1 className="text-5xl lg:text-6xl font-bold leading-tight">
                Trade Options{" "}
                <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                  Without Expiration
                </span>
              </h1>
              <p className="text-xl text-gray-600 leading-relaxed">
                Open perpetual call and put positions on BTC and ETH. Pay only
                weekly rent. No expiration dates. Unlimited profit potential.
              </p>
              <div className="flex items-center space-x-4 pt-4">
                <Link
                  href={`/${locale}/trade`}
                  className="relative inline-flex items-center justify-center bg-gradient-to-r from-primary to-secondary px-8 py-4 rounded-xl font-bold text-white shadow-lg hover:shadow-2xl hover:shadow-primary/60 transition-transform transition-shadow duration-200 hover:-translate-y-0.5 cursor-pointer"
                >
                  Start Trading
                </Link>
                <Link
                  href={`/${locale}/how-it-works`}
                  className="relative inline-flex items-center justify-center bg-white border border-gray-300 px-8 py-4 rounded-xl font-semibold text-gray-900 hover:border-primary hover:shadow-lg transition-transform transition-shadow duration-200 hover:-translate-y-0.5 cursor-pointer"
                >
                  Learn More
                </Link>
              </div>
              <div className="flex items-center space-x-8 pt-6">
                <div>
                  <p className="text-3xl font-bold text-gray-900">$156M</p>
                  <p className="text-sm text-gray-600">Total Volume</p>
                </div>
                <div className="w-px h-12 bg-gray-300" />
                <div>
                  <p className="text-3xl font-bold text-gray-900">$89M</p>
                  <p className="text-sm text-gray-600">Liquidity</p>
                </div>
                <div className="w-px h-12 bg-gray-300" />
                <div>
                  <p className="text-3xl font-bold text-green-600">18.5%</p>
                  <p className="text-sm text-gray-600">Avg. APR</p>
                </div>
              </div>
            </div>

            {/* Right card */}
            <div className="hidden lg:block">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary to-secondary opacity-20 blur-3xl rounded-full" />
                <div className="relative bg-white rounded-3xl p-8 shadow-2xl border border-gray-200">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-600 rounded-full flex items-center justify-center">
                        <i className="fab fa-bitcoin text-white text-xl" />
                      </div>
                      <div>
                        <p className="text-sm text-gray-500">BTC/USD</p>
                        <p className="text-2xl font-bold">{btcPrice ? `$${btcPrice.toLocaleString()}` : "Loading..."}</p>
                      </div>
                    </div>
                    {btcStats && (
                      <span
                        className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                          btcStats.change24hPct >= 0
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {btcStats.change24hPct >= 0 ? "+" : ""}
                        {btcStats.change24hPct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <div className="h-32 flex items-end space-x-2">
                    <div
                      className="flex-1 bg-gradient-to-t from-primary/80 to-primary/40 rounded-t"
                      style={{ height: "60%" }}
                    />
                    <div
                      className="flex-1 bg-gradient-to-t from-primary/80 to-primary/40 rounded-t"
                      style={{ height: "75%" }}
                    />
                    <div
                      className="flex-1 bg-gradient-to-t from-primary/80 to-primary/40 rounded-t"
                      style={{ height: "50%" }}
                    />
                    <div
                      className="flex-1 bg-gradient-to-t from-primary/80 to-primary/40 rounded-t"
                      style={{ height: "85%" }}
                    />
                    <div
                      className="flex-1 bg-gradient-to-t from-primary/80 to-primary/40 rounded-t"
                      style={{ height: "70%" }}
                    />
                    <div
                      className="flex-1 bg-gradient-to-t from-primary/80 to-primary/40 rounded-t"
                      style={{ height: "90%" }}
                    />
                    <div
                      className="flex-1 bg-gradient-to-t from-primary to-primary rounded-t"
                      style={{ height: "100%" }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-gray-200">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">24h High</p>
                      <p className="text-sm font-bold">{btcStats ? `$${btcStats.high24h.toLocaleString()}` : "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">24h Low</p>
                      <p className="text-sm font-bold">{btcStats ? `$${btcStats.low24h.toLocaleString()}` : "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Volume</p>
                      <p className="text-sm font-bold">{btcStats ? `$${(btcStats.volume24h / 1e9).toFixed(2)}B` : "-"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features-section" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-gray-900">
              Why Choose Scall.io?
            </h2>
            <p className="text-xl text-gray-600">
              The most advanced perpetual options protocol in DeFi
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div
              id="feature-1"
              className="bg-light border border-gray-200 rounded-2xl p-8 hover:border-primary hover:shadow-lg transition"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center mb-6">
                <i className="fas fa-infinity text-white text-2xl" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gray-900">
                No Expiration
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Keep your positions open as long as you want. Pay only weekly
                rent. Close anytime without penalties.
              </p>
            </div>
            <div
              id="feature-2"
              className="bg-light border border-gray-200 rounded-2xl p-8 hover:border-primary hover:shadow-lg transition"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mb-6">
                <i className="fas fa-chart-line text-white text-2xl" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gray-900">
                Unlimited Upside
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Profit from unlimited price movements. Your gains are only
                limited by market performance.
              </p>
            </div>
            <div
              id="feature-3"
              className="bg-light border border-gray-200 rounded-2xl p-8 hover:border-primary hover:shadow-lg transition"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center mb-6">
                <i className="fas fa-shield-halved text-white text-2xl" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gray-900">
                Limited Risk
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Maximum loss is only your contract rent cost. No liquidation risk.
                Full capital protection.
              </p>
            </div>
            <div
              id="feature-4"
              className="bg-light border border-gray-200 rounded-2xl p-8 hover:border-primary hover:shadow-lg transition"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6">
                <i className="fas fa-coins text-white text-2xl" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gray-900">
                Earn as LP
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Provide liquidity and earn weekly rent from traders. Average APR
                of 18.5% with auto-compound.
              </p>
            </div>
            <div
              id="feature-5"
              className="bg-light border border-gray-200 rounded-2xl p-8 hover:border-primary hover:shadow-lg transition"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mb-6">
                <i className="fas fa-bolt text-white text-2xl" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gray-900">
                Instant Execution
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Open and close positions instantly on-chain. No order books. No
                slippage. Just pure DeFi.
              </p>
            </div>
            <div
              id="feature-6"
              className="bg-light border border-gray-200 rounded-2xl p-8 hover:border-primary hover:shadow-lg transition"
            >
              <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl flex items-center justify-center mb-6">
                <i className="fas fa-lock text-white text-2xl" />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gray-900">
                Fully Decentralized
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Non-custodial smart contracts. Your keys, your crypto. Audited
                by leading security firms.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* TRADE WIDGET */}
      <section
        id="trade-widget"
        className="py-20 bg-gradient-to-br from-gray-50 to-white"
      >
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4 text-gray-900">
              Start Trading Now
            </h2>
            <p className="text-xl text-gray-600">
              Open your first perpetual option position in seconds
            </p>
          </div>

          <div
            id="trading-card-home"
            className="bg-white border border-gray-200 rounded-2xl p-8 shadow-lg"
          >
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-2xl font-bold mb-2 text-gray-900">
                  Trade Options
                </h3>
                <p className="text-gray-600">
                  Open perpetual call or put positions
                </p>
              </div>
              <div id="current-price-display-home" className="text-right">
                <p className="text-sm text-gray-500 mb-1">BTC Price</p>
                <p className="text-3xl font-bold text-green-600">
                  {btcPrice !== null
                    ? `$${btcPrice.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : "-"}
                </p>
              </div>
            </div>

            {/* Toggle CALL / PUT */}
            <div
              id="option-type-toggle-home"
              className="flex bg-gray-100 rounded-xl p-1.5 mb-6"
            >
              <button
                id="call-btn-home"
                onClick={() => setOptionType("CALL")}
                className={`cursor-pointer flex-1 py-3 rounded-lg font-semibold transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]
                  ${
                    optionType === "CALL"
                      ? "bg-green-500 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
              >
                <i className="fas fa-arrow-trend-up mr-2" />
                Call
              </button>
              <button
                id="put-btn-home"
                onClick={() => setOptionType("PUT")}
                className={`cursor-pointer flex-1 py-3 rounded-lg font-semibold transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]
                  ${
                    optionType === "PUT"
                      ? "bg-red-500 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
              >
                <i className="fas fa-arrow-trend-down mr-2" />
                Put
              </button>
            </div>

            {/* Asset selector */}
            <div id="asset-selector-home" className="mb-6">
              <label className="flex items-center text-sm text-gray-600 mb-3">
                Asset
                <i
                  className="fas fa-circle-info ml-2 text-gray-400 cursor-help"
                  title="Choose the cryptocurrency you want to trade options on"
                />
              </label>

              <SelectMenu<`0x${string}`>
                value={selectedAssetToken}
                onChange={(token: `0x${string}`) => {
                  setSelectedAssetToken(token);
                  const candidates = markets.filter(
                    (m) => m.tokenA.toLowerCase() === token.toLowerCase()
                  );
                  if (candidates.length) {
                    setSelectedMarketIndex(candidates[0].index);
                  }
                }}
                disabled={isLoadingMarkets || !assetOptions.length}
                placeholder={
                  isLoadingMarkets
                    ? "Loading assets..."
                    : !assetOptions.length
                      ? "No assets available"
                      : "Select an asset…"
                }
                options={assetOptions.map(
                  (opt): SelectMenuOption<`0x${string}`> => ({
                    value: opt.tokenA,
                    label: opt.label,
                  })
                )}
                buttonClassName="cursor-pointer"
              />
            </div>

            {/* Strike selector */}
            <div id="strike-selector-home" className="mb-6">
              <label className="flex items-center text-sm text-gray-600 mb-3">
                Strike Price
                <i
                  className="fas fa-circle-info ml-2 text-gray-400 cursor-help"
                  title="The price at which you can buy (Call) or sell (Put) the asset"
                />
              </label>

              {isLoadingIntervals || isLoadingStrikeLiquidity ? (
                <div className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-500">
                  Loading strikes...
                </div>
              ) : strikeOptions.length === 0 ? (
                <div className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-500">
                  No strike available with liquidity for this asset.
                </div>
              ) : (
                <SelectMenu<number>
                  value={strikePosition}
                  onChange={(pos: number) => setStrikePosition(pos)}
                  options={strikeOptions.map(
                    (opt, idx): SelectMenuOption<number> => {
                      const liq =
                        strikeLiquidityByIndex[opt.strikeIndex] ?? 0;
                      return {
                        value: idx,
                        label: `$${opt.price.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`,
                        rightLabel: `${liq.toFixed(2)} ${selectedAssetSymbol}`,
                      };
                    }
                  )}
                  buttonClassName="cursor-pointer"
                />
              )}
            </div>

            {/* APR & Liquidity selector */}
            <div id="apr-liquidity-display-home" className="mb-6">
              <label className="mb-4 flex items-center text-sm text-gray-600">
                <span className="flex items-center">
                  APR &amp; Liquidity Available
                  <i
                    className="fas fa-circle-info ml-2 cursor-help text-gray-400"
                    title="APR tiers for this asset and strike."
                  />
                </span>
              </label>

              {(!selectedMarket || !aprOptions.length) && (
                <div className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-500">
                  No APR options available for this asset.
                </div>
              )}

              {selectedMarket && aprOptions.length > 0 && (() => {
  const filtered = aprOptions.filter((m) => {
    const v = aprAvailabilities[m.index];
    return typeof v === "number" && Number.isFinite(v) && v > 0;
  });

  if (!filtered.length) {
    return (
      <div className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-500">
        No liquidity available for this strike on any APR tier.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {filtered.map((m, idx) => {
        const aprDecMarket = Number(formatUnits(m.yield, 18));
        const aprPctMarket = aprDecMarket * 100;

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
        const available = aprAvailabilities[m.index] ?? null;
        const assetSymbol =
          m.tokenA.toLowerCase() === ADDRESSES.cbBTC.toLowerCase()
            ? "BTC"
            : "ETH";
        const used =
          allocationPlan.items.find((it) => it.market.index === m.index)
            ?.amount ?? 0;
        const isUsed = used > 1e-9;

        return (
          <div
            key={m.index}
            className={[
              "apr-option w-full rounded-xl border-2 bg-gradient-to-br p-4 transition",
              style.card,
              isUsed ? `${style.activeBorder} shadow-md` : "hover:shadow-lg",
            ].join(" ")}
          >
            <div className="text-center">
              <div className="mb-2">
                <span
                  className={`block text-xl font-bold ${style.textMain}`}
                >
                  {aprPctMarket.toFixed(2)}%
                </span>
              </div>
              <div className={`${style.boxBg} rounded-lg p-2`}>
                <p className={`text-sm font-bold ${style.boxText}`}>
                  {available === null
                    ? "..."
                    : `${available.toFixed(4)} ${assetSymbol}`}
                </p>
                <p className={`text-[10px] font-medium ${style.boxSub}`}>
                  Available
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
})()}
            </div>

            {/* Amount selector */}
            <div id="amount-selector-home" className="mb-6">
              <label className="flex items-center justify-between text-sm text-gray-600 mb-3">
                <span>Amount ({selectedAssetSymbol})</span>
                <span className="text-gray-500">
                  Available: {isLoadingAvailable ? "..." : totalAvailableLiquidity !== null ? `${totalAvailableLiquidity.toFixed(6)} ${selectedAssetSymbol}` : "-"}
                </span>
              </label>
              <div className="bg-gray-50 border border-gray-300 rounded-xl p-4 mb-4">
                <input
                  id="amount-input-home"
                  type="number"
                  step="0.000001"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAmount(v);
                    const n = Number(v);
                    if (totalAvailableLiquidity !== null && !isNaN(n) && totalAvailableLiquidity > 0) {
                      if (n <= 0) setPercent(0);
                      else if (n >= totalAvailableLiquidity) {
                        setPercent(100);
                        setAmount(totalAvailableLiquidity.toFixed(6));
                      } else {
                        setPercent(Math.min(100, (n / totalAvailableLiquidity) * 100));
                      }
                    }
                  }}
                  className="w-full bg-transparent text-2xl font-bold text-gray-900 focus:outline-none"
                />
                <div className="flex items-center justify-between mt-3">
                  <span id="usd-value-home" className="text-sm text-gray-500">
                    {btcUsdValue > 0
                      ? `~$${btcUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "~$0.00"}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-primary hover:text-secondary font-semibold cursor-pointer"
                    onClick={handleMaxClick}
                  >
                    MAX
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
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

            {/* Cost display */}
            <div
              id="cost-display-home"
              className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-gray-700">Weekly Rent Cost</span>
                <span className="text-2xl font-bold text-gray-900">
                  {`$${weeklyCost.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Effective APR</span>
                <span className="text-gray-900">
                  {effectiveAprPct > 0 ? `${effectiveAprPct.toFixed(2)}%` : "-"}
                </span>
              </div>
            </div>

            {/* Open position button */}
            <button
              id="open-position-btn-home"
              className="w-full bg-gradient-to-r from-primary to-secondary py-4 rounded-xl font-bold text-lg text-white 
              hover:shadow-lg hover:shadow-primary/50 transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] cursor-pointer
              disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleOpenPosition}
              disabled={isOpenPending || !address}
            >
              {isOpenPending ? "Opening..." : `Open ${optionType} Position`}
            </button>

            {/* Info cards */}
            <div id="info-cards-home" className="grid grid-cols-3 gap-4 mt-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <i className="fas fa-chart-line text-green-600 text-xl mb-2" />
                <p className="text-xs text-gray-600 mb-1">Potential Profit</p>
                <p className="text-sm font-semibold text-green-700">
                  Unlimited
                </p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                <i className="fas fa-shield-halved text-red-600 text-xl mb-2" />
                <p className="text-xs text-gray-600 mb-1">Max Loss</p>
                <p className="text-sm font-semibold text-red-700">
                  Weekly Rent
                </p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
                <i className="fas fa-clock text-purple-600 text-xl mb-2" />
                <p className="text-xs text-gray-600 mb-1">Duration</p>
                <p className="text-sm font-semibold text-gray-900">
                  Perpetual
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works-section" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-gray-900">
              How It Works
            </h2>
            <p className="text-xl text-gray-600">
              Three simple steps to start trading perpetual options
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div id="step-1" className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mx-auto mb-6 text-white text-3xl font-bold shadow-lg">
                1
              </div>
              <h3 className="text-xl font-bold mb-3 text-gray-900">
                Connect Wallet
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Connect your Web3 wallet and deposit USDC as collateral to start
                trading.
              </p>
            </div>
            <div id="step-2" className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mx-auto mb-6 text-white text-3xl font-bold shadow-lg">
                2
              </div>
              <h3 className="text-xl font-bold mb-3 text-gray-900">
                Choose Position
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Select Call or Put, choose your strike price and amount. See
                your weekly cost instantly.
              </p>
            </div>
            <div id="step-3" className="text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mx-auto mb-6 text-white text-3xl font-bold shadow-lg">
                3
              </div>
              <h3 className="text-xl font-bold mb-3 text-gray-900">
                Trade &amp; Profit
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Open your position and profit from unlimited upside. Close
                anytime you want.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq-section"
        className="py-20 bg-gradient-to-br from-gray-50 to-white"
      >
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4 text-gray-900">
              Frequently Asked Questions
            </h2>
            <p className="text-xl text-gray-600">
              Everything you need to know about perpetual options
            </p>
          </div>

          <div className="space-y-6">
            {/* FAQ 1 */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-primary hover:shadow-lg transition">
              <button
                type="button"
                className="cursor-pointer w-full flex items-center justify-between text-left"
                onClick={() =>
                  setOpenFaq(openFaq === 1 ? null : 1)
                }
              >
                <h3 className="text-xl font-semibold text-gray-900">
                  What are perpetual options?
                </h3>
                <i
                  className={`fas ${
                    openFaq === 1 ? "fa-minus" : "fa-plus"
                  } text-primary text-lg transition-transform`}
                />
              </button>
              {openFaq === 1 && (
                <div className="mt-4 text-gray-600 leading-relaxed">
                  Perpetual options are financial contracts that give you the
                  right to buy (call) or sell (put) an asset at a specific
                  price, but unlike traditional options, they never expire. You
                  pay a continuous rent to keep your position open and can close it
                  anytime.
                </div>
              )}
            </div>

            {/* FAQ 2 */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-primary hover:shadow-lg transition">
              <button
                type="button"
                className="cursor-pointer w-full flex items-center justify-between text-left"
                onClick={() =>
                  setOpenFaq(openFaq === 2 ? null : 2)
                }
              >
                <h3 className="text-xl font-semibold text-gray-900">
                  How does the rent work?
                </h3>
                <i
                  className={`fas ${
                    openFaq === 2 ? "fa-minus" : "fa-plus"
                  } text-primary text-lg transition-transform`}
                />
              </button>
              {openFaq === 2 && (
                <div className="mt-4 text-gray-600 leading-relaxed">
                  The rent is the continuous fee required to maintain your perpetual
                  option position. This fee is fixed for the duration of your contract
                  and is automatically deducted from your collateral every second.
                  The initial rent amount is determined by the asset's volatility, the
                  strike price, and prevailing market conditions, and the exact cost is
                  always displayed before you open a position.
                </div>
              )}
            </div>

            {/* FAQ 3 */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-primary hover:shadow-lg transition">
              <button
                type="button"
                className="cursor-pointer w-full flex items-center justify-between text-left"
                onClick={() =>
                  setOpenFaq(openFaq === 3 ? null : 3)
                }
              >
                <h3 className="text-xl font-semibold text-gray-900">
                  What happens if I run out of collateral?
                </h3>
                <i
                  className={`fas ${
                    openFaq === 3 ? "fa-minus" : "fa-plus"
                  } text-primary text-lg transition-transform`}
                />
              </button>
              {openFaq === 3 && (
                <div className="mt-4 text-gray-600 leading-relaxed">
                  To open a position, you must maintain enough collateral
                  to cover at least one week of rent. If your balance drops
                  below two days' worth of rent, your position will be
                  liquidated. This means an external party will execute
                  the contract (claiming any potential profits), and you
                  will incur a 12% penalty on your remaining collateral.
                </div>
              )}
            </div>

            {/* FAQ 4 */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-primary hover:shadow-lg transition">
              <button
                type="button"
                className="cursor-pointer w-full flex items-center justify-between text-left"
                onClick={() =>
                  setOpenFaq(openFaq === 4 ? null : 4)
                }
              >
                <h3 className="text-xl font-semibold text-gray-900">
                  How do I earn as a liquidity provider?
                </h3>
                <i
                  className={`fas ${
                    openFaq === 4 ? "fa-minus" : "fa-plus"
                  } text-primary text-lg transition-transform`}
                />
              </button>
              {openFaq === 4 && (
                <div className="mt-4 text-gray-600 leading-relaxed">
                  As a liquidity provider, you supply capital (an asset or stablecoin)
                  to a pool at a specified price, which guarantees a price for option
                  traders. While your capital is temporarily locked by active trades,
                  you are compensated with an attractive Annual Percentage Rate (APR)
                  derived from the rent paid by those traders.
                </div>
              )}
            </div>

            {/* FAQ 5 */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 hover:border-primary hover:shadow-lg transition">
              <button
                type="button"
                className="cursor-pointer w-full flex items-center justify-between text-left"
                onClick={() =>
                  setOpenFaq(openFaq === 5 ? null : 5)
                }
              >
                <h3 className="text-xl font-semibold text-gray-900">
                  What assets can I trade options on?
                </h3>
                <i
                  className={`fas ${
                    openFaq === 5 ? "fa-minus" : "fa-plus"
                  } text-primary text-lg transition-transform`}
                />
              </button>
              {openFaq === 5 && (
                <div className="mt-4 text-gray-600 leading-relaxed">
                  Right now, Scall.io focuses on blue-chip crypto assets like
                  BTC and ETH. More assets will be added over time as liquidity
                  and demand grow.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section
        id="stats-section"
        className="py-20 bg-gradient-to-br from-primary/5 to-secondary/5"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div
              id="stat-1"
              className="bg-white border border-gray-200 rounded-2xl p-8 text-center"
            >
              <p className="text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
                $156M
              </p>
              <p className="text-gray-600 font-medium">Total Trading Volume</p>
            </div>
            <div
              id="stat-2"
              className="bg-white border border-gray-200 rounded-2xl p-8 text-center"
            >
              <p className="text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
                $89M
              </p>
              <p className="text-gray-600 font-medium">Total Liquidity</p>
            </div>
            <div
              id="stat-3"
              className="bg-white border border-gray-200 rounded-2xl p-8 text-center"
            >
              <p className="text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
                18.5%
              </p>
              <p className="text-gray-600 font-medium">Average APR</p>
            </div>
            <div
              id="stat-4"
              className="bg-white border border-gray-200 rounded-2xl p-8 text-center"
            >
              <p className="text-4xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent mb-2">
                12K+
              </p>
              <p className="text-gray-600 font-medium">Active Traders</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="cta-section" className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-bold mb-6 text-gray-900">
            Ready to Start Trading?
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            Join thousands of traders using perpetual options on Scall.io
          </p>
          <div className="flex items-center justify-center space-x-4">
            <Link
              href={`/${locale}/trade`}
              className="bg-gradient-to-r from-primary to-secondary px-10 py-4 rounded-xl font-bold text-lg text-white hover:shadow-xl hover:shadow-primary/50 transition-transform transition-shadow duration-200 hover:-translate-y-0.5 cursor-pointer"
            >
              Start Trading Now
            </Link>
            <a
              href={`/${locale}/how-it-works`}
              className="bg-white border-2 border-gray-300 px-10 py-4 rounded-xl font-bold text-lg text-gray-900 hover:border-primary hover:shadow-lg transition-transform transition-shadow duration-200 hover:-translate-y-0.5 cursor-pointer"
            >
              View Documentation
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}