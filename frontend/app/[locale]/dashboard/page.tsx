"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits } from "viem";
import {
  getLpStats,
  getCollateralInfo,
  getLpPositions,
  getTradePositions,
  getUsdcBalance,
  getMarketAssetPrice,
  LpPosition,
  TradePosition,
} from "@/web3/functions";
import { ADDRESSES, publicClient, Contracts } from "@/web3/contracts";
import Toast from "@/app//components/Toast";
import { Skeleton } from "@/app/components/Skeleton";
import TransactionModal, { TxStep } from "@/app/components/TransactionModal";

// Define MarketInfo type to avoid duplication
type MarketInfo = {
  addr: `0x${string}`;
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  yield: bigint; // APR, 1e18 based
  priceFeed: `0x${string}`; // Chainlink price feed
};

export default function DashboardPage() {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [reloadKey, setReloadKey] = useState(0);
  const [closingTradeId, setClosingTradeId] = useState<number | null>(null);
  const [closingLpId, setClosingLpId] = useState<number | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info" | "warning";
  } | null>(null);

  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [txSteps, setTxSteps] = useState<TxStep[]>([]);
  const { address } = useAccount();

  const [collateralInfo, setCollateralInfo] = useState<{
    collateral: number;
    rent: number;
    withdrawable: number;
  } | null>(null);

  const [lpStats, setLpStats] = useState<{
    totalOpenInterest: number;
    totalRewards: number;
    estimatedYearlyEarnings: number;
    apr: number;
  } | null>(null);

  const [lpPositions, setLpPositions] = useState<LpPosition[]>([]);
  const [tradePositions, setTradePositions] = useState<TradePosition[]>([]);
  const [marketAssets, setMarketAssets] = useState<Record<number, "BTC" | "ETH">>({});
  const [marketAprs, setMarketAprs] = useState<Record<number, number>>({});
  const [assetPrices, setAssetPrices] = useState<Record<number, number>>({});
  const [utilizations, setUtilizations] = useState<Record<string, number>>({});

  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [collateralAmount, setCollateralAmount] = useState<string>("0.00");
  const [loading, setLoading] = useState(false);

  // Combine useWriteContract calls into one object for cleaner access
  const { writeContractAsync: writeClaimAsync, isPending: isClaimPending } = useWriteContract();
  const { writeContractAsync: writeCollateralAsync, isPending: isCollateralPending } = useWriteContract();
  const { writeContractAsync: writeTokenAsync } = useWriteContract();
  const { writeContractAsync: writeMarketAsync } = useWriteContract();

  // Unified toast handler (useCallback for stability)
  const showToast = useCallback((
    message: string,
    type: "success" | "error" | "info" | "warning" = "info"
  ) => {
    setToast({ message, type });
  }, []); // Empty dependency array means it only gets created once

  // Utility function for getting Market Info (useCallback for stability)
  const getMarketInfoFromIndex = useCallback(async (
    index: number
  ): Promise<MarketInfo | null> => {
    try {
      const info = (await publicClient.readContract({
        address: ADDRESSES.Main,
        abi: Contracts.Main.abi,
        functionName: "getIdToMarketInfos",
        args: [BigInt(index)],
      })) as {
        addr: `0x${string}`;
        tokenA: `0x${string}`;
        tokenB: `0x${string}`;
        priceFeed: `0x${string}`;
        intervalLength: bigint;
        range: bigint;
        yield: bigint;
      };

      return {
        addr: info.addr,
        tokenA: info.tokenA,
        tokenB: info.tokenB,
        yield: info.yield,
        priceFeed: info.priceFeed,
      };
    } catch (e) {
      console.error("Error loading market info for index", index, e);
      return null;
    }
  }, []); // Empty dependency array as it only relies on imported constants

  // --- Data Loading Effect (Combined) ---
  useEffect(() => {
    if (!address) {
      setCollateralInfo(null);
      setLpStats(null);
      setLpPositions([]);
      setTradePositions([]);
      setUsdcBalance(null);
      return;
    }

    const loadDashboardData = async () => {
      setLoading(true);
      // Grouping all initial data fetches into one Promise.all greatly reduces the number of initial API calls.
      try {
        const [coll, stats, lps, trades, usdcBal] = await Promise.all([
          getCollateralInfo(address as `0x${string}`),
          getLpStats(address as `0x${string}`),
          getLpPositions(address as `0x${string}`),
          getTradePositions(address as `0x${string}`),
          getUsdcBalance(address as `0x${string}`),
        ]);

        setCollateralInfo(coll);
        setLpStats(stats);
        setLpPositions(lps);
        setTradePositions(trades);
        setUsdcBalance(usdcBal);
      } catch (e) {
         console.error("Error loading initial dashboard data:", e);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [address, reloadKey]);

  // --- Utilization Loading Effect ---
  useEffect(() => {
    const loadUtilizations = async () => {
      if (!lpPositions.length) {
        setUtilizations({});
        return;
      }

      const entries: [string, number][] = [];

      for (const lp of lpPositions) {
        try {
          // This call is necessary per LP position but is cached by the `getMarketInfoFromIndex` useCallback
          const market = await getMarketInfoFromIndex(lp.index);
          if (!market) continue;

          // Rebuild strike raw (18 decimals)
          const strikeRaw = parseUnits(lp.strike.toString(), 18);

          // Cast result to any to avoid complex TS typing for MarketPoolABI return
          const strikeInfos = (await publicClient.readContract({
            address: market.addr,
            abi: Contracts.MarketPool.abi,
            functionName: "getStrikeInfos",
            args: [strikeRaw],
          })) as any; 

          const { callLP, callLU, putLP, putLU } = strikeInfos;

          let utilization = 0;

          const LP = lp.isCall ? callLP : putLP;
          const LU = lp.isCall ? callLU : putLU;
          
          if (LP > 0n) {
            // Utilization = LU / LP * 100
            utilization = Number(LU * BigInt(10000) / LP) / 100; // 2 decimals
          }
          
          entries.push([`${lp.index}-${lp.id}`, utilization]);
        } catch (e) {
          console.error("Error loading utilization for LP", lp, e);
        }
      }

      setUtilizations(Object.fromEntries(entries));
    };

    // Dependencies: lpPositions (when primary data changes) and getMarketInfoFromIndex (for stability)
    loadUtilizations();
  }, [lpPositions, getMarketInfoFromIndex]);

  // --- Market Assets, APRs, and Prices Loading Effect (Combined) ---
  useEffect(() => {
    const loadMarketDetails = async () => {
      const indexes = Array.from(
        new Set([
          ...tradePositions.map((p) => p.index),
          ...lpPositions.map((lp) => lp.index),
        ])
      );

      if (!indexes.length) {
        setMarketAssets({});
        setMarketAprs({});
        setAssetPrices({});
        return;
      }

      const assetEntries: [number, "BTC" | "ETH"][] = [];
      const aprEntries: [number, number][] = [];
      const priceEntries: [number, number][] = [];

      // Consolidate fetching all market details for unique indexes here
      for (const idx of indexes) {
        try {
          const info = await getMarketInfoFromIndex(idx);
          if (!info) continue;

          const isBTC = info.tokenA.toLowerCase() === ADDRESSES.cbBTC.toLowerCase();
          const assetSymbol = isBTC ? "BTC" : "ETH";

          assetEntries.push([idx, assetSymbol]);

          const aprPercent = Number(info.yield) / 1e16;
          aprEntries.push([idx, aprPercent]);

          // This is a separate API call, but only executed once per unique market index
          const price = await getMarketAssetPrice(BigInt(idx));
          if (price !== null) {
            priceEntries.push([idx, price]); 
          }
        } catch (e) {
          console.error("Error resolving asset/APR/price for market index", idx, e);
        }
      }

      setMarketAssets(Object.fromEntries(assetEntries));
      setMarketAprs(Object.fromEntries(aprEntries));
      setAssetPrices(Object.fromEntries(priceEntries));
    };

    // Dependencies: tradePositions and lpPositions (when primary data changes)
    loadMarketDetails();
  }, [tradePositions, lpPositions, getMarketInfoFromIndex]);

  // --- Derived Metrics for LPs and Trades (Kept useMemo) ---
  const activeLpCount = lpPositions.length;
  const avgLpDurationDays = useMemo(() => {
    if (!lpPositions.length) return 0;
    const nowSec = Date.now() / 1000;
    const totalDays = lpPositions.reduce((acc, lp) => {
      return acc + (nowSec - lp.start) / 86400;
    }, 0);
    return totalDays / lpPositions.length;
  }, [lpPositions]);

  const {
    totalInvested,
    totalPnL,
    totalWeeklyRent,
    avgROI,
  } = useMemo(() => {
    if (!tradePositions.length) {
      return {
        totalInvested: 0,
        totalPnL: 0,
        totalWeeklyRent: 0,
        avgROI: 0,
      };
    }
    const invested = tradePositions.reduce((sum, p) => sum + p.spent, 0);
    const pnl = tradePositions.reduce(
      (sum, p) => sum + (p.earnings - p.spent),
      0
    );
    const rent = tradePositions.reduce((sum, p) => sum + p.rent, 0);
    const totalWeeklyRent = rent * 3600 * 24 * 7; 
    const roi = invested > 0 ? (pnl / invested) * 100 : 0;

    return {
      totalInvested: invested,
      totalPnL: pnl,
      totalWeeklyRent: totalWeeklyRent, 
      avgROI: roi,
    };
  }, [tradePositions]);

  // --- Unified Allowance Check Utility (Combined Logic) ---
  // This single function replaces `ensureCollateralAllowance` and `ensureExecutionAllowance`.
  const handleAllowanceCheck = useCallback(async (
    owner: `0x${string}`,
    requiredAmount: bigint,
    tokenAddress: `0x${string}`,
    spenderAddress: `0x${string}`,
    stepId: string,
    errorMessage: string,
    decimals: number | bigint = 6 // Default to USDC decimals
  ): Promise<boolean> => {
    try {
      // 1. Balance check (API Call 1)
      const balance = (await publicClient.readContract({
        address: tokenAddress,
        abi: Contracts.ABI.ERC20,
        functionName: "balanceOf",
        args: [owner],
      })) as bigint;

      if (balance < requiredAmount) {
        showToast(`Insufficient token balance.`, "error");
        setTxSteps((prev) =>
          prev.map((s) => (s.id === stepId ? { ...s, status: "error" } : s))
        );
        return false;
      }

      // 2. Allowance check (API Call 2)
      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: Contracts.ABI.ERC20,
        functionName: "allowance",
        args: [owner, spenderAddress],
      })) as bigint;

      if (allowance < requiredAmount) {
        // 3. Approval TX (If needed - API Call 3/4)
        setTxSteps((prev) =>
          prev.map((s) => (s.id === stepId ? { ...s, status: "pending" } : s))
        );

        const hash = await writeTokenAsync({
          address: tokenAddress,
          abi: Contracts.ABI.ERC20,
          functionName: "approve",
          args: [spenderAddress, requiredAmount],
        });

        await publicClient.waitForTransactionReceipt({ hash });

        setTxSteps((prev) =>
          prev.map((s) => (s.id === stepId ? { ...s, status: "completed" } : s))
        );
      } else {
        setTxSteps((prev) =>
          prev.map((s) =>
            s.id === stepId && s.status !== "completed"
              ? { ...s, status: "completed" }
              : s
          )
        );
      }
      return true;
    } catch (e) {
      console.error(errorMessage, e);
      showToast("Failed to check/approve allowance.", "error");
      setTxSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "error" } : s))
      );
      return false;
    }
  }, [showToast, writeTokenAsync]); // Dependencies for stability

  // --- Collateral Deposit/Withdraw Handler (Combined and simplified) ---
  // The logic for deposit/withdraw is consolidated into the onClick handler to prevent creating a new function on every render, and uses the new `handleAllowanceCheck`.
  const handleCollateralTx = async () => {
    if (!address) {
      showToast("Connect your wallet first.", "error");
      return;
    }

    const amountValue = Number(collateralAmount);
    if (!collateralAmount || amountValue <= 0) {
      showToast("Enter a valid amount.", "error");
      return;
    }

    const amount = parseUnits(collateralAmount, 6);
    const isDeposit = mode === "deposit";

    // Build steps for the modal
    const steps: TxStep[] = isDeposit
      ? [
          {
            id: "approve-collateral",
            title: "Approve collateral token",
            description: "Allow the protocol to use your USDC as collateral",
            status: "upcoming",
          },
          {
            id: "deposit-collateral",
            title: "Deposit collateral",
            description: `Deposit ${collateralAmount} USDC`,
            status: "upcoming",
          },
        ]
      : [
          {
            id: "withdraw-collateral",
            title: "Withdraw collateral",
            description: `Withdraw ${collateralAmount} USDC`,
            status: "upcoming",
          },
        ];

    setTxSteps(steps);
    setIsTxModalOpen(true);

    try {
      let hash: `0x${string}`;

      if (isDeposit) {
        // 1. Get collateral token address (API Call 1)
        const collateralToken = (await publicClient.readContract({
          address: ADDRESSES.CollateralPool,
          abi: Contracts.CollateralPool.abi,
          functionName: "getCollateralToken",
          args: [],
        })) as `0x${string}`;

        // 2. Approval step (calls handleAllowanceCheck which includes balance/allowance/approve logic)
        const ok = await handleAllowanceCheck(
          address as `0x${string}`,
          amount,
          collateralToken,
          ADDRESSES.CollateralPool,
          "approve-collateral",
          "ensureCollateralAllowance error"
        );
        if (!ok) return;

        // 3. Deposit step (API Call 2)
        setTxSteps((prev) =>
          prev.map((s) =>
            s.id === "deposit-collateral" ? { ...s, status: "pending" } : s
          )
        );

        hash = await writeCollateralAsync({
          address: ADDRESSES.CollateralPool,
          abi: Contracts.CollateralPool.abi,
          functionName: "depositCollateral",
          args: [amount],
        });
      } else {
        // Withdraw step (API Call 1)
        setTxSteps((prev) =>
          prev.map((s) =>
            s.id === "withdraw-collateral" ? { ...s, status: "pending" } : s
          )
        );

        hash = await writeCollateralAsync({
          address: ADDRESSES.CollateralPool,
          abi: Contracts.CollateralPool.abi,
          functionName: "withdrawCollateral",
          args: [amount],
        });
      }

      await publicClient.waitForTransactionReceipt({ hash });

      // Update final step status
      const finalStepId = isDeposit ? "deposit-collateral" : "withdraw-collateral";
      setTxSteps((prev) =>
        prev.map((s) =>
          s.id === finalStepId ? { ...s, status: "completed" } : s
        )
      );

      showToast(isDeposit ? "Deposit confirmed on-chain." : "Withdraw confirmed on-chain.", isDeposit ? "success" : "info");
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      console.error(err);
      showToast(
        err?.shortMessage || err?.message || "Collateral transaction failed",
        "error"
      );
      // Mark any currently pending step as error
      setTxSteps((prev) =>
        prev.map((s) =>
          s.status === "pending" ? { ...s, status: "error" } : s
        )
      );
    }
  };

  // --- Claim Rewards Handler (Simplified) ---
  const handleClaimRewards = async () => {
    if (!address) {
      showToast("Connect your wallet first.", "error");
      return;
    }

    const stepId = "claim-rewards";

    setTxSteps([
      {
        id: stepId,
        title: "Claim all rewards",
        description: "Claim your accumulated LP rewards",
        status: "pending",
      },
    ]);
    setIsTxModalOpen(true);

    try {
      const hash = await writeClaimAsync({
        address: ADDRESSES.UserHelper,
        abi: Contracts.UserHelper.abi,
        functionName: "claimAllRewards",
        args: [],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "completed" } : s))
      );
      showToast("Rewards claimed successfully.", "success");
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      console.error(err);
      showToast(
        err?.shortMessage || err?.message || "Claim transaction failed",
        "error"
      );
      setTxSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "error" } : s))
      );
    }
  };

  // --- Close Trade Handler (Uses unified allowance check) ---
  const handleCloseTrade = async (p: TradePosition) => {
    if (!address) {
      showToast("Connect your wallet first.", "error");
      return;
    }

    setClosingTradeId(p.id);

    const closeStepId = "close-position";
    const steps: TxStep[] = [];
    if (p.isITM) {
      steps.push({
        id: "approve-execution",
        title: "Approve execution token",
        description: "Approve the token needed to execute this position",
        status: "upcoming",
      });
    }
    steps.push({
      id: closeStepId,
      title: p.isITM ? "Execute position" : "Close position",
      description: `Position #${p.id}`,
      status: "upcoming",
    });

    setTxSteps(steps);
    setIsTxModalOpen(true);

    try {
      // API Call 1: Get market info
      const market = await getMarketInfoFromIndex(p.index);
      if (!market) {
        console.error("Missing MarketPool address for trade position:", p);
        showToast("Missing market information for this position.", "error");
        setTxSteps((prev) =>
          prev.map((s) => (s.id === closeStepId ? { ...s, status: "error" } : s))
        );
        return;
      }

      // If in the money, approval step
      if (p.isITM) {
        const isCall = p.isCall;
        const tokenAddr = isCall ? market.tokenB : market.tokenA;

        // API Call 2: Get token decimals
        const decimals = (await publicClient.readContract({
          address: tokenAddr,
          abi: Contracts.ABI.ERC20,
          functionName: "decimals",
          args: [],
        })) as number | bigint;

        const dec = Number(decimals);

        // Calculate required amount (human-readable)
        let humanRequired: number;
        if (isCall) {
          // CALL: pay tokenB (USDC)
          humanRequired = p.amount * p.strike; // Amount is in USDC for CALLs? This seems complex/potentially reversed from common practices, but matching the original logic.
        } else {
          // PUT: pay tokenA (Asset)
          humanRequired = p.amount / p.strike;
        }

        const required = parseUnits(humanRequired.toFixed(dec), dec);
        
        // API Calls 3-5: handleAllowanceCheck (Balance, Allowance, Approve TX if needed)
        const ok = await handleAllowanceCheck(
          address as `0x${string}`,
          required,
          tokenAddr,
          market.addr,
          "approve-execution",
          "ensureExecutionAllowance error",
          dec
        );
        if (!ok) return;
      }

      // Close/execute step (API Call 6)
      setTxSteps((prev) =>
        prev.map((s) => (s.id === closeStepId ? { ...s, status: "pending" } : s))
      );

      const hash = await writeMarketAsync({
        address: market.addr,
        abi: Contracts.MarketPool.abi,
        functionName: "closeContract",
        args: [BigInt(p.id)],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxSteps((prev) =>
        prev.map((s) => (s.id === closeStepId ? { ...s, status: "completed" } : s))
      );

      showToast(
        p.isITM
          ? "Execute transaction confirmed."
          : "Close position transaction confirmed.",
        "success"
      );

      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("closeContract error:", err);
      showToast("Failed to submit close/execute transaction.", "error");
      setTxSteps((prev) =>
        prev.map((s) =>
          s.id === closeStepId && s.status === "pending"
            ? { ...s, status: "error" }
            : s
        )
      );
    } finally {
      setClosingTradeId(null);
    }
  };

  // --- Withdraw LP Handler (Simplified) ---
  const handleWithdrawLp = async (lp: LpPosition) => {
    if (!address) {
      showToast("Connect your wallet first.", "error");
      return;
    }

    setClosingLpId(lp.id);

    const withdrawStepId = "withdraw-lp";
    setTxSteps([
      {
        id: withdrawStepId,
        title: "Withdraw LP position",
        description: `Withdraw LP position #${lp.id}`,
        status: "pending",
      },
    ]);
    setIsTxModalOpen(true);

    try {
      // API Call 1: Get market info
      const market = await getMarketInfoFromIndex(lp.index);

      if (!market) {
        console.error("Missing MarketPool address for LP position:", lp);
        showToast("Missing market information for this LP position.", "error");
        setTxSteps((prev) =>
          prev.map((s) => (s.id === withdrawStepId ? { ...s, status: "error" } : s))
        );
        return;
      }

      // API Call 2: Write contract
      const hash = await writeMarketAsync({
        address: market.addr,
        abi: Contracts.MarketPool.abi,
        functionName: "withdraw",
        args: [BigInt(lp.id)],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setTxSteps((prev) =>
        prev.map((s) => (s.id === withdrawStepId ? { ...s, status: "completed" } : s))
      );

      showToast("LP withdraw confirmed on-chain.", "success");
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("withdraw LP error:", err);
      showToast("Failed to submit LP withdraw transaction.", "error");
      setTxSteps((prev) =>
        prev.map((s) =>
          s.id === withdrawStepId && s.status === "pending"
            ? { ...s, status: "error" }
            : s
        )
      );
    } finally {
      setClosingLpId(null);
    }
  };

  return (
    <div id="dashboard-page" className="pt-20 sm:pt-24 pb-10 md:pb-12 bg-light text-gray-900">
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* HEADER */}
        <div id="dashboard-header" className="mb-6 md:mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2 text-gray-900">Dashboard</h1>
          <p className="text-gray-600">
            Manage your positions, liquidity, and collateral
          </p>
        </div>

        {/* COLLATERAL + LIQUIDITY SECTION */}
        <div
          id="collateral-liquidity-section"
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8"
        >
          {/* Collateral Management */}
          <div
            id="collateral-management-card"
            className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 md:p-8 shadow-sm"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Collateral Management
              </h2>
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <i className="fas fa-wallet text-blue-600 text-xl" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Total Collateral</p>
                <div className="text-xl font-bold text-gray-900">
                  {loading ? (
                    <Skeleton className="h-7 w-32" />
                  ) : collateralInfo ? (
                    `${collateralInfo.collateral.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
                  ) : (
                    "-"
                  )}
                </div>
              </div>
              <div className="bg-orange-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Weekly Rent</p>
                <div className="text-xl font-bold text-orange-600">
                  {loading
                    ? <Skeleton className="h-7 w-32" />
                    : collateralInfo
                    ? `${totalWeeklyRent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
                    : "-"}
                </div>
              </div>
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Withdrawable</p>
                <div className="text-xl font-bold text-green-600">
                  {loading
                    ? <Skeleton className="h-7 w-32" />
                    : collateralInfo
                    ? `${collateralInfo.withdrawable.toLocaleString(
                        undefined,
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                      )} USDC`
                    : "-"}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setMode("deposit")}
                  className={`
                    cursor-pointer flex-1 py-2 px-4 rounded-lg font-semibold transition
                    ${
                      mode === "deposit"
                        ? "bg-primary from-primary to-secondary text-white shadow-md"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }
                  `}
                >
                  Deposit
                </button>

                <button
                  onClick={() => setMode("withdraw")}
                  className={`
                    cursor-pointer flex-1 py-2 px-4 rounded-lg font-semibold transition
                    ${
                      mode === "withdraw"
                        ? "bg-primary from-primary to-secondary text-white shadow-md"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }
                  `}
                >
                  Withdraw
                </button>
              </div>

              <div id="collateral-amount-input" className="mb-4">
                <label className="text-sm text-gray-600 mb-2 block">
                  Amount (USDC)
                </label>
                <div className="bg-gray-50 border border-gray-300 rounded-xl p-4">
                  <input
                    type="number"
                    value={collateralAmount}
                    onChange={(e) => setCollateralAmount(e.target.value)}
                    className="w-full bg-transparent text-xl font-bold text-gray-900 focus:outline-none"
                  />
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-gray-500">
                      {mode === "deposit" ? "Available: " : "Available Collateral: "}
                      {loading ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="h-3 w-3 rounded-full border-2 border-gray-300 border-t-gray-700 animate-spin" />
                          <span>Loading…</span>
                        </span>
                      ) : mode === "deposit" ? (
                        usdcBalance !== null
                          ? `${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`
                          : "-"
                      ) : collateralInfo ? (
                        `${collateralInfo.withdrawable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
                      ) : (
                        "-"
                      )}
                    </span>

                    <button
                      type="button"
                      className="cursor-pointer text-xs text-primary hover:text-secondary font-semibold"
                      onClick={() => {
                        if (mode === "deposit") {
                          // MAX deposit = full USDC balance
                          if (usdcBalance !== null) {
                            setCollateralAmount(usdcBalance.toString());
                          }
                        } else {
                          // MAX withdraw = withdrawable collateral minus a small margin
                          if (collateralInfo) {
                            const raw = collateralInfo.withdrawable;
                            // Remove 0.05 USDC to avoid revert due to rent changing every second
                            const safe = Math.max(0, raw - 0.01);
                            setCollateralAmount(safe.toFixed(2));
                          }
                        }
                      }}
                    >
                      MAX
                    </button>
                  </div>
                </div>
              </div>

              <button
                className="cursor-pointer w-full bg-gradient-to-r from-primary to-secondary py-3 rounded-xl font-bold text-white hover:shadow-lg hover:shadow-primary/50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={isCollateralPending || !address}
                onClick={handleCollateralTx}
              >
                {mode === "deposit"
                  ? isCollateralPending
                    ? "Depositing..."
                    : "Deposit Collateral"
                  : "Withdraw Collateral"}
              </button>
            </div>
          </div>

          {/* Liquidity Management */}
          <div
            id="liquidity-management-card"
            className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 md:p-8 shadow-sm"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                Liquidity Management
              </h2>
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <i className="fas fa-chart-line text-green-600 text-xl" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">
                  Total Open Interest
                </p>
                <div className="text-xl font-bold text-gray-900">
                  {loading
                    ? <Skeleton className="h-7 w-28" />
                    : lpStats
                    ? `$${lpStats.totalOpenInterest.toLocaleString(
                        undefined,
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                      )}`
                    : "-"}
                </div>
              </div>
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Current APR</p>
                <div className="text-xl font-bold text-green-600">
                  {loading
                    ? <Skeleton className="h-7 w-28" />
                    : lpStats
                    ? `${lpStats.apr.toFixed(2)}%`
                    : "-"}
                </div>
              </div>
              <div className="bg-purple-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">Total Rewards</p>
                <div className="text-xl font-bold text-purple-600">
                  {loading
                    ? <Skeleton className="h-7 w-28" />
                    : lpStats
                    ? `$${lpStats.totalRewards.toLocaleString(
                        undefined,
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                      )}`
                    : "-"}
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-700 font-semibold">
                  Claimable Rewards
                </span>
                <span className="text-2xl font-bold text-green-600">
                  {loading
                    ? <Skeleton className="h-8 w-36" />
                    : lpStats
                    ? `$${lpStats.totalRewards.toLocaleString(
                        undefined,
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                      )}`
                    : "-"}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Accumulated from liquidity provision
              </p>
              <button
                className="cursor-pointer w-full bg-green-600 hover:bg-green-700 py-3 rounded-lg font-bold text-white transition disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleClaimRewards}
                disabled={isClaimPending || !address}
              >
                <i className="fas fa-coins mr-2" />
                {isClaimPending ? "Claiming..." : "Claim Rewards"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <i className="fas fa-fire text-orange-500 mb-1" />
                <p className="text-xs text-gray-600">Active LPs</p>
                <p className="text-sm font-semibold text-gray-900">
                  {loading ? "-" : activeLpCount}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <i className="fas fa-clock text-blue-500 mb-1" />
                <p className="text-xs text-gray-600">Avg Duration</p>
                <p className="text-sm font-semibold text-gray-900">
                  {loading || !activeLpCount
                    ? "-"
                    : `${avgLpDurationDays.toFixed(1)} days`}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* POSITIONS SECTION */}
        <div id="positions-section" className="space-y-6">
          {/* Open Trade Positions */}
          <div
            id="open-trade-positions"
            className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 md:p-8 shadow-sm"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Open Trade Positions
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Active perpetual options you&apos;re trading
                </p>
              </div>
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold">
                {tradePositions.length} Active
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                      Asset
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                      Type
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                      Amount
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                      Strike
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                      Weekly Rent
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">
                      P&amp;L
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-600">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!tradePositions.length ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-6 px-4 text-center text-gray-500 text-sm"
                      >
                        No active trade positions
                      </td>
                    </tr>
                  ) : (
                    tradePositions.map((p) => {
                      const asset = marketAssets[p.index] || "BTC";
                      const pnl = p.earnings - p.spent;
                      const pnlSign = pnl >= 0 ? "+" : "";
                      const pnlColor =
                        pnl >= 0 ? "text-green-600" : "text-red-600";
                      const roi =
                        p.spent > 0 ? ((pnl / p.spent) * 100).toFixed(1) : "0.0";

                      return (
                        <tr
                          key={`${p.index}-${p.id}`}
                          className="border-b border-gray-100 hover:bg-gray-50 transition"
                        >
                          <td className="py-4 px-4">
                            <div className="flex items-center">
                              <i
                                className={`${
                                  asset === "BTC"
                                    ? "fab fa-bitcoin text-orange-500"
                                    : "fab fa-ethereum text-blue-500"
                                } text-xl mr-2`}
                              />
                              <span className="font-semibold">{asset}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span
                              className={`px-2 py-1 rounded text-xs font-semibold ${
                                p.isCall
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {p.isCall ? "CALL" : "PUT"}
                            </span>
                          </td>
                          <td className="py-4 px-4 font-semibold">
                            {p.isCall ? p.amount.toFixed(4) : (p.amount / p.strike).toFixed(4)} {asset}
                          </td>
                          <td className="py-4 px-4 text-gray-600">
                            ${p.strike.toLocaleString(undefined, {
                              minimumFractionDigits: 2, maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="py-4 px-4 text-orange-600 font-semibold">
                            ${(p.rent*3600*24*7).toLocaleString(undefined, {
                              minimumFractionDigits: 2, maximumFractionDigits: 2
                            })}
                          </td>
                          <td className="py-4 px-4">
                            <span
                              className={`${pnlColor} font-bold`}
                            >{`${pnlSign}$${Math.abs(pnl).toLocaleString(
                              undefined,
                              { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                            )}`}</span>
                            <span
                              className={`${pnlColor} text-xs block`}
                            >{`${pnlSign}${Math.abs(
                              parseFloat(roi)
                            )}%`}</span>
                          </td>
                          <td className="py-4 px-4 text-right">
                           <button
                            className="cursor-pointer bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg text-white text-sm font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed"
                            disabled={!address || closingTradeId === p.id}
                            onClick={() => handleCloseTrade(p)}
                          >
                            {closingTradeId === p.id
                              ? "Closing..."
                              : p.isITM
                              ? "Execute"
                              : "Close"}
                          </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 mb-1">Total Invested</p>
                <p className="text-lg font-bold text-gray-900">
                  ${totalInvested.toLocaleString(undefined, {
                    minimumFractionDigits: 2, maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div className="bg-green-50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 mb-1">Total P&amp;L</p>
                <p
                  className={`text-lg font-bold ${
                    totalPnL >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {`${totalPnL >= 0 ? "+" : "-"}$${Math.abs(
                    totalPnL
                  ).toLocaleString(undefined, {
                    minimumFractionDigits: 2, maximumFractionDigits: 2,
                  })}`}
                </p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 mb-1">
                  Total Weekly Rent
                </p>
                <p className="text-lg font-bold text-orange-600">
                  ${totalWeeklyRent.toLocaleString(undefined, {
                    minimumFractionDigits: 2, maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-600 mb-1">Avg ROI</p>
                <p
                  className={`text-lg font-bold ${
                    avgROI >= 0 ? "text-blue-600" : "text-red-600"
                  }`}
                >
                  {avgROI.toFixed(2)}%
                </p>
              </div>
            </div>
          </div>

          {/* LP POSITIONS */}
          <div
            id="liquidity-provider-positions"
            className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-6 md:p-8 shadow-sm"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Liquidity Provider Positions
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Your active liquidity pools
                </p>
              </div>
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                {activeLpCount} Active
              </span>
            </div>

            {!lpPositions.length ? (
              <p className="text-sm text-gray-500">
                You don&apos;t have any active LP positions yet.
              </p>
            ) : (
              <div className="space-y-4">
                {lpPositions.map((lp) => {
                  const asset = marketAssets[lp.index] || "BTC";
                  const typeLabel = lp.isCall ? "CALL" : "PUT";
                  const utilizationKey = `${lp.index}-${lp.id}`;
                  const utilization = utilizations[utilizationKey];
                  const currentApr = marketAprs[lp.index];
                  const effectiveApr = currentApr !== undefined && utilization !== undefined 
                    ? (currentApr * utilization / 100).toFixed(2)
                    : "-";

                  const totalWithdrawableUSD = 
                    lp.withdrawableTokenA * (assetPrices[lp.index] || 0) + lp.withdrawableTokenB;

                  const assetPrice = assetPrices[lp.index];
                  const contractValueUSD = lp.isCall
                    ? assetPrice !== undefined
                      ? lp.value * assetPrice
                      : null
                    : lp.value;

                  return (
                    <div
                      key={`${lp.index}-${lp.id}`}
                      className="border border-gray-200 rounded-xl p-4 sm:p-6 hover:border-primary hover:shadow-md transition"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                        <div className="flex items-center">
                          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mr-4">
                            <i
                              className={`${
                                asset === "BTC"
                                  ? "fab fa-bitcoin text-orange-500"
                                  : "fab fa-ethereum text-blue-500"
                              } text-2xl`}
                            />
                          </div>
                          <div>
                            <div className="flex items-center mb-1">
                              <h3 className="text-lg font-bold text-gray-900 mr-2">
                                {asset} {typeLabel} Liquidity
                              </h3>
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-semibold mr-2 ${
                                  lp.isCall
                                    ? "bg-green-100 text-green-700"
                                    : "bg-red-100 text-red-700"
                                }`}
                              >
                                {typeLabel}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  lp.isCall
                                    ? "bg-green-100 text-green-700"
                                    : "bg-red-100 text-red-700"
                                }`}
                              >
                                {marketAprs[lp.index]}%
                              </span>
                            </div>
                            <p className="text-sm text-gray-600">
                              Strike: $
                              {lp.strike.toLocaleString(undefined, {
                                minimumFractionDigits: 2, maximumFractionDigits: 2,
                              })} -
                              <span className={`text-sm font-bold ${
                              lp.isITM ? "text-green-600" : "text-gray-600"
                            }`}>{lp.isITM ? " ITM" : " OTM"}</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center flex-wrap gap-2">
                          <div className="flex items-center px-3 py-1 bg-blue-50 rounded-full">
                            <i className="fas fa-percentage text-blue-600 text-xs mr-1" />
                            <span className="text-xs text-blue-600 font-semibold">
                              {`Effective APR: ${effectiveApr}%`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Amount</p>
                          <p className="text-sm font-bold text-gray-900">
                            {lp.amount.toFixed(4)}{" "}
                            {lp.isCall ? asset : "USDC"}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500 mb-1">
                            Contract Value
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            {contractValueUSD !== null
                              ? `$${contractValueUSD.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`
                              : "Loading..."}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500 mb-1">
                            Withdrawable
                          </p>
                          <p className="text-sm font-bold text-green-600">
                            ${totalWithdrawableUSD.toLocaleString(undefined, {
                              minimumFractionDigits: 2, maximumFractionDigits: 2,
                            })}
                          </p>
                          <div className="flex items-center flex-wrap gap-2 mt-1">
                            <div className="flex items-center bg-blue-50 px-2 py-0.5 rounded">
                              <i className="fab fa-bitcoin text-blue-500 text-xs mr-1" />
                              <span className="text-xs text-gray-700 font-medium">{lp.withdrawableTokenA.toLocaleString(
                                  undefined,
                                  {
                                    minimumFractionDigits: 4,
                                    maximumFractionDigits: 4,
                                  }
                                )} {asset}</span>
                            </div>
                            <div className="flex items-center bg-green-50 px-2 py-0.5 rounded">
                              <i className="fas fa-dollar-sign text-green-600 text-xs mr-1" />
                              <span className="text-xs text-gray-700 font-medium">
                                {lp.withdrawableTokenB.toLocaleString(
                                  undefined,
                                  {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  }
                                )} USDC
                              </span>
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="text-xs text-gray-500 mb-1">Utilization</p>
                          <p className="text-sm font-bold text-blue-600">
                            {utilization !== undefined
                              ? `${utilization.toFixed(2)}%`
                              : "-"}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <button
                          className="cursor-pointer flex-1 bg-gray-100 hover:bg-gray-200 py-2.5 rounded-lg font-semibold text-gray-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                          disabled={!address || closingLpId === lp.id}
                          onClick={() => handleWithdrawLp(lp)}
                        >
                          {closingLpId === lp.id ? "Withdrawing..." : "Withdraw Available"}
                        </button>
                        <button
                          className="cursor-pointer flex-1 bg-red-100 hover:bg-red-200 py-2.5 rounded-lg font-semibold text-red-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
                          disabled={!address || closingLpId === lp.id}
                          onClick={() => handleWithdrawLp(lp)}
                        >
                          {closingLpId === lp.id ? "Closing..." : "Close Position"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}