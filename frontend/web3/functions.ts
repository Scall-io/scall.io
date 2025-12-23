"use client";

import { formatUnits } from "viem";
import { publicClient, Contracts, ADDRESSES } from "./contracts";

// ========== PRICE ==========

export const getBtcPrice = async () => {
  try {
    const price = (await Contracts.MarketcbBTC.read.getPrice()) as bigint;
    return parseFloat(parseFloat(formatUnits(price, 18)).toFixed(2));
  } catch (e) {
    console.error("getBtcPrice error:", e);
    return null;
  }
};

export const getMarketAssetPrice = async (id: bigint) => {
  try {
    const price = (await publicClient.readContract({
      address: Contracts.ProtocolInfos.address,
      abi: Contracts.ProtocolInfos.abi,
      functionName: "getMarketAssetPrice",
      args: [id],
    })) as bigint;
    return parseFloat(parseFloat(formatUnits(price, 18)).toFixed(2));
  } catch (e) {
    console.error("AssetPrice error:", e);
    return null;
  }
};

// ========== ALLOWANCE ==========

export const getAllowance = async (
  tokenAddress: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`
) => {
  try {
    return (await publicClient.readContract({
      address: tokenAddress,
      abi: Contracts.ABI.ERC20,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;
  } catch (e) {
    console.error("getAllowance error:", e);
    return null;
  }
};

export const getUsdcBalance = async (
  address: `0x${string}`
): Promise<number | null> => {
  try {
    const balance = (await publicClient.readContract({
      address: ADDRESSES.USDC,
      abi: Contracts.ABI.ERC20,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;

    // USDC has 6 decimals on Base
    return parseFloat(formatUnits(balance, 6));
  } catch (e) {
    console.error("getUsdcBalance error:", e);
    return null;
  }
};


// ========== ERC721 ALLOWANCE ==========

export const getERC721Allowance = async (
  tokenAddress: `0x${string}`,
  id: bigint
) => {
  try {
    return (await publicClient.readContract({
      address: tokenAddress,
      abi: Contracts.ABI.ERC721,
      functionName: "getApproved",
      args: [id],
    })) as `0x${string}`;
  } catch (e) {
    console.error("getERC721Allowance error:", e);
    return null;
  }
};

// ========== STRIKES ==========

export const getStrike = async (isCall: boolean) => {
  try {
    const intervalLengthBig =
      (await Contracts.MarketcbBTC.read.getIntervalLength()) as bigint;
    const strikePrices =
      (await Contracts.MarketcbBTC.read.getIntervals()) as bigint[];

    const len = Number(intervalLengthBig);
    const half = len / 2;

    const selected =
      isCall
        ? strikePrices[half]
        : strikePrices[0];

    return { strikePrice: parseFloat(formatUnits(selected, 18)) };
  } catch (e) {
    console.error("getStrike error:", e);
    return null;
  }
};

// ========== STRIKES + LIQUIDITY ==========

export const getStrikesAndLiquidity = async (isCall: boolean) => {
  try {
    const intervalLengthBig =
      (await Contracts.MarketcbBTC.read.getIntervalLength()) as bigint;
    const strikePrices =
      (await Contracts.MarketcbBTC.read.getIntervals()) as bigint[];

    const len = Number(intervalLengthBig);
    const half = len / 2;

    const selectedStrikes = isCall
      ? strikePrices.slice(half, len)
      : strikePrices.slice(0, half);

    const liquidity = await Promise.all(
      selectedStrikes.map(async (strike) => {
        const info = (await Contracts.MarketcbBTC.read.getStrikeInfos([
          strike,
        ])) as any;

        const callLP = info.callLP as bigint;
        const callLU = info.callLU as bigint;
        const putLP = info.putLP as bigint;
        const putLU = info.putLU as bigint;

        return isCall ? callLP - callLU : putLP - putLU;
      })
    );

    const strikes: number[] = [];
    const liqs: number[] = [];

    liquidity.forEach((liq, idx) => {
      if (liq > 0) {
        strikes.push(parseFloat(formatUnits(selectedStrikes[idx], 18)));
        liqs.push(parseFloat(formatUnits(liq, 18)));
      }
    });

    if (strikes.length === 0) {
      strikes.push(parseFloat(formatUnits(selectedStrikes[0], 18)));
      liqs.push(parseFloat(formatUnits(liquidity[0], 18)));
    }

    return {
      strikePrices: strikes,
      availableLiquidity: liqs,
    };
  } catch (e) {
    console.error("getStrikesAndLiquidity error:", e);
    return null;
  }
};


// ========== LP Stats ==========

export const getLpStats = async (address: `0x${string}`) => {
  try {
    const [totalOI, totalRewards, estimatedYearly] = (await Promise.all([
      Contracts.UserInfos.read.getTotalOpenInterestForLP([address]),
      Contracts.UserInfos.read.getTotalRewardsForLP([address]),
      Contracts.UserInfos.read.getEstimatedYearlyEarningsForLP([address]),
    ])) as [bigint, bigint, bigint];

    const totalOpenInterest = parseFloat(formatUnits(totalOI, 18));
    const totalRewardsFormatted = parseFloat(formatUnits(totalRewards, 18));
    const estimatedYearlyEarnings = parseFloat(formatUnits(estimatedYearly, 18));

    const apr =
      totalOpenInterest > 0
        ? (estimatedYearlyEarnings / totalOpenInterest) * 100
        : 0;

    return {
      totalOpenInterest,
      totalRewards: totalRewardsFormatted,
      estimatedYearlyEarnings,
      apr,
    };
  } catch (error) {
    console.error("getLpStats error:", error);
    return null;
  }
};

// ===== Collateral info (CollateralPool.getUserInfos + balanceOf) =====

export type CollateralInfo = {
  collateral: number;
  rent: number;
  withdrawable: number;
};



export const getCollateralInfo = async (
    address: `0x${string}`
  ): Promise<CollateralInfo | null> => {
    try {
      // 1. Read user collateral/rent info
      const userInfo = (await Contracts.CollateralPool.read.getUserInfos([
        address,
      ])) as {
        collateral: bigint;
        rent: bigint;        // rent per second
        lastUpdate: bigint;
      };

      // 2. Read actual withdrawable balance from contract
      const balanceRaw = (await Contracts.CollateralPool.read.balanceOf([
        address,
      ])) as bigint;

      // 3. Read min collateral in seconds (from Main)
      const minCollRaw = (await Contracts.Main.read.getMinCollateral(
        []
      )) as bigint;

      const collateral = parseFloat(formatUnits(userInfo.collateral, 18));
      const rentPerSecond = parseFloat(formatUnits(userInfo.rent, 18)); // USDC/sec
      const balance = parseFloat(formatUnits(balanceRaw, 18)); // USDC
      const minCollateralSeconds = Number(minCollRaw);

      // 4. Required collateral = rentPerSecond * minCollateralSeconds
      const requiredCollateral = rentPerSecond * minCollateralSeconds;

      // 5. Withdrawable = balance – requiredCollateral
      let withdrawable = balance - requiredCollateral;

      if (withdrawable < 0) withdrawable = 0;

      return {
        collateral,
        rent: rentPerSecond,
        withdrawable,
      };
    } catch (e) {
      console.error("getCollateralInfo error:", e);
      return null;
    }
  };


// ===== LP positions (UserInfos.GetUserLps) =====

export type LpPosition = {
  index: number; // 0 = BTC, 1 = ETH
  id: number;
  isCall: boolean;
  strike: number;
  amount: number;
  start: number;
  lastClaim: number;
  isITM: boolean;
  value: number;
  withdrawableTokenA: number;
  withdrawableTokenB: number;
};

export const getLpPositions = async (
  address: `0x${string}`
): Promise<LpPosition[]> => {
  try {
    const lps = (await Contracts.UserInfos.read.GetUserLps([
      address,
    ])) as any[];

    return lps.map((lp) => ({
      index: Number(lp.index),
      id: Number(lp.ID),
      isCall: lp.isCall as boolean,
      strike: parseFloat(formatUnits(lp.strike, 18)),
      amount: parseFloat(formatUnits(lp.amount, 18)),
      start: Number(lp.start),
      lastClaim: Number(lp.lastClaim),
      isITM: lp.isITM as boolean,
      value: parseFloat(formatUnits(lp.value, 18)),
      withdrawableTokenA: parseFloat(
        formatUnits(lp.withdrawableTokenA, 18)
      ),
      withdrawableTokenB: parseFloat(
        formatUnits(lp.withdrawableTokenB, 18)
      ),
    }));
  } catch (e) {
    console.error("getLpPositions error:", e);
    return [];
  }
};

// ===== Trade positions (UserInfos.GetUserContractsForMarket) =====

export type TradePosition = {
  index: number; // market index in Main (0,1,2,...) - asset is resolved elsewhere
  id: number;
  isCall: boolean;
  strike: number;
  amount: number;
  rent: number;
  start: number;
  spent: number;
  isITM: boolean;
  earnings: number;
};

export const getTradePositions = async (
  address: `0x${string}`
): Promise<TradePosition[]> => {
  try {
    const trades = (await Contracts.UserInfos.read.getUserContracts([
      address,
    ])) as any[];

    return trades.map((trade) => ({
      index: Number(trade.index),
      id: Number(trade.ID),
      isCall: trade.isCall as boolean,
      strike: parseFloat(formatUnits(trade.strike, 18)),
      amount: parseFloat(formatUnits(trade.amount, 18)),
      rent: parseFloat(formatUnits(trade.rent, 18)),
      start: Number(trade.start),
      spent: parseFloat(formatUnits(trade.spent, 18)),
      isITM: trade.isITM as boolean,
      earnings: parseFloat(formatUnits(trade.earnings, 18)),
    }));
  } catch (e) {
    console.error("getTrades error:", e);
    return [];
  }
};
