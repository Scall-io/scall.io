"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";

import { getBtcPrice } from "@/web3/functions";
import { publicClient, ADDRESSES, Contracts } from "@/web3/contracts";
import Toast from "@/app/components/Toast";
import TransactionModal, {
  TxStep,
} from "@/app/components/TransactionModal";

type OptionSide = "CALL" | "PUT";

type MarketInfo = {
  index: number;
  addr: `0x${string}`;
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  yield: bigint; // 18 decimals, e.g. 30% = 30e16 -> 0.3 decimal APR
};

type StrikeOption = {
  strikeIndex: number; // index in the full intervals array
  price: number; // strike price in USD
};

type RecentTrade = {
  id: number;
  marketIndex: number;
  isCall: boolean;
  strike: number; // USD
  amountBtc: number; // BTC equivalent
};

type AllocationPlanItem = {
  market: MarketInfo;
  amount: number; // BTC (or asset units)
};

export default function TradePage() {
  const [optionType, setOptionType] = useState<OptionSide>("CALL");
  const { address } = useAccount();

  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [btcBalance, setBtcBalance] = useState<number | null>(null); // still loaded but not shown

  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [selectedMarketIndex, setSelectedMarketIndex] = useState<number>(0);
  const [selectedAssetToken, setSelectedAssetToken] =
    useState<`0x${string}` | null>(null);

  const [intervals, setIntervals] = useState<number[]>([]);
  const [strikePosition, setStrikePosition] = useState<number>(0);

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

  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);

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

  // APR markets for the selected asset (max 3)
  const aprOptions = useMemo(() => {
    if (!selectedAssetToken) return [];
    return markets
      .filter(
        (m) => m.tokenA.toLowerCase() === selectedAssetToken.toLowerCase()
      )
      .slice(0, 3);
  }, [markets, selectedAssetToken]);

  const [amount, setAmount] = useState<string>("0.0");
  const [percent, setPercent] = useState<number>(0);

  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);
  const [isLoadingIntervals, setIsLoadingIntervals] = useState(false);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  const [availableLiquidity, setAvailableLiquidity] = useState<number | null>(
    null
  ); // per selected market (not used for routing anymore)
  const [isLoadingAvailable, setIsLoadingAvailable] = useState(false);

  const [aprAvailabilities, setAprAvailabilities] = useState<
    Record<number, number | null>
  >({});

  const [marketStats, setMarketStats] = useState<{
    totalLiquidityUsd: number;
    openInterestUsd: number;
    totalVolumeUsd: number;
  } | null>(null);

  const { writeContractAsync, isPending: isOpenPending } = useWriteContract();

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

  // Allocation plan: split user amount across APR markets, cheapest first
  const allocationPlan = useMemo(() => {
    if (!aprOptions.length) {
      return {
        items: [] as AllocationPlanItem[],
        totalUsed: 0,
        isFullfilled: false,
      };
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

  // ---------- Transaction modal state ----------
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txSteps, setTxSteps] = useState<TxStep[]>([]);

  // ---------- Load BTC Price ----------
  useEffect(() => {
    const load = async () => {
      const price = await getBtcPrice();
      if (price !== null) setBtcPrice(price);
    };
    load();
  }, []);

  // Load Trades for selected asset (all APR markets)
  useEffect(() => {
    const loadRecentTrades = async () => {
      if (!selectedMarket) {
        setRecentTrades([]);
        return;
      }

      try {
        // All markets with same asset (tokenA + tokenB)
        const sameAssetMarkets = markets.filter(
          (m) =>
            m.tokenA.toLowerCase() === selectedMarket.tokenA.toLowerCase() &&
            m.tokenB.toLowerCase() === selectedMarket.tokenB.toLowerCase()
        );

        if (!sameAssetMarkets.length) {
          setRecentTrades([]);
          return;
        }

        const trades: RecentTrade[] = [];

        for (const m of sameAssetMarkets) {
          // 1) ERC721 for this market
          const erc721Addr = (await publicClient.readContract({
            address: m.addr,
            abi: Contracts.MarketPool.abi,
            functionName: "getERC721_Contract",
          })) as `0x${string}`;

          // 2) All token IDs for this market
          const allTokenIds = (await publicClient.readContract({
            address: erc721Addr,
            abi: Contracts.ABI.ERC721,
            functionName: "getAllTokenIds",
          })) as bigint[];

          if (!allTokenIds.length) continue;

          // 3) Load all trades for now
          for (const idBN of allTokenIds) {
            const info = (await publicClient.readContract({
              address: m.addr,
              abi: Contracts.MarketPool.abi,
              functionName: "getContractInfos",
              args: [idBN],
            })) as any;

            const isCall = info.isCall as boolean;
            const strikeRaw = info.strike as bigint;
            const amountRaw = info.amount as bigint;

            const strike = Number(formatUnits(strikeRaw, 18)); // USD
            let amountBtc = 0;

            if (isCall) {
              // CALL: amount is in tokenA (BTC/ETH), 18 decimals
              const amountTokenA = Number(formatUnits(amountRaw, 18));
              amountBtc = amountTokenA;
            } else {
              // PUT: amount is in tokenB (USDC). Convert to BTC-equivalent using strike.
              const amountUsd = Number(formatUnits(amountRaw, 18));
              amountBtc = strike > 0 ? amountUsd / strike : 0;
            }

            trades.push({
              id: Number(idBN),
              marketIndex: m.index,
              isCall,
              strike,
              amountBtc,
            });
          }
        }

        setRecentTrades(trades);
      } catch (e) {
        console.error("Error loading recent trades:", e);
        setRecentTrades([]);
      }
    };

    loadRecentTrades();
  }, [selectedMarket, markets]);

  // ---------- Load BTC (cbBTC) Balance ----------
  useEffect(() => {
    if (!address) {
      setBtcBalance(null);
      return;
    }

    const loadBalance = async () => {
      try {
        setIsLoadingBalances(true);
        const raw = (await publicClient.readContract({
          address: ADDRESSES.cbBTC,
          abi: Contracts.ABI.ERC20,
          functionName: "balanceOf",
          args: [address],
        })) as bigint;

        const balance = parseFloat(formatUnits(raw, 18)); // cbBTC assumed 18 decimals
        setBtcBalance(balance);
      } catch (e) {
        console.error("Error loading cbBTC balance:", e);
        setBtcBalance(null);
      } finally {
        setIsLoadingBalances(false);
      }
    };

    loadBalance();
  }, [address]);

  // ---------- Load Markets from Main ----------
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

  // Keep selectedMarket consistent with selectedAssetToken
  useEffect(() => {
    if (!selectedAssetToken || !markets.length) return;

    const current = markets.find((m) => m.index === selectedMarketIndex);
    if (
      current &&
      current.tokenA.toLowerCase() === selectedAssetToken.toLowerCase()
    ) {
      return; // already consistent
    }

    const candidates = markets.filter(
      (m) => m.tokenA.toLowerCase() === selectedAssetToken.toLowerCase()
    );
    if (candidates.length) {
      setSelectedMarketIndex(candidates[0].index);
    }
  }, [selectedAssetToken, markets, selectedMarketIndex]);

  // ---------- Market stats across all APR markets ----------
  useEffect(() => {
    const loadMarketStats = async () => {
      if (!selectedMarket) {
        setMarketStats(null);
        return;
      }

      try {
        // all markets with same asset (tokenA + tokenB)
        const sameAssetMarkets = markets.filter(
          (m) =>
            m.tokenA.toLowerCase() === selectedMarket.tokenA.toLowerCase() &&
            m.tokenB.toLowerCase() === selectedMarket.tokenB.toLowerCase()
        );

        if (!sameAssetMarkets.length) {
          setMarketStats(null);
          return;
        }

        let totalLiquidityUsd = 0;
        let totalOpenInterestUsd = 0;
        let totalVolumeUsd = 0;

        for (const m of sameAssetMarkets) {
          const marketIndex = BigInt(m.index);

          const [liquidityArr, openInterestArr] = await Promise.all([
            publicClient.readContract({
              address: ADDRESSES.ProtocolInfos,
              abi: Contracts.ProtocolInfos.abi,
              functionName: "getMarketLiquidityProvided",
              args: [marketIndex],
            }) as Promise<bigint[]>,
            publicClient.readContract({
              address: ADDRESSES.ProtocolInfos,
              abi: Contracts.ProtocolInfos.abi,
              functionName: "getMarketOpenInterest",
              args: [marketIndex],
            }) as Promise<bigint[]>,
          ]);

          const callLiquidityRaw = liquidityArr[0] ?? 0;
          const putLiquidityRaw = liquidityArr[1] ?? 0;
          const callOpenRaw = openInterestArr[0] ?? 0;
          const putOpenRaw = openInterestArr[1] ?? 0;

          // asset price for this market
          let assetPrice = 1;
          if (
            m.tokenA.toLowerCase() === ADDRESSES.cbBTC.toLowerCase() &&
            btcPrice != null
          ) {
            assetPrice = btcPrice;
          }

          const callLiquidityAsset = parseFloat(
            formatUnits(callLiquidityRaw, 18)
          );
          const callOpenAsset = parseFloat(formatUnits(callOpenRaw, 18));

          const callLiquidityUsd = callLiquidityAsset * assetPrice;
          const callOpenUsd = callOpenAsset * assetPrice;

          const putLiquidityUsd = parseFloat(
            formatUnits(putLiquidityRaw, 18)
          );
          const putOpenUsd = parseFloat(formatUnits(putOpenRaw, 18));

          totalLiquidityUsd += callLiquidityUsd + putLiquidityUsd;
          totalOpenInterestUsd += callOpenUsd + putOpenUsd;
          totalVolumeUsd += callOpenUsd + putOpenUsd;
        }

        setMarketStats({
          totalLiquidityUsd,
          openInterestUsd: totalOpenInterestUsd,
          totalVolumeUsd,
        });
      } catch (e) {
        console.error("Error loading market stats:", e);
        setMarketStats(null);
      }
    };

    loadMarketStats();
  }, [selectedMarket, markets, btcPrice]);

  // ---------- Load Intervals from selected MarketPool ----------
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

  // Reset strike selection when toggling CALL/PUT or intervals change
  useEffect(() => {
    setStrikePosition(0);
  }, [optionType, intervals.length]);

  // ---------- Build strike options (PUT = first half, CALL = second half) ----------
  const strikeOptions: StrikeOption[] = useMemo(() => {
    if (!intervals.length) return [];

    const half = Math.floor(intervals.length / 2);
    if (optionType === "CALL") {
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
  }, [intervals, optionType]);

  const currentStrikeOption =
    strikeOptions.length > 0
      ? strikeOptions[Math.min(strikePosition, strikeOptions.length - 1)]
      : null;

  // ---------- Load available liquidity for this strike from selected market (informational) ----------
  useEffect(() => {
    const loadAvailable = async () => {
      if (!selectedMarket || !currentStrikeOption) {
        setAvailableLiquidity(null);
        return;
      }

      try {
        setIsLoadingAvailable(true);
        // Convert the chosen strike price → uint256 with 18 decimals
        const strikeWei = parseUnits(
          currentStrikeOption.price.toString(),
          18
        );

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
          // Available in BTC
          available = callLP - callLU - callLR / strike;
        } else {
          // Available in USDC converted to BTC
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

  // ---------- Load available liquidity for each APR market (same asset, current strike) ----------
  useEffect(() => {
    const loadAprAvailabilities = async () => {
      if (!currentStrikeOption || !aprOptions.length) {
        setAprAvailabilities({});
        return;
      }

      try {
        const strikeWei = parseUnits(
          currentStrikeOption.price.toString(),
          18
        );

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
              // Available in asset units (BTC/ETH)
              available = callLP - callLU - callLR / strike;
            } else {
              // Available in asset units via PUT side
              available = (putLP - putLU - putLR * strike) / strike;
            }

            if (!Number.isFinite(available) || available < 0) available = 0;
            results[m.index] = available;
          } catch (err) {
            console.error("Error loading APR market liquidity", m.index, err);
            results[m.index] = null;
          }
        }

        setAprAvailabilities(results);
      } catch (err) {
        console.error("Error preparing APR availabilities:", err);
        setAprAvailabilities({});
      }
    };

    loadAprAvailabilities();
  }, [aprOptions, currentStrikeOption, optionType]);

  // ---------- Amount slider & USD value (based on TOTAL AVAILABLE LIQUIDITY) ----------
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

  const btcUsdValue = useMemo(() => {
    if (!btcPrice || !amount) return 0;
    const n = Number(amount);
    if (isNaN(n) || n <= 0) return 0;
    return n * btcPrice;
  }, [amount, btcPrice]);

  // ---------- Cost metrics (multi-APR aware) ----------
  const costMetrics = useMemo(() => {
    if (!currentStrikeOption) {
      return {
        weeklyCost: 0,
        annualCost: 0,
        breakEvenPrice: 0,
        effectiveAprPct: 0,
      };
    }

    const strikePrice = currentStrikeOption.price;
    const desiredAmount = Number(amount);
    if (!Number.isFinite(desiredAmount) || desiredAmount <= 0) {
      return {
        weeklyCost: 0,
        annualCost: 0,
        breakEvenPrice: 0,
        effectiveAprPct: 0,
      };
    }

    const SECONDS_PER_YEAR = 31536000;
    let totalWeeklyCost = 0;
    let effectiveAprDec = 0;

    if (allocationPlan.items.length === 0) {
      // Fallback: single-APR market
      if (!selectedMarket) {
        return {
          weeklyCost: 0,
          annualCost: 0,
          breakEvenPrice: 0,
          effectiveAprPct: 0,
        };
      }
      const aprDec = Number(formatUnits(selectedMarket.yield, 18)); // e.g. 0.30 for 30%
      const oi = strikePrice * desiredAmount;
      totalWeeklyCost = (aprDec * oi) / 52;
      effectiveAprDec = aprDec;
    } else {
      // Multi-APR routing
      for (const it of allocationPlan.items) {
        const aprDecMarket = Number(formatUnits(it.market.yield, 18));
        const oi = strikePrice * it.amount;
        totalWeeklyCost += (aprDecMarket * oi) / 52;
      }

      // Effective APR such that:
      // totalWeeklyCost = effectiveAprDec * strikePrice * desiredAmount / 52
      if (strikePrice > 0 && desiredAmount > 0) {
        effectiveAprDec =
          (totalWeeklyCost * 52) / (strikePrice * desiredAmount);
      } else {
        effectiveAprDec = 0;
      }
    }

    const annualCost = totalWeeklyCost * 52;

    let breakEvenPrice = 0;
    const effectiveAmt = desiredAmount;
    if (effectiveAmt > 0) {
      const costPerUnit = totalWeeklyCost / effectiveAmt;
      breakEvenPrice =
        optionType === "CALL"
          ? strikePrice + costPerUnit
          : strikePrice - costPerUnit;
    }

    return {
      weeklyCost: totalWeeklyCost,
      annualCost,
      breakEvenPrice,
      effectiveAprPct: effectiveAprDec * 100, // in %
    };
  }, [allocationPlan, selectedMarket, currentStrikeOption, amount, optionType]);

  const { weeklyCost, breakEvenPrice, effectiveAprPct } = costMetrics;

  // ---------- Open Position ----------
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

    const amtNum = Number(amount);
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      showToast("Invalid amount.", "error");
      return;
    }

    if (!allocationPlan.isFullfilled) {
      showToast(
        "Amount exceeds total available liquidity across all APR markets.",
        "error"
      );
      return;
    }

    try {
      const strikePrice = currentStrikeOption.price;
      const SECONDS_PER_YEAR = 31536000;
      const allocations = allocationPlan.items;

      if (!allocations.length) {
        showToast("No APR markets available to fill this amount.", "error");
        return;
      }

      // ---- 1) Get collateral token and decimals ----
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

      // ---- 2) Check user collateral balance in the pool ----
      const userCollateralRaw = (await publicClient.readContract({
        address: ADDRESSES.CollateralPool,
        abi: Contracts.CollateralPool.abi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;

      const userCollateral = Number(
        formatUnits(userCollateralRaw, collateralDecimals)
      );

      if (userCollateral <= 0) {
        showToast(
          "You have no collateral deposited. Go to Dashboard and deposit collateral first.",
          "error"
        );
        return;
      }

      // ---- 3) Compute TOTAL rent per second for all sub-positions ----
      let totalRentPerSecondUsd = 0;

      for (const alloc of allocations) {
        const aprDecMarket = Number(formatUnits(alloc.market.yield, 18));
        if (aprDecMarket <= 0) continue;

        const oiUsd = strikePrice * alloc.amount;
        const rentPerSecondUsd = (oiUsd * aprDecMarket) / SECONDS_PER_YEAR;
        totalRentPerSecondUsd += rentPerSecondUsd;
      }

      if (
        !Number.isFinite(totalRentPerSecondUsd) ||
        totalRentPerSecondUsd <= 0
      ) {
        showToast("Unable to compute rent for this position.", "error");
        return;
      }

      const rentScaledTotal = parseUnits(
        totalRentPerSecondUsd.toFixed(collateralDecimals),
        collateralDecimals
      );

      // ---- 4) Ask CollateralPool if this user can open all these contracts (total rent) ----
      const canOpen = (await publicClient.readContract({
        address: ADDRESSES.CollateralPool,
        abi: Contracts.CollateralPool.abi,
        functionName: "canOpenContract",
        args: [address, rentScaledTotal],
      })) as boolean;

      if (!canOpen) {
        showToast(
          "You don't have enough collateral to open this position. Please deposit more collateral.",
          "error"
        );
        return;
      }

      // ---- 5) Build transaction steps for the modal (one per sub-position) ----
      const txModalSteps: TxStep[] = allocations.map((alloc, idx) => {
        const aprDecMarket = Number(formatUnits(alloc.market.yield, 18));
        const aprPctMarket = aprDecMarket * 100;
        const assetSymbol =
          alloc.market.tokenA.toLowerCase() ===
          ADDRESSES.cbBTC.toLowerCase()
            ? "BTC"
            : "ETH";

        return {
          id: `open-${alloc.market.index}-${idx}`,
          title: `Open ${optionType === "CALL" ? "CALL" : "PUT"} position`,
          description: `${alloc.amount.toFixed(4)} ${assetSymbol} at $${strikePrice.toFixed(
            2
          )} • APR ${aprPctMarket.toFixed(2)}%`,
          status: idx === 0 ? "pending" : "upcoming",
        };
      });

      setTxSteps(txModalSteps);
      setIsTxModalOpen(true);

      showToast(
        `Collateral check passed. Opening ${
          allocations.length
        } contract${allocations.length > 1 ? "s" : ""} across APR tiers…`,
        "info"
      );

      // ---- 6) Fetch ERC20 decimals for amount encoding (same tokens for all markets of this asset) ----
      const decimalsTokenA = Number(
        (await publicClient.readContract({
          address: selectedMarket.tokenA,
          abi: Contracts.ABI.ERC20,
          functionName: "decimals",
        })) as bigint
      );

      const decimalsTokenB = Number(
        (await publicClient.readContract({
          address: selectedMarket.tokenB,
          abi: Contracts.ABI.ERC20,
          functionName: "decimals",
        })) as bigint
      );

      // ---- 7) Compute strike index (local) ----
      const intervalLength = intervals.length;
      const half = Math.floor(intervalLength / 2);

      let strikeIndexParam = currentStrikeOption.strikeIndex;
      if (optionType === "CALL") {
        // CALL side indices are the second half
        strikeIndexParam = strikeIndexParam - half;
      }
      if (strikeIndexParam < 0) {
        throw new Error(
          `Invalid strike index: ${strikeIndexParam} (global=${currentStrikeOption.strikeIndex})`
        );
      }

      // ---- 8) Send openContract txs for each allocation (cheapest APR first) ----
      for (let i = 0; i < allocations.length; i++) {
        const alloc = allocations[i];
        const m = alloc.market;

        // Ensure the current step is marked as pending
        setTxSteps((prev) =>
          prev.map((step, idx) =>
            idx === i ? { ...step, status: "pending" } : step
          )
        );

        let parsedAmount: bigint;

        if (optionType === "CALL") {
          // amount is in tokenA (BTC/ETH)
          parsedAmount = parseUnits(
            alloc.amount.toString(),
            decimalsTokenA
          );
        } else {
          // PUT: amount in tokenB = amountBTC * strike
          const amountUsd = (alloc.amount * strikePrice).toString();
          parsedAmount = parseUnits(amountUsd, decimalsTokenB);
        }

          try {
          // 1) Ask wallet & send tx
          const hash = await writeContractAsync({
            address: m.addr,
            abi: Contracts.MarketPool.abi,
            functionName: "openContract",
            args: [
              optionType === "CALL",          // bool _isCall
              BigInt(strikeIndexParam),       // uint256 _strikeIndex
              parsedAmount,                   // uint256 _amount
            ],
          });

          // 2) Wait for on-chain confirmation
          await publicClient.waitForTransactionReceipt({ hash });

          // 3) Only now mark this step as completed
          setTxSteps((prev) =>
            prev.map((step, idx) =>
              idx === i ? { ...step, status: "completed" } : step
            )
          );
        } catch (err) {
          // Mark this step as error and rethrow so outer catch handles toast
          setTxSteps((prev) =>
            prev.map((step, idx) =>
              idx === i ? { ...step, status: "error" } : step
            )
          );
          throw err;
        }
      }

      // All steps done successfully
      showToast(
        "Position transactions sent. They will confirm on-chain shortly.",
        "success"
      );
    } catch (err: any) {
      console.error(err);
      showToast(
        err?.shortMessage || err?.message || "Transaction failed",
        "error"
      );
    }
  };

  return (
    <div id="trade-page" className="pt-24 pb-12">
      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Transaction Progress Modal */}
      <TransactionModal
        isOpen={isTxModalOpen}
        steps={txSteps}
        onClose={() => {
          setIsTxModalOpen(false);
          setTxSteps([]);
        }}
      />

      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main trading card */}
          <div
            id="trading-card"
            className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
          >
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="mb-2 text-3xl font-bold text-gray-900">
                  Trade Options
                </h1>
                <p className="text-gray-600">
                  Open perpetual call or put positions
                </p>
              </div>
              <div id="current-price-display" className="text-right">
                <p className="mb-1 text-sm text-gray-500">BTC Price</p>
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
              id="option-type-toggle"
              className="mb-6 flex rounded-xl bg-gray-100 p-1.5"
            >
              <button
                id="call-btn"
                onClick={() => setOptionType("CALL")}
                className={`flex-1 cursor-pointer rounded-lg py-3 font-semibold transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]
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
                id="put-btn"
                onClick={() => setOptionType("PUT")}
                className={`flex-1 cursor-pointer rounded-lg py-3 font-semibold transition-all duration-200 hover:scale-[1.03] active:scale-[0.97]
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
            <div id="asset-selector" className="mb-6">
              <label className="mb-3 flex items-center text-sm text-gray-600">
                Asset
                <i
                  className="fas fa-circle-info ml-2 cursor-help text-gray-400"
                  title="Choose the underlying asset you want to trade options on"
                />
              </label>
              <select
                id="asset-dropdown"
                className="w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-4 py-4 text-gray-900 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={selectedAssetToken ?? ""}
                onChange={(e) => {
                  const token = e.target.value as `0x${string}`;
                  setSelectedAssetToken(token);
                  const candidates = markets.filter(
                    (m) =>
                      m.tokenA.toLowerCase() === token.toLowerCase()
                  );
                  if (candidates.length) {
                    setSelectedMarketIndex(candidates[0].index);
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
                      {opt.label} Market
                    </option>
                  ))}
              </select>
            </div>

            {/* Strike selector */}
            <div id="strike-selector" className="mb-6">
              <label className="mb-3 flex items-center text-sm text-gray-600">
                Strike Price
                <i
                  className="fas fa-circle-info ml-2 cursor-help text-gray-400"
                  title="The price at which you can buy (Call) or sell (Put) the asset"
                />
              </label>
              <div className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-gray-900">
                {isLoadingIntervals ? (
                  <span className="text-gray-500">Loading strikes...</span>
                ) : strikeOptions.length === 0 ? (
                  <span className="text-gray-500">
                    No strikes available for this market.
                  </span>
                ) : (
                  <select
                    id="strike-dropdown"
                    className="w-full cursor-pointer bg-transparent font-semibold focus:outline-none"
                    value={strikePosition}
                    onChange={(e) =>
                      setStrikePosition(Number(e.target.value))
                    }
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
              <label className="mb-4 flex items-center text-sm text-gray-600">
                <span className="flex items-center">
                  APR &amp; Liquidity Available
                  <i
                    className="fas fa-circle-info ml-2 cursor-help text-gray-400"
                    title="APR tiers for this asset and strike. The system automatically uses the lowest-APR liquidity first."
                  />
                </span>
              </label>

              {(!selectedMarket || !aprOptions.length) && (
                <div className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-500">
                  No APR options available for this asset.
                </div>
              )}

              {selectedMarket && aprOptions.length > 0 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {aprOptions.map((m, idx) => {
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
                      m.tokenA.toLowerCase() ===
                      ADDRESSES.cbBTC.toLowerCase()
                        ? "BTC"
                        : "ETH";

                    const used =
                      allocationPlan.items.find(
                        (it) => it.market.index === m.index
                      )?.amount ?? 0;
                    const isUsed = used > 1e-9;

                    return (
                      <div
                        key={m.index}
                        className={[
                          "apr-option w-full rounded-xl border-2 bg-gradient-to-br p-5 transition",
                          style.card,
                          isUsed
                            ? `${style.activeBorder} shadow-md`
                            : "hover:shadow-lg",
                        ].join(" ")}
                      >
                        <div className="text-center">
                          <div className="mb-3">
                            <span
                              className={`block text-2xl font-bold ${style.textMain}`}
                            >
                              {aprPctMarket.toFixed(2)}%
                            </span>
                            <span
                              className={`text-sm font-medium ${style.textSub}`}
                            >
                              {/* tier label optional */}
                            </span>
                          </div>
                          <div className={`${style.boxBg} rounded-lg p-3`}>
                            <p className={`text-lg font-bold ${style.boxText}`}>
                              {available === null
                                ? "Loading..."
                                : `${available.toFixed(4)} ${assetSymbol}`}
                            </p>
                            <p
                              className={`text-xs font-medium ${style.boxSub}`}
                            >
                              Available
                            </p>
                            {isUsed && (
                              <p className="mt-1 text-[11px] text-gray-700">
                                Used for ~{used.toFixed(4)} {assetSymbol}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedMarket && allocationPlan.items.length >= 2 && (
                <div
                  id="selected-apr-info"
                  className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4"
                >
                  <p className="text-sm text-gray-700">
                    Your amount is split across several APR tiers. One contract
                    will be opened for each APR tier used, so multiple
                    on-chain transactions will be required.
                  </p>
                </div>
              )}
            </div>

            {/* Amount selector */}
            <div id="amount-selector" className="mb-6">
              <label className="mb-3 flex items-center justify-between text-sm text-gray-600">
                <span>Amount (BTC)</span>
                <span className="text-gray-500">
                  Available:{" "}
                  {isLoadingAvailable
                    ? "Loading..."
                    : totalAvailableLiquidity !== null
                    ? `${totalAvailableLiquidity.toFixed(6)} BTC`
                    : "- BTC"}
                </span>
              </label>
              <div className="mb-4 rounded-xl border border-gray-300 bg-gray-50 p-4">
                <input
                  id="amount-input"
                  type="number"
                  step="0.000001"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setAmount(v);
                    const n = Number(v);
                    if (
                      totalAvailableLiquidity !== null &&
                      !isNaN(n) &&
                      totalAvailableLiquidity > 0
                    ) {
                      if (n <= 0) {
                        setPercent(0);
                      } else if (n >= totalAvailableLiquidity) {
                        setPercent(100);
                        setAmount(totalAvailableLiquidity.toFixed(6));
                      } else {
                        setPercent(
                          Math.min(
                            100,
                            (n / totalAvailableLiquidity) * 100
                          )
                        );
                      }
                    }
                  }}
                  className="w-full bg-transparent text-2xl font-bold text-gray-900 focus:outline-none"
                />
                <div className="mt-3 flex items-center justify-between">
                  <span id="usd-value" className="text-sm text-gray-500">
                    {btcUsdValue > 0
                      ? `~$${btcUsdValue.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "~$0.00"}
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer text-xs font-semibold text-primary hover:text-secondary"
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
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 accent-primary"
              />
              <div className="mt-2 flex justify-between text-xs text-gray-500">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Cost display */}
            <div
              id="cost-display"
              className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-6"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="text-gray-700">Weekly Rent Cost</span>
                <span className="text-2xl font-bold text-gray-900">
                  {`$${weeklyCost.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-gray-600">Effective APR</span>
                <span className="text-gray-900">
                  {effectiveAprPct > 0
                    ? `${effectiveAprPct.toFixed(2)}%`
                    : "-"}
                </span>
              </div>
            </div>

            {/* Open position button */}
            <button
              id="open-position-btn"
              className="w-full cursor-pointer rounded-xl bg-gradient-to-r from-primary to-secondary py-4 text-lg font-bold text-white shadow-sm transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={handleOpenPosition}
              disabled={isOpenPending || !address}
            >
              {isOpenPending
                ? "Opening position..."
                : `Open ${optionType} Position`}
            </button>

            {/* Info cards */}
            <div
              id="info-cards"
              className="mt-6 grid grid-cols-3 gap-4"
            >
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
                <i className="mb-2 text-xl text-green-600 fas fa-chart-line" />
                <p className="mb-1 text-xs text-gray-600">
                  Potential Profit
                </p>
                <p className="text-sm font-semibold text-green-700">
                  Unlimited
                </p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
                <i className="mb-2 text-xl text-red-600 fas fa-shield-halved" />
                <p className="mb-1 text-xs text-gray-600">Max Loss</p>
                <p className="text-sm font-semibold text-red-700">
                  Contract Rent
                </p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-center">
                <i className="mb-2 text-xl text-purple-600 fas fa-clock" />
                <p className="mb-1 text-xs text-gray-600">Duration</p>
                <p className="text-sm font-semibold text-gray-900">
                  Perpetual
                </p>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div id="sidebar" className="space-y-6">
            {/* Position summary card */}
            <div
              id="position-summary-card"
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <h3 className="mb-4 text-lg font-bold text-gray-900">
                Position Summary
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Option Type</span>
                  <span
                    id="summary-type"
                    className={`rounded px-2 py-1 text-sm font-semibold ${
                      optionType === "CALL"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {optionType}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Asset</span>
                  <span
                    id="summary-asset"
                    className="font-semibold text-gray-900"
                  >
                    {selectedMarket
                      ? selectedMarket.tokenA.toLowerCase() ===
                        ADDRESSES.cbBTC.toLowerCase()
                        ? "Bitcoin (BTC)"
                        : "Ethereum (ETH)"
                      : "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
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
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">APR</span>
                  <span
                    id="summary-apr"
                    className="font-semibold text-gray-900"
                  >
                    {effectiveAprPct > 0
                      ? `${effectiveAprPct.toFixed(2)}%`
                      : "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Amount</span>
                  <span
                    id="summary-amount"
                    className="font-semibold text-gray-900"
                  >
                    {amount || "0"} BTC
                  </span>
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      Weekly Rent Cost
                    </span>
                    <span
                      id="summary-cost"
                      className="text-lg font-bold text-gray-900"
                    >
                      {`$${weeklyCost.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Market stats */}
            <div
              id="market-stats-card"
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <h3 className="mb-4 text-lg font-bold text-gray-900">
                Market Stats
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">24h Volume</span>
                  <span className="font-semibold text-gray-900">
                    {marketStats
                      ? `$${marketStats.totalVolumeUsd.toLocaleString(
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
                  <span className="text-sm text-gray-600">
                    Open Interest
                  </span>
                  <span className="font-semibold text-gray-900">
                    {marketStats
                      ? `$${marketStats.openInterestUsd.toLocaleString(
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
                  <span className="text-sm text-gray-600">
                    Total Liquidity
                  </span>
                  <span className="font-semibold text-gray-900">
                    {marketStats
                      ? `$${marketStats.totalLiquidityUsd.toLocaleString(
                          undefined,
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }
                        )}`
                      : "-"}
                  </span>
                </div>
              </div>
            </div>

            {/* Recent trades */}
            <div
              id="recent-trades-card"
              className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <h3 className="mb-4 text-lg font-bold text-gray-900">
                Recent Trades
              </h3>
              <div className="space-y-3 text-sm">
                {recentTrades.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No trades yet for this market.
                  </p>
                ) : (
                  recentTrades.map((t) => (
                    <div
                      key={`${t.marketIndex}-${t.id}`}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-2">
                        <span
                          className={`inline-flex w-14 justify-center rounded px-2 py-0.5 text-xs font-semibold ${
                            t.isCall
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {t.isCall ? "CALL" : "PUT"}
                        </span>

                        <span className="text-gray-600">
                          {t.strike > 0
                            ? `$${t.strike.toLocaleString(undefined, {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              })}`
                            : "-"}
                        </span>
                      </div>

                      <span className="font-semibold text-gray-900">
                        {t.amountBtc.toFixed(4)} BTC
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Education cards */}
        <div
          id="education-section"
          className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3"
        >
          <div className="cursor-pointer rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-primary hover:shadow-md">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-green-100">
              <i className="fas fa-arrow-trend-up text-xl text-green-600" />
            </div>
            <h4 className="mb-2 text-lg font-bold text-gray-900">
              What are Calls?
            </h4>
            <p className="text-sm text-gray-600">
              Call options give you the right to buy an asset at a specific
              price. Profit when price goes up.
            </p>
          </div>

          <div className="cursor-pointer rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-primary hover:shadow-md">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
              <i className="fas fa-arrow-trend-down text-xl text-red-600" />
            </div>
            <h4 className="mb-2 text-lg font-bold text-gray-900">
              What are Puts?
            </h4>
            <p className="text-sm text-gray-600">
              Put options give you the right to sell an asset at a specific
              price. Profit when price goes down.
            </p>
          </div>

          <div className="cursor-pointer rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-primary hover:shadow-md">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100">
              <i className="fas fa-infinity text-xl text-purple-600" />
            </div>
            <h4 className="mb-2 text-lg font-bold text-gray-900">
              Perpetual Options
            </h4>
            <p className="text-sm text-gray-600">
              No expiration date. Pay the contract rent to keep positions open
              as long as you want.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
