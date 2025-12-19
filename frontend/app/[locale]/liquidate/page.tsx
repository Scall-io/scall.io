"use client";

import { useEffect, useMemo, useState } from "react";
import { publicClient, ADDRESSES, Contracts } from "@/web3/contracts";
import SelectMenu, { type SelectMenuOption } from "@/app/components/SelectMenu";
import Toast from "@/app/components/Toast";
import { formatUnits, createWalletClient, custom } from "viem";
import { base } from "viem/chains";
import TransactionModal, { type TxStep } from "@/app/components/TransactionModal";
import InlineLoader from "@/app/components/InlineLoader";
import { Skeleton } from "@/app/components/Skeleton";


const WAD = 18;
const SECONDS_PER_WEEK = 60 * 60 * 24 * 7;

// Safer display (keeps precision reasonable for UI)
const wadToFloat = (v: bigint) => parseFloat(formatUnits(v, WAD));
const rentPerWeekWad = (rentPerSecondWad: bigint) =>
  (rentPerSecondWad * BigInt(SECONDS_PER_WEEK));

type ContractInfos = {
  index: bigint;
  owner: `0x${string}`;
  ID: bigint;
  asset: `0x${string}`;
  isCall: boolean;
  strike: bigint;
  amount: bigint;
  rent: bigint;
  start: bigint;
  isITM: boolean;
  totalRent: bigint;
  collateral: bigint;
  needLiquidation: boolean;
};

type ContractRow = {
  // Display
  market: number;              // market index (uint256)
  owner: string;               // owner address (0x...)
  contractId: string;          // display "#123"
  asset: string;               // symbol
  type: "Call" | "Put";
  strikeUsd: number;           // display-only
  amount: string;              // display-only
  rent: string;                // display-only
  startDate: string;           // display-only
  status: "ITM" | "OTM";
  totalRentUsd: number;        // display-only
  collateralUsd: number;       // display-only
  liquidatable: boolean;

  // Raw (for on-chain)
  rawOwner: `0x${string}`;
  rawMarketIndex: bigint;      // _index param for liquidateContract
  rawId: bigint;               // _id param for liquidateContract
  rawIsCall: boolean;
  rawIsITM: boolean;
  rawStrikeWad: bigint;        // 18-dec strike
  rawAmountWad: bigint;        // 18-dec amount as stored in contract infos
};

// Minimal formatting (adjust decimals later when you plug real price + token decimals)
const fmtDate = (ts: bigint) => new Date(Number(ts) * 1000).toISOString().slice(0, 10);

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

type SortKey =
  | "market"
  | "owner"
  | "contractId"
  | "asset"
  | "type"
  | "strikeUsd"
  | "amount"
  | "rent"
  | "startDate"
  | "status"
  | "totalRentUsd"
  | "collateralUsd"
  | "liquidatable";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatUsd2(n: number) {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function LiquidatePage() {
  // ----------------------------
  // UI loading (simulate fetch)
  // ----------------------------
  const [isLoading, setIsLoading] = useState(true);

  // Toast
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info" | "warning";
  } | null>(null);

  const showToast = (
    message: string,
    type: "success" | "error" | "info" | "warning" = "info"
  ) => setToast({ message, type });

  // ----------------------------
  // Mock data (replace later)
  // ----------------------------
  const [rows, setRows] = useState<ContractRow[]>([]);

  // ----------------------------
  // Filters
  // ----------------------------
  const [filterMarket, setFilterMarket] = useState<string>("");
  const [filterAsset, setFilterAsset] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterLiquidation, setFilterLiquidation] = useState<string>("");
  const [filterSearch, setFilterSearch] = useState<string>("");

  const resetFilters = () => {
    setFilterMarket("");
    setFilterAsset("");
    setFilterType("");
    setFilterStatus("");
    setFilterLiquidation("");
    setFilterSearch("");
    showToast("Filters reset.", "info");
  };

    const marketOptions: SelectMenuOption<string>[] = useMemo(() => {
        const markets = Array.from(new Set(rows.map((r) => r.market))).sort((a, b) => a - b);
        return [{ value: "", label: "All" }].concat(
            markets.map((m) => ({ value: String(m), label: `Index ${m}` }))
        );
    }, [rows]);

    const assetOptions: SelectMenuOption<string>[] = [
        { value: "", label: "All" },
        { value: "BTC", label: "BTC" },
        { value: "ETH", label: "ETH" },
    ];


  const typeOptions: SelectMenuOption<string>[] = useMemo(
    () => [
      { value: "", label: "All" },
      { value: "Call", label: "Call" },
      { value: "Put", label: "Put" },
    ],
    []
  );

  const statusOptions: SelectMenuOption<string>[] = useMemo(
    () => [
      { value: "", label: "All" },
      { value: "ITM", label: "ITM" },
      { value: "OTM", label: "OTM" },
    ],
    []
  );

  const liquidationOptions: SelectMenuOption<string>[] = useMemo(
    () => [
      { value: "", label: "All" },
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ],
    []
  );

  const filteredRows = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();

    return rows.filter((r) => {
      if (filterMarket && String(r.market) !== filterMarket) return false;
      if (filterAsset && r.asset !== filterAsset) return false;
      if (filterType && r.type !== filterType) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterLiquidation) {
        const want = filterLiquidation === "Yes";
        if (r.liquidatable !== want) return false;
      }
      if (q) {
        const hay = `${r.contractId} ${r.owner} ${r.asset} ${r.type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    rows,
    filterMarket,
    filterAsset,
    filterType,
    filterStatus,
    filterLiquidation,
    filterSearch,
  ]);

  // ----------------------------
  // Sorting
  // ----------------------------
  const [sortKey, setSortKey] = useState<SortKey>("liquidatable");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows];

    const get = (r: ContractRow) => {
      switch (sortKey) {
        case "market":
          return r.market;
        case "owner":
          return r.owner;
        case "contractId":
          return r.contractId;
        case "asset":
          return r.asset;
        case "type":
          return r.type;
        case "strikeUsd":
          return r.strikeUsd;
        case "amount":
          return r.amount;
        case "rent":
          return r.rent;
        case "startDate":
          return r.startDate;
        case "status":
          return r.status;
        case "totalRentUsd":
          return r.totalRentUsd;
        case "collateralUsd":
          return r.collateralUsd;
        case "liquidatable":
          return r.liquidatable ? 1 : 0;
        default:
          return 0;
      }
    };

    copy.sort((a, b) => {
      const av = get(a) as any;
      const bv = get(b) as any;

      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));

      return sortDir === "asc" ? cmp : -cmp;
    });

    // Always keep liquidatable on top as a UX default when sorting by something else:
    copy.sort((a, b) => Number(b.liquidatable) - Number(a.liquidatable));

    return copy;
  }, [filteredRows, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // ----------------------------
  // Pagination
  // ----------------------------
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [filterMarket, filterAsset, filterType, filterStatus, filterLiquidation, filterSearch]);

  const pageCount = useMemo(() => {
    return Math.max(1, Math.ceil(sortedRows.length / pageSize));
  }, [sortedRows.length, pageSize]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  // ----------------------------
  // Selection + Actions
  // ----------------------------
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const selectedCount = useMemo(
    () => Object.values(selectedIds).filter(Boolean).length,
    [selectedIds]
  );

  const allVisibleSelected = useMemo(() => {
    if (!pagedRows.length) return false;
    return pagedRows.every((r) => selectedIds[r.contractId]);
  }, [pagedRows, selectedIds]);

  const toggleSelectAllVisible = () => {
    const next = { ...selectedIds };
    const target = !allVisibleSelected;
    for (const r of pagedRows) next[r.contractId] = target;
    setSelectedIds(next);
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Liquidation modal (TransactionModal)
  const [txOpen, setTxOpen] = useState(false);
  const [txSteps, setTxSteps] = useState<TxStep[]>([]);
  const [txTarget, setTxTarget] = useState<ContractRow | null>(null);

  const updateStep = (id: string, patch: Partial<TxStep>) => {
    setTxSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const openLiquidate = (row: ContractRow) => {
    setTxTarget(row);
    setTxSteps([
      {
        id: "balance",
        title: "Check wallet balance",
        description: "Ensure you have enough funds to perform the liquidation",
        status: "pending",
      },
      {
        id: "approve",
        title: "Approve token (if needed)",
        description: "Allow the CollateralPool to spend the required token",
        status: "upcoming",
      },
      {
        id: "liquidate",
        title: "Liquidate contract",
        description: "Call liquidateContract on CollateralPool",
        status: "upcoming",
      },
    ]);
    setTxOpen(true);
    // kick off immediately
    void runLiquidationFlow(row);
  };

  const getWalletClient = async () => {
    const eth = (globalThis as any).ethereum;
    if (!eth) throw new Error("No wallet found. Please install / enable a web3 wallet.");
    return createWalletClient({ chain: base, transport: custom(eth) });
  };

  const pow10 = (n: number) => 10n ** BigInt(n);

  // Convert a WAD(18) amount to token native decimals (rounding up for safety).
  const wadToTokenUnits = (wad: bigint, tokenDecimals: number) => {
    if (tokenDecimals === 18) return wad;
    if (tokenDecimals < 18) {
      const d = 18 - tokenDecimals;
      const div = pow10(d);
      return (wad + div - 1n) / div; // ceil
    }
    const mul = pow10(tokenDecimals - 18);
    return wad * mul;
  };

  const runLiquidationFlow = async (row: ContractRow) => {
    try {
      // Step: balance check
      updateStep("balance", { status: "pending" });

      const walletClient = await getWalletClient();
      const [account] = await walletClient.getAddresses();
      if (!account) throw new Error("Wallet not connected.");

      // Determine required payment token + amount based on ITM rules
      // - ITM Call: pay amount * strike of tokenB (USDC) to receive tokenA
      // - ITM Put:  pay amount / strike of tokenA (cbBTC) to receive tokenB
      const WAD = 10n ** 18n;

      let payToken: `0x${string}` | null = null;
      let payAmountWad: bigint = 0n;

      if (row.rawIsITM) {
        if (row.rawIsCall) {
          payToken = ADDRESSES.USDC;
          payAmountWad = (row.rawAmountWad * row.rawStrikeWad) / WAD;
        } else {
          payToken = ADDRESSES.cbBTC;
          payAmountWad = (row.rawAmountWad * WAD) / row.rawStrikeWad;
        }
      }

      if (!payToken || payAmountWad === 0n) {
        // OTM liquidation should not require a payment; still allow liquidation.
        updateStep("approve", { status: "completed" });
      } else {
        // Read token decimals (fallback to 18 if it fails)
        let decimals = 18;
        try {
          decimals = (await publicClient.readContract({
            address: payToken,
            abi: Contracts.ABI.ERC20,
            functionName: "decimals",
          })) as number;
        } catch {}

        const payAmount = wadToTokenUnits(payAmountWad, decimals);

        // Check balance
        const bal = (await publicClient.readContract({
          address: payToken,
          abi: Contracts.ABI.ERC20,
          functionName: "balanceOf",
          args: [account],
        })) as bigint;

        if (bal < payAmount) {
          throw new Error(
            `Insufficient balance. Need ${formatUnits(payAmount, decimals)} tokens to liquidate.`
          );
        }

        updateStep("balance", { status: "completed" });

        // Step: approve if needed
        updateStep("approve", { status: "pending" });

        const allowance = (await publicClient.readContract({
          address: payToken,
          abi: Contracts.ABI.ERC20,
          functionName: "allowance",
          args: [account, ADDRESSES.CollateralPool],
        })) as bigint;

        if (allowance < payAmount) {
          const approveHash = await walletClient.writeContract({
            address: payToken,
            abi: Contracts.ABI.ERC20,
            functionName: "approve",
            args: [ADDRESSES.CollateralPool, payAmount],
            account,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        updateStep("approve", { status: "completed" });
      }

      // Step: liquidate
      updateStep("liquidate", { status: "pending" });

      const liqHash = await (await getWalletClient()).writeContract({
        address: ADDRESSES.CollateralPool,
        abi: Contracts.CollateralPool.abi,
        functionName: "liquidateContract",
        args: [row.rawOwner, row.rawMarketIndex, row.rawId],
        account,
      });

      await publicClient.waitForTransactionReceipt({ hash: liqHash });

      updateStep("liquidate", { status: "completed" });
      showToast(`Liquidation completed for ${row.contractId}.`, "success");

      // Optional: refresh list
      // (the existing loader depends on filterMarket; easiest is to re-run load by toggling isLoading or just keep as is)
    } catch (e: any) {
      console.error("Liquidation failed:", e);
      const msg = e?.shortMessage || e?.message || "Liquidation failed.";
      // mark current pending step as error
      setTxSteps((prev) =>
        prev.map((s) =>
          s.status === "pending" ? { ...s, status: "error", description: msg } : s
        )
      );
      showToast(msg, "error");
    }
  };

  const totalContracts = rows.length;
  const liquidatableCount = rows.filter((r) => r.liquidatable).length;

  useEffect(() => {
    const load = async () => {
        try {
        setIsLoading(true);

        // --------- IMPORTANT ----------
        // Depending on your ABI, this function may:
        // (A) take NO args: getMarketAllContractsInfos()
        // (B) take a market index arg: getMarketAllContractsInfos(uint256 marketIndex)
        //
        // Use the one that matches your ABI.
        // ------------------------------

        // Version A: no args
        const data = (await publicClient.readContract({
            address: ADDRESSES.ProtocolInfos,
            abi: Contracts.ProtocolInfos.abi,
            functionName: "getAllContractInfos",
        })) as ContractInfos[];

        // Map to your table model
        const mapped: ContractRow[] = await Promise.all(
            data.map(async (c) => {
                const strikeUsd = wadToFloat(c.strike); // 18-dec strike
                const WAD = 10n ** 18n;

                const amountWad = c.isCall
                  ? c.amount
                  : (c.amount * WAD) / c.strike;

                const amountHuman = formatUnits(amountWad, 18);


                const rentWeekWad = rentPerWeekWad(c.rent);
                const rentWeek = wadToFloat(rentWeekWad);

                const totalRentWeekWad = rentPerWeekWad(c.totalRent);
                const totalRentUsdWeek = wadToFloat(totalRentWeekWad);

                const collateralUsd = wadToFloat(c.collateral);

                const isBTC = c.asset.toLowerCase() === ADDRESSES.cbBTC.toLowerCase();
                const assetSymbol = isBTC ? "BTC" : "ETH";

                return {
                market: Number(c.index),
                owner: c.owner,
                contractId: `#${Number(c.ID)}`,
                asset: assetSymbol,
                type: c.isCall ? "Call" : "Put",
                strikeUsd,
                amount: `${Number(amountHuman).toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                })}`,
                rent: `${formatUsd2(rentWeek)}/week`,
                startDate: fmtDate(c.start),
                status: c.isITM ? "ITM" : "OTM",
                totalRentUsd: totalRentUsdWeek,
                collateralUsd,
                liquidatable: c.needLiquidation,

                rawOwner: c.owner,
                rawMarketIndex: c.index,
                rawId: c.ID,
                rawIsCall: c.isCall,
                rawIsITM: c.isITM,
                rawStrikeWad: c.strike,
                rawAmountWad: c.amount,
                };
            })
        );

        setRows(mapped);
        } catch (e) {
        console.error("Failed to load contracts:", e);
        setRows([]);
        } finally {
        setIsLoading(false);
        }
    };

    load();
    }, [filterMarket]);

  // ----------------------------
  // UI
  // ----------------------------
  return (
    
    <main className="pt-24 pb-12">
    <div className="mx-auto max-w-[1600px] px-6">
        {/* Header */}
        <div className="mb-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
            <h1 className="text-4xl font-bold text-gray-900">Liquidation Dashboard</h1>
            <p className="mt-2 text-gray-600">
                Monitor and liquidate undercollateralized perpetual option contracts
            </p>
            </div>

            <div className="flex flex-wrap items-center gap-4">
            <div className="rounded-xl border border-gray-200 bg-white px-6 py-3 shadow-sm">
                <p className="text-sm text-gray-600">Total Contracts</p>
                <div className="mt-1 text-2xl font-bold text-gray-900">
                  {isLoading ? <Skeleton className="h-7 w-16" /> : totalContracts}
                </div>
            </div>

            <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-3 shadow-sm">
                <p className="text-sm text-red-600">Liquidatable</p>
                <div className="mt-1 text-2xl font-bold text-red-600">
                  {isLoading ? <Skeleton className="h-7 w-16" /> : liquidatableCount}
                </div>
            </div>

            {selectedCount > 0 && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3">
                <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                    Selected
                </p>
                <p className="text-lg font-bold text-indigo-900">{selectedCount}</p>
                </div>
            )}
            </div>
        </div>
        </div>

        {/* Filters */}
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Filters</h2>
            <button
            onClick={resetFilters}
            className="text-sm font-semibold text-indigo-600 hover:text-violet-600"
            >
            <i className="fas fa-rotate-right mr-1" />
            Reset All
            </button>
        </div>

        {isLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                <Skeleton className="mb-2 h-3 w-20" />
                <Skeleton className="h-10 w-full rounded-lg" />
                </div>
            ))}
            </div>
        ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4 lg:grid-cols-6">
            <div>
                <label className="mb-1 block text-xs text-gray-600">Market Index</label>
                <SelectMenu
                value={filterMarket as any}
                options={marketOptions}
                onChange={(v) => setFilterMarket(String(v))}
                buttonClassName="w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                menuClassName="w-full left-0"
                />
            </div>

            <div>
                <label className="mb-1 block text-xs text-gray-600">Asset</label>
                <SelectMenu
                value={filterAsset as any}
                options={assetOptions}
                onChange={(v) => setFilterAsset(String(v))}
                buttonClassName="w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                menuClassName="w-full left-0"
                />
            </div>

            <div>
                <label className="mb-1 block text-xs text-gray-600">Type</label>
                <SelectMenu
                value={filterType as any}
                options={typeOptions}
                onChange={(v) => setFilterType(String(v))}
                buttonClassName="w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                menuClassName="w-full left-0"
                />
            </div>

            <div>
                <label className="mb-1 block text-xs text-gray-600">Status</label>
                <SelectMenu
                value={filterStatus as any}
                options={statusOptions}
                onChange={(v) => setFilterStatus(String(v))}
                buttonClassName="w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                menuClassName="w-full left-0"
                />
            </div>

            <div>
                <label className="mb-1 block text-xs text-gray-600">Liquidation</label>
                <SelectMenu
                value={filterLiquidation as any}
                options={liquidationOptions}
                onChange={(v) => setFilterLiquidation(String(v))}
                buttonClassName="w-full cursor-pointer rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                menuClassName="w-full left-0"
                />
            </div>

            <div>
                <label className="mb-1 block text-xs text-gray-600">Search</label>
                <input
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Contract ID, Owner…"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
            </div>
            </div>
        )}
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
            <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                    <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="cursor-pointer h-4 w-4 rounded border-gray-300"
                    disabled={isLoading || pagedRows.length === 0}
                    aria-label="Select all visible"
                    />
                </th>

                {[
                    ["market", "Market"],
                    ["owner", "Owner"],
                    ["contractId", "Contract ID"],
                    ["asset", "Asset"],
                    ["type", "Type"],
                    ["strikeUsd", "Strike"],
                    ["amount", "Amount"],
                    ["rent", "Rent"],
                    ["startDate", "Start Date"],
                    ["status", "Status"],
                    ["totalRentUsd", "Total Rent"],
                    ["collateralUsd", "Collateral"],
                    ["liquidatable", "Liquidation"],
                ].map(([key, label]) => (
                    <th
                    key={key}
                    className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600"
                    >
                    <button
                        onClick={() => toggleSort(key as SortKey)}
                        className="inline-flex items-center gap-2 hover:text-gray-900"
                    >
                        {label}
                        <i
                        className={`fas ${
                            sortKey === key
                            ? sortDir === "asc"
                                ? "fa-sort-up"
                                : "fa-sort-down"
                            : "fa-sort"
                        } text-[11px] text-gray-400`}
                        />
                    </button>
                    </th>
                ))}

                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Action
                </th>
                </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
                {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                        <Skeleton className="h-4 w-4 rounded" />
                    </td>
                    {Array.from({ length: 13 }).map((__, j) => (
                        <td key={j} className="px-4 py-4">
                        <Skeleton className="h-4 w-28" />
                        </td>
                    ))}
                    <td className="px-4 py-4">
                        <Skeleton className="h-9 w-28 rounded-lg" />
                    </td>
                    </tr>
                ))
                ) : pagedRows.length === 0 ? (
                <tr>
                    <td colSpan={15} className="px-6 py-10 text-center text-gray-500">
                    No contracts match your filters.
                    </td>
                </tr>
                ) : (
                pagedRows.map((r) => (
                    <tr
                    key={r.contractId}
                    className={`hover:bg-gray-50 transition ${
                        r.liquidatable ? "bg-red-50/30" : ""
                    }`}
                    >
                    <td className="px-4 py-4">
                        <input
                        type="checkbox"
                        checked={!!selectedIds[r.contractId]}
                        onChange={() => toggleSelectOne(r.contractId)}
                        className="cursor-pointer h-4 w-4 rounded border-gray-300"
                        aria-label={`Select ${r.contractId}`}
                        />
                    </td>

                    <td className="px-4 py-4 text-sm font-medium text-gray-900">{r.market}</td>

                    <td className="px-4 py-4 text-sm font-mono text-gray-600">
                        {shortAddr(r.owner)}
                    </td>

                    <td className="px-4 py-4 text-sm font-semibold text-indigo-600">
                        {r.contractId}
                    </td>

                    <td className="px-1 py-1">
                        <i
                          aria-label={r.asset}
                          title={r.asset}
                          className={`text-xl ${
                            r.asset === "BTC"
                              ? "fab fa-bitcoin text-orange-500"
                              : "fab fa-ethereum text-blue-500"
                          }`}
                        />
                        {" "+r.asset}
                    </td>

                    <td className="px-4 py-4">
                        <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                            r.type === "Call"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                        >
                        <i
                            className={`fas ${
                            r.type === "Call" ? "fa-arrow-up" : "fa-arrow-down"
                            } mr-1`}
                        />
                        {r.type}
                        </span>
                    </td>

                    <td className="px-4 py-4 text-sm font-semibold text-gray-900">
                        {formatUsd2(r.strikeUsd)}
                    </td>

                    <td className="px-4 py-4 text-sm font-semibold text-gray-900">{r.amount}</td>

                    <td className="px-4 py-4 text-sm text-gray-600">{r.rent}</td>

                    <td className="px-4 py-4 text-sm text-gray-600">{r.startDate}</td>

                    <td className="px-4 py-4">
                        <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                            r.status === "ITM"
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                        >
                        {r.status}
                        </span>
                    </td>

                    <td className="px-4 py-4 text-sm font-semibold text-gray-900">
                        {formatUsd2(r.totalRentUsd)}/week
                    </td>

                    <td className="px-4 py-4 text-sm font-semibold text-gray-900">
                        {formatUsd2(r.collateralUsd)}
                    </td>

                    <td className="px-4 py-4">
                        <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                            r.liquidatable
                            ? "bg-red-100 text-red-700"
                            : "bg-green-100 text-green-700"
                        }`}
                        >
                        <i
                            className={`fas ${
                            r.liquidatable ? "fa-triangle-exclamation" : "fa-check-circle"
                            } mr-1`}
                        />
                        {r.liquidatable ? "Yes" : "No"}
                        </span>
                    </td>

                    <td className="px-4 py-4">
                        {r.liquidatable ? (
                        <button
                            onClick={() => openLiquidate(r)}
                            className="cursor-pointer rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-600 hover:shadow-md"
                        >
                            Liquidate
                        </button>
                        ) : (
                        <button
                            disabled
                            className="cursor-not-allowed rounded-lg bg-gray-300 px-4 py-2 text-sm font-semibold text-gray-500"
                        >
                            Liquidate
                        </button>
                        )}
                    </td>
                    </tr>
                ))
                )}
            </tbody>
            </table>
        </div>

        {/* Footer controls */}
        <div className="flex flex-col gap-3 border-t border-gray-200 bg-white px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-gray-600">
            {isLoading ? (
                <span className="inline-flex items-center gap-2">
                <InlineLoader label="Loading contracts…" />
                </span>
            ) : (
                <>
                Showing{" "}
                <span className="font-semibold text-gray-900">
                    {pagedRows.length ? (page - 1) * pageSize + 1 : 0}
                </span>{" "}
                –{" "}
                <span className="font-semibold text-gray-900">
                    {(page - 1) * pageSize + pagedRows.length}
                </span>{" "}
                of <span className="font-semibold text-gray-900">{sortedRows.length}</span>
                </>
            )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Rows</span>
                <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm"
                disabled={isLoading}
                >
                {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                    {n}
                    </option>
                ))}
                </select>
            </div>

            <div className="flex items-center gap-2">
                <button
                onClick={() => setPage((p) => clamp(p - 1, 1, pageCount))}
                disabled={isLoading || page <= 1}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                Prev
                </button>

                <span className="text-sm text-gray-600">
                Page <span className="font-semibold text-gray-900">{page}</span> /{" "}
                <span className="font-semibold text-gray-900">{pageCount}</span>
                </span>

                <button
                onClick={() => setPage((p) => clamp(p + 1, 1, pageCount))}
                disabled={isLoading || page >= pageCount}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                Next
                </button>
            </div>
            </div>
        </div>
        </div>

        {/* Bulk action placeholder */}
        {!isLoading && selectedCount > 0 && (
        <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-indigo-900">
                <span className="font-bold">{selectedCount}</span> contract(s) selected.
                Bulk liquidation will be added when we connect on-chain.
            </p>
            <button
                onClick={() => showToast("Bulk liquidation not connected yet.", "info")}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
                Bulk Liquidate (soon)
            </button>
            </div>
        </div>
        )}
        </div>
        <TransactionModal
            isOpen={txOpen}
            steps={txSteps}
            onClose={() => setTxOpen(false)}
        />

        {toast && (
            <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
            />
        )}
    </main>
  );
}
