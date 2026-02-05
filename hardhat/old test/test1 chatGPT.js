import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";

const { viem, networkHelpers } = await hre.network.connect();

/**
 * Full protocol scenario test (structured like your existing tests)
 * - Initialization (deploy everything first, fund accounts, approvals)
 * - Call-side pro-rata withdrawal invariance
 * - Rewards accrual + claim accounting
 * - Put-side LR distribution
 * - Liquidation path
 */

describe("Scall :: Full protocol scenario", function () {
  let owner, addr1, addr2, addr3, liquidator;

  let main, collateralPool, marketPool, protocolInfos, userInfos;
  let fakeUSDC, fakeWBTC, fakeBtcOracle;

  const ORACLE_DECIMALS = 8n;
  const USDC_DECIMALS = 6n;
  const WBTC_DECIMALS = 8n;

  // -------------------------
  // Helpers
  // -------------------------

  async function setBtcPrice(priceE8, account = owner.account) {
    await fakeBtcOracle.write.setPrice([priceE8], { account });
    // sanity read (also refreshes updatedAt expectation)
    const p = await marketPool.read.getPrice();
    assert(p > 0n);
    return p;
  }

  async function elapse(seconds, priceE8) {
    await networkHelpers.mine(seconds);
    if (priceE8 !== undefined) {
      await setBtcPrice(priceE8);
    }
  }

  async function balA(addr) { return await fakeWBTC.read.balanceOf([addr]); } // TOKENA
  async function balB(addr) { return await fakeUSDC.read.balanceOf([addr]); } // TOKENB

  async function strikeForCallIndex(idx) {
    const intervals = await marketPool.read.getIntervals([]);
    // call strikes are second half (assuming interval length = 10)
    return intervals[Number(5n + BigInt(idx))];
  }

  async function strikeForPutIndex(idx) {
    const intervals = await marketPool.read.getIntervals([]);
    return intervals[Number(BigInt(idx))];
  }

  function fmt18(x) {
    return Number(x) / 1e18;
  }

  function fmt6(x) {
    return Number(x) / 1e6;
  }

  async function debugUser(userAddr, label = "") {
    const ui = await collateralPool.read.getUserInfos([userAddr]);
    const bal = await collateralPool.read.balanceOf([userAddr]);
    const liqThresh = await main.read.getLiquidationThreshold([]);

    const now = BigInt(await networkHelpers.time.latest());
    const delta = now - ui.lastUpdate;

    // Rent is per second → convert to per day
    const rentPerDay = ui.rent * 86400n;

    const accruedFees = ui.rent * delta;
    const balanceNeeded = ui.rent * liqThresh;

    console.log(`\n========== [DEBUG USER] ${label} ==========`);

    console.log("address            :", userAddr);
    console.log("time now (s)       :", now.toString());
    console.log("lastUpdate (s)     :", ui.lastUpdate.toString());
    console.log("elapsed (s)        :", delta.toString());
    console.log("elapsed (days)     :", Number(delta) / 86400);

    console.log("collateral (USDC)  :", fmt18(ui.collateral));
    console.log("balanceOf (USDC)  :", fmt18(bal));

    console.log("rent / sec (USDC)  :", fmt18(ui.rent));
    console.log("rent / day (USDC) :", fmt18(rentPerDay));

    console.log("accrued fees (USDC):", fmt18(accruedFees));

    console.log("liq threshold      :", liqThresh.toString());
    console.log("rent * threshold  :", fmt18(balanceNeeded));

    console.log(
      "needLiquidation ? :",
      balanceNeeded > bal ? "YES ❌" : "NO ✅"
    );

    console.log("==========================================\n");
  }



  // -------------------------
  // Initialization (deploy everything first)
  // -------------------------
  describe("Initialization", function () {
    it("Should initialize accounts", async function () {
      const accounts = await viem.getWalletClients();
      owner = accounts[0];
      addr1 = accounts[1];
      addr2 = accounts[2];
      addr3 = accounts[3];
      liquidator = accounts[4];
    });

    it("Should create fake tokens and fund accounts", async function () {
      fakeUSDC = await viem.deployContract("fakeToken", ["fakeUSDC", "fUSDC", Number(USDC_DECIMALS)]);
      fakeWBTC = await viem.deployContract("fakeToken", ["fakeWBTC", "fWBTC", Number(WBTC_DECIMALS)]);

      // Fund accounts with realistic decimals
      const usdcAmt = 50_000_000n * 10n ** USDC_DECIMALS;
      const wbtcAmt = 1_000n * 10n ** WBTC_DECIMALS;

      for (const a of [addr1, addr2, addr3, liquidator]) {
        await fakeUSDC.write.transfer([a.account.address, usdcAmt], { account: owner.account });
        await fakeWBTC.write.transfer([a.account.address, wbtcAmt], { account: owner.account });
      }
    });

    it("Should deploy fake oracle and set initial price", async function () {
      fakeBtcOracle = await viem.deployContract("fakeOracle", [], { client: { wallet: owner } });
      await fakeBtcOracle.write.setPrice([52_800n * 10n ** ORACLE_DECIMALS], { account: owner.account });
    });

    it("Should create core contracts", async function () {
      main = await viem.deployContract("Main", [fakeUSDC.address, Number(USDC_DECIMALS)], { client: { wallet: owner } });
      collateralPool = await viem.deployContract("CollateralPool", [fakeUSDC.address, Number(USDC_DECIMALS), main.address], { client: { wallet: owner } });
      protocolInfos = await viem.deployContract("ProtocolInfos", [main.address], { client: { wallet: owner } });
      userInfos = await viem.deployContract("UserInfos", [main.address], { client: { wallet: owner } });
    });

    it("Should initialize Main", async function () {
      await main.write.setCollateralPool([collateralPool.address], { account: owner.account });
    });

    it("Should create the market WBTC/USDC", async function () {
      marketPool = await viem.deployContract(
        "MarketPool",
        [
          main.address,
          fakeWBTC.address, Number(WBTC_DECIMALS),
          fakeUSDC.address, Number(USDC_DECIMALS),
          fakeBtcOracle.address, Number(ORACLE_DECIMALS),
          10,
          1000n * 10n ** 18n,
          20n * 10n ** 16n
        ],
        { client: { wallet: owner } }
      );
    });

    it("Should link market to Main", async function () {
      await main.write.linkMarket([marketPool.address], { account: owner.account });
    });

    it("Should do all approvals", async function () {
      const big = 2n ** 255n;
      for (const a of [owner, addr1, addr2, addr3, liquidator]) {
        await fakeUSDC.write.approve([collateralPool.address, big], { account: a.account });
        await fakeUSDC.write.approve([marketPool.address, big], { account: a.account });
        await fakeWBTC.write.approve([marketPool.address, big], { account: a.account });
      }

      // sanity read
      await marketPool.read.getPrice();
    });
  });

  // -------------------------
  // Scenarios
  // -------------------------
  describe("Scenarios", function () {
    it("Call-side: pro-rata withdraw is order-independent when callLR > 0", async function () {
      const callIdx = 1n;
      await setBtcPrice(52_800n * 10n ** ORACLE_DECIMALS); // deterministic intervals
      const strike = await strikeForCallIndex(callIdx);

      // Two LP deposits
      await marketPool.write.deposit([true, callIdx, 10n * 10n ** WBTC_DECIMALS], { account: owner.account }); // lpId 0
      await marketPool.write.deposit([true, callIdx, 10n * 10n ** WBTC_DECIMALS], { account: addr1.account }); // lpId 1

      // Collateral deposits
      await collateralPool.write.depositCollateral([2_000n * 10n ** USDC_DECIMALS], { account: addr2.account });

      // Open a call contract (contractId 0)
      await setBtcPrice(52_800n * 10n ** ORACLE_DECIMALS);
      await marketPool.write.openContract([true, callIdx, 5n * 10n ** WBTC_DECIMALS], { account: addr2.account });

      // ITM close -> callLR increases
      await setBtcPrice(((strike / 10n ** 18n) + 1000n) * 10n ** ORACLE_DECIMALS);
      await marketPool.write.closeContract([0n], { account: addr2.account });

      const sAfter = await marketPool.read.getStrikeInfos([strike]);
      assert(sAfter.callLR > 0n);

      // Withdraw order: owner then addr1
      const oA0 = await balA(owner.account.address);
      const oB0 = await balB(owner.account.address);
      const a1A0 = await balA(addr1.account.address);
      const a1B0 = await balB(addr1.account.address);

      await marketPool.write.withdraw([0n], { account: owner.account });
      await marketPool.write.withdraw([1n], { account: addr1.account });

      const oB = (await balB(owner.account.address)) - oB0;
      const a1B = (await balB(addr1.account.address)) - a1B0;

      assert(oB > 0n);
      assert(a1B > 0n);

      const diffB = oB > a1B ? oB - a1B : a1B - oB;
      assert(diffB <= 5n, `B distribution differs too much: diff=${diffB}`);
    });

    it("Rewards: accrue over time and can be claimed; pending decreases", async function () {
      const callIdx = 2n;
      await setBtcPrice(52_800n * 10n ** ORACLE_DECIMALS);
      const strike = await strikeForCallIndex(callIdx);

      // Deposit LP (lpId 2)
      await marketPool.write.deposit([true, callIdx, 10n * 10n ** WBTC_DECIMALS], { account: owner.account });

      // Trader opens a small contract so LU exists (contractId 1)
      await collateralPool.write.depositCollateral([2_000n * 10n ** USDC_DECIMALS], { account: addr3.account });
      await marketPool.write.openContract([true, callIdx, 1n * 10n ** WBTC_DECIMALS], { account: addr3.account });

      // Advance time and refresh oracle
      await elapse(172800, 52_800n * 10n ** ORACLE_DECIMALS);

      const marketId = await main.read.getMarketId([marketPool.address]);

      // Your CollateralPool functions take (marketId, lpId)
      const pending = await collateralPool.read.getRewardsForLp([marketId, 2n]);
      assert(pending > 0n);

      const usdc0 = await balB(owner.account.address);
      await collateralPool.write.claimRewards([marketId, 2n], { account: owner.account });
      const usdc1 = await balB(owner.account.address);
      assert(usdc1 > usdc0);

      const pendingAfter = await collateralPool.read.getRewardsForLp([marketId, 2n]);
      assert(pendingAfter <= pending);
    });

    it("Put-side: ITM close creates putLR and withdraw returns TokenA portion", async function () {
      const putIdx = 0n;
      await setBtcPrice(52_800n * 10n ** ORACLE_DECIMALS);
      const strike = await strikeForPutIndex(putIdx);

      // Two LP deposits (put) (lpId 3, 4)
      await marketPool.write.deposit([false, putIdx, 50_000n * 10n ** USDC_DECIMALS], { account: owner.account });
      await marketPool.write.deposit([false, putIdx, 50_000n * 10n ** USDC_DECIMALS], { account: addr1.account });

      // Trader opens put (contractId 2)
      await collateralPool.write.depositCollateral([5_000n * 10n ** USDC_DECIMALS], { account: addr2.account });
      await marketPool.write.openContract([false, putIdx, 10_000n * 10n ** USDC_DECIMALS], { account: addr2.account });

      // Move price down -> ITM put close increases putLR
      await setBtcPrice(40_000n * 10n ** ORACLE_DECIMALS);
      await marketPool.write.closeContract([2n], { account: addr2.account });

      const s = await marketPool.read.getStrikeInfos([strike]);
      assert(s.putLR > 0n);

      const wbtc0 = await balA(owner.account.address);
      await marketPool.write.withdraw([3n], { account: owner.account });
      const wbtc1 = await balA(owner.account.address);
      assert(wbtc1 > wbtc0);
    });

    it("Liquidation: after time, needLiquidation true and liquidate closes contract", async function () {
      const callIdx = 3n;
      await setBtcPrice(52_800n * 10n ** ORACLE_DECIMALS); // lock intervals
      const strike = await strikeForCallIndex(callIdx);

      // Provide ample liquidity at this strike (lpId 5)
      await marketPool.write.deposit([true, callIdx, 200n * 10n ** WBTC_DECIMALS], { account: owner.account });

      // Trader deposits collateral and opens contract (contractId 3)
      await collateralPool.write.depositCollateral([5_000n * 10n ** USDC_DECIMALS], { account: addr2.account });
      await marketPool.write.openContract([true, callIdx, 5n * 10n ** WBTC_DECIMALS], { account: addr2.account });

      await debugUser(addr2.account.address, "after openContract (before elapse)");

      // Advance time until liquidation condition triggers; refresh oracle to avoid staleness
      await elapse(76 * 24 * 3600, 52_800n * 10n ** ORACLE_DECIMALS);

      await debugUser(addr2.account.address, "after elapse");

      const need = await collateralPool.read.needLiquidation([addr2.account.address]);
      assert.equal(need, true);

      const liq0 = await balB(liquidator.account.address);
      const marketId = await main.read.getMarketId([marketPool.address]);

      await collateralPool.write.liquidateContract([marketId, 3n], { account: liquidator.account });

      const liq1 = await balB(liquidator.account.address);
      assert(liq1 > liq0);

      // Contract NFT should be burned: ownerOf should revert
      let reverted = false;
      try {
        const erc721 = await marketPool.read.getERC721_Contract([]);
        const c = await viem.getContractAt("ERC721_Contract", erc721);
        await c.read.ownerOf([3n]);
      } catch (e) {
        reverted = true;
      }
      assert.equal(reverted, true);
    });
  });
});
