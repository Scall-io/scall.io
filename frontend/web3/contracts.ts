"use client";

import { http, createPublicClient, getContract } from "viem";
import { base } from "viem/chains";

// ABIs
import MainABI from "./ABI/Main.json";
import MarketPoolABI from "./ABI/MarketPool.json";
import CollateralPoolABI from "./ABI/CollateralPool.json";
import ProtocolInfosABI from "./ABI/ProtocolInfos.json";
import UserInfosABI from "./ABI/UserInfos.json";
import UserHelperABI from "./ABI/UserHelper.json";
import ERC20_ABI from "./ABI/ERC20.json";
import ERC721_ABI from "./ABI/ERC721.json";
import AggregatorV3InterfaceABI from "./ABI/AggregatorV3Interface.json";

// RPC
const RPC_URL = process.env.NEXT_PUBLIC_BASE_RPC_URL as string;

export const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

// Addresses
export const ADDRESSES = {
  Main: "0x849d341edE8B40FfEA7E79C94e54b4c321118Ac9" as `0x${string}`,
  MarketcbBTC: "0x4c09fC5a31bbc41Bea5870d1B6D9c0aFA4f48967" as `0x${string}`,
  CollateralPool: "0xbBea3B2D6080c22f7B81f477a768D158e4671192" as `0x${string}`,
  ProtocolInfos: "0x407B6C681F1aA3781bd8Fe5db2c457a6910A8dA6" as `0x${string}`,
  UserInfos: "0x3be63b8a63f043C84A0b2f272F96cE928810A6C4" as `0x${string}`,
  UserHelper: "0x119570b354ECC09511e6676C5E330eaAf194aFFa" as `0x${string}`,
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as `0x${string}`,
};

// Export read-only contract instances
export const Contracts = {
  Main: getContract({
    address: ADDRESSES.Main,
    abi: MainABI,
    client: publicClient,
  }),

  MarketPool: getContract({
    address: ADDRESSES.MarketcbBTC,
    abi: MarketPoolABI,
    client: publicClient,
  }),

  MarketcbBTC: getContract({
    address: ADDRESSES.MarketcbBTC,
    abi: MarketPoolABI,
    client: publicClient,
  }),

  CollateralPool: getContract({
    address: ADDRESSES.CollateralPool,
    abi: CollateralPoolABI,
    client: publicClient,
  }),

  ProtocolInfos: getContract({
    address: ADDRESSES.ProtocolInfos,
    abi: ProtocolInfosABI,
    client: publicClient,
  }),

  UserInfos: getContract({
    address: ADDRESSES.UserInfos,
    abi: UserInfosABI,
    client: publicClient,
  }),

  UserHelper: getContract({
    address: ADDRESSES.UserHelper,
    abi: UserHelperABI,
    client: publicClient,
  }),

  // Generic ABIs
  ABI: {
    ERC20: ERC20_ABI,
    ERC721: ERC721_ABI,
    MarketPool: MarketPoolABI,
    AggregatorV3Interface: AggregatorV3InterfaceABI,
  },
};
