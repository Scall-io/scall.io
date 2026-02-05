import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";

const { viem, networkHelpers } = await hre.network.connect();

/**
 * Scall :: Deep accounting & security test
 *
 * Goals:
 * 1) Rewards accounting must match trader rent accrual EXACTLY (within rounding).
 *    - total LP pending rewards ~= trader fees accrued over the same dt
 *    - pro-rata LP split must match liquidity shares
 *    - claiming rewards transfers the exact amount
 * 2) callLR / putLR withdrawal must be pro-rata and order-independent
 *    - verify expected TokenA/TokenB outputs against on-chain strike state
 * 3) Liquidation invariants sanity (optional / kept light)
 */

describe("Scall :: Deep accounting & security", function () {
  let owner, lp2, trader, trader2, liquidator;

  let main, collateralPool, marketPool, protocolInfos, userInfos;
  let fakeUSDC, fakeWBTC, fakeBtcOracle;

  // Contract params (must match deployment below)
  const ORACLE_DECIMALS = 8n;
  const USDC_DECIMALS = 6n;
  const WBTC_DECIMALS = 8n;

  const INTERVAL_LEN = 10n;
  const RANGE = 1000n * 10n ** 18n;       // passed to MarketPool
  const YIELD = 20n * 10n ** 16n;         // 0.20 (passed to MarketPool)
  const YEAR = 31536000n;

  const DUST_TOL = 1_000_000n
  const ACENT18 = 10_000_000_000_000_000n
  const ACENT6 = 10_000_000_000_000_000n

  // -------------------------
  // Decimal helpers
  // -------------------------
  const pow10 = (n) => 10n ** n;

  // 18-decimals -> token decimals
  const toUSDC = (x18) => (x18 * pow10(USDC_DECIMALS)) / 10n ** 18n;
  const toWBTC = (x18) => (x18 * pow10(WBTC_DECIMALS)) / 10n ** 18n;

  // token decimals -> 18
  const usdcTo18 = (x) => (x * 10n ** 18n) / pow10(USDC_DECIMALS);
  const wbtcTo18 = (x) => (x * 10n ** 18n) / pow10(WBTC_DECIMALS);

  // Human log (avoid BigInt->Number for huge amounts)
  const fmt = (x, decimals) => {
    const d = 10n ** BigInt(decimals);
    const int = x / d;
    const frac = x % d;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, Math.min(6, decimals));
    return `${int.toString()}.${fracStr}`;
  };

  // -------------------------
  // Helpers
  // -------------------------

  async function setBtcPrice(priceE8, account = owner.account) {
    await fakeBtcOracle.write.setPrice([priceE8], { account });
    // sanity read and avoid stale updatedAt
    const p = await marketPool.read.getPrice();
    assert(p > 0n);
    return p;
  }

  async function elapse(seconds, priceE8) {
    await networkHelpers.mine(seconds);
    if (priceE8 !== undefined) await setBtcPrice(priceE8);
  }

  async function balA(addr) { return await fakeWBTC.read.balanceOf([addr]); } // TOKENA
  async function balB(addr) { return await fakeUSDC.read.balanceOf([addr]); } // TOKENB

  async function strikeForCallIndex(idx) {
    const intervals = await marketPool.read.getIntervals([]);
    return intervals[Number((INTERVAL_LEN / 2n) + BigInt(idx))];
  }

  async function strikeForPutIndex(idx) {
    const intervals = await marketPool.read.getIntervals([]);
    return intervals[Number(BigInt(idx))];
  }

  async function getNow() {
    return BigInt(await networkHelpers.time.latest());
  }

  function approxEq(name, a, b, tol) {
    const diff = a > b ? a - b : b - a;
    assert(diff <= tol, `${name} not within tolerance. diff=${diff} a=${a} b=${b} tol=${tol}`);
  }

  // Compute expected call rent per second (18d) given amount18 and strike18
  function expectedCallRentPerSec(amount18, strike18) {
    // rent = ((((amount*strike)/1e18)*YIELD)/1e18)/YEAR
    const notional = (amount18 * strike18) / 10n ** 18n;
    const perYear = (notional * YIELD) / 10n ** 18n;
    return perYear / YEAR;
  }

  function expectedPutRentPerSec(amount18) {
    // rent = ((amount*YIELD)/1e18)/YEAR
    const perYear = (amount18 * YIELD) / 10n ** 18n;
    return perYear / YEAR;
  }

  // Given strike state + LP amount, compute expected withdrawal outputs (18d) in the LR branch.
  function expectedCallWithdrawLR({ callLR, callLP, callLU, strike18 }, lpAmount18) {
    const availableFunds = callLP - callLU; // 18d (TokenA)
    const liquidityReturnedAeq = (callLR * 10n ** 18n) / strike18; // 18d (TokenA-equivalent)
    const aFree = availableFunds - (liquidityReturnedAeq > availableFunds ? availableFunds : liquidityReturnedAeq);
    const w = lpAmount18 > availableFunds ? availableFunds : lpAmount18;
    const share = (w * 10n ** 18n) / availableFunds;

    const tokenB18 = (callLR * share) / 10n ** 18n;   // 18d TokenB
    const tokenA18 = (aFree * share) / 10n ** 18n;    // 18d TokenA
    return { tokenA18, tokenB18, w, share, availableFunds, aFree, liquidityReturnedAeq };
  }

  function expectedPutWithdrawLR({ putLR, putLP, putLU, strike18 }, lpAmount18) {
    const availableFunds = putLP - putLU; // 18d (TokenB)
    const liquidityReturnedBeq = (putLR * strike18) / 10n ** 18n; // 18d (TokenB-equivalent)
    const bFree = availableFunds - (liquidityReturnedBeq > availableFunds ? availableFunds : liquidityReturnedBeq);
    const w = lpAmount18 > availableFunds ? availableFunds : lpAmount18;
    const share = (w * 10n ** 18n) / availableFunds;

    const tokenA18 = (putLR * share) / 10n ** 18n; // 18d TokenA
    const tokenB18 = (bFree * share) / 10n ** 18n; // 18d TokenB
    return { tokenA18, tokenB18, w, share, availableFunds, bFree, liquidityReturnedBeq };
  }

  // -------------------------
  // Initialization
  // -------------------------
  describe("Initialization", function () {
    it("Accounts", async function () {
      const accounts = await viem.getWalletClients();
      owner = accounts[0];
      lp2 = accounts[1];
      trader = accounts[2];
      trader2 = accounts[3];
      liquidator = accounts[4];
    });

    it("Fake tokens + funding", async function () {
      fakeUSDC = await viem.deployContract("fakeToken", ["fakeUSDC", "fUSDC", Number(USDC_DECIMALS)]);
      fakeWBTC = await viem.deployContract("fakeToken", ["fakeWBTC", "fWBTC", Number(WBTC_DECIMALS)]);

      const usdcAmt = 50_000_000n * pow10(USDC_DECIMALS);
      const wbtcAmt = 1_000n * pow10(WBTC_DECIMALS);

      for (const a of [lp2, trader, trader2, liquidator]) {
        await fakeUSDC.write.transfer([a.account.address, usdcAmt], { account: owner.account });
        await fakeWBTC.write.transfer([a.account.address, wbtcAmt], { account: owner.account });
      }
    });

    it("Fake oracle", async function () {
      fakeBtcOracle = await viem.deployContract("fakeOracle", [], { client: { wallet: owner } });
      await fakeBtcOracle.write.setPrice([52_800n * 10n ** ORACLE_DECIMALS], { account: owner.account });
    });

    it("Core contracts", async function () {
      main = await viem.deployContract("Main", [fakeUSDC.address, Number(USDC_DECIMALS)], { client: { wallet: owner } });
      collateralPool = await viem.deployContract("CollateralPool", [fakeUSDC.address, Number(USDC_DECIMALS), main.address], { client: { wallet: owner } });
      protocolInfos = await viem.deployContract("ProtocolInfos", [main.address], { client: { wallet: owner } });
      userInfos = await viem.deployContract("UserInfos", [main.address], { client: { wallet: owner } });

      await main.write.setCollateralPool([collateralPool.address], { account: owner.account });

      marketPool = await viem.deployContract(
        "MarketPool",
        [
          main.address,
          fakeWBTC.address, Number(WBTC_DECIMALS),
          fakeUSDC.address, Number(USDC_DECIMALS),
          fakeBtcOracle.address, Number(ORACLE_DECIMALS),
          Number(INTERVAL_LEN),
          RANGE,
          YIELD
        ],
        { client: { wallet: owner } }
      );

      await main.write.linkMarket([marketPool.address], { account: owner.account });
    });

    it("Approvals", async function () {
      const big = 2n ** 255n;
      for (const a of [owner, lp2, trader, trader2, liquidator]) {
        await fakeUSDC.write.approve([collateralPool.address, big], { account: a.account });
        await fakeUSDC.write.approve([marketPool.address, big], { account: a.account });
        await fakeWBTC.write.approve([marketPool.address, big], { account: a.account });
      }
      await marketPool.read.getPrice();
    });
  });

  // -------------------------
  // Deep checks
  // -------------------------
  describe("Deep accounting checks", function () {
    it("Rewards (CALL): total LP rewards == trader fees accrued (exact formula)", async function () {
      // Lock intervals
      await setBtcPrice(52_800n * 10n ** ORACLE_DECIMALS);

      const callIdx = 1n;
      const strike18 = await strikeForCallIndex(callIdx);

      // Two LP deposits: equal shares
      const lpDepositWBTC = 10n * pow10(WBTC_DECIMALS);
      await marketPool.write.deposit([true, callIdx, lpDepositWBTC], { account: owner.account }); // lpId 0
      await marketPool.write.deposit([true, callIdx, lpDepositWBTC], { account: lp2.account });  // lpId 1

      // Trader collateral
      await collateralPool.write.depositCollateral([20_000n * pow10(USDC_DECIMALS)], { account: trader.account });

      // Open call contract: amount in WBTC decimals
      const openAmtWBTC = 5n * pow10(WBTC_DECIMALS);
      const openAmt18 = wbtcTo18(openAmtWBTC);

      const t0 = await getNow();
      await marketPool.write.openContract([true, callIdx, openAmtWBTC], { account: trader.account }); // contractId 0
      const t1 = await getNow();

      // Rent per second (18d) from on-chain formula
      const rentPerSec = expectedCallRentPerSec(openAmt18, strike18);
      assert(rentPerSec > 0n);

      // Elapse dt and refresh oracle to avoid staleness
      const dt = 200_000n; // ~2.3 days
      await elapse(Number(dt), 52_800n * 10n ** ORACLE_DECIMALS);

      // Fees accrued by trader according to CollateralPool (rent * elapsed since lastUpdate)
      const feesFromCP = await collateralPool.read.getUserFees([trader.account.address]); // 18d

      // Expected fees = rentPerSec * dt (note: lastUpdate is set at openContract timestamp)
      const expectedFees = rentPerSec * dt;

      // allow small drift because openContract may happen at t0/t1 and we then mined dt
      // We'll compare against feesFromCP which uses exact block.timestamp - lastUpdate.
      // We can bound with +/- rentPerSec*2 (few seconds).
      approxEq("CALL trader fees", feesFromCP, expectedFees, rentPerSec * 5n);

      // Total LP pending rewards before claim
      const r0 = await marketPool.read.getRewards([0n]);
      const r1 = await marketPool.read.getRewards([1n]);
      const totalRewards = r0 + r1;

      // Should match trader fees (within rounding)
      approxEq("CALL total LP rewards vs trader fees", totalRewards, feesFromCP, DUST_TOL); // tiny tolerance (acc per share rounding)

      // Each LP equal share => each gets ~50%
      approxEq("CALL LP split", r0, r1, DUST_TOL);

      // Claim rewards: verify actual USDC transferred equals pending (after protocol fee, currently 0)
      const marketId = await main.read.getMarketId([marketPool.address]);

      const ownerUSDC0 = await balB(owner.account.address);
      const lp2USDC0 = await balB(lp2.account.address);

      const claimed0 = await collateralPool.write.claimRewards([marketId, 0n], { account: owner.account });
      const claimed1 = await collateralPool.write.claimRewards([marketId, 1n], { account: lp2.account });

      const ownerUSDC1 = await balB(owner.account.address);
      const lp2USDC1 = await balB(lp2.account.address);

      // claimed returns collateral token decimals (USDC 6)
      const got0 = ownerUSDC1 - ownerUSDC0;
      const got1 = lp2USDC1 - lp2USDC0;

      approxEq("CALL claim amount LP0", got0, toUSDC(r0), DUST_TOL);
      approxEq("CALL claim amount LP1", got1, toUSDC(r1), DUST_TOL);

      // After claim, pending should be ~0
      const r0a = await marketPool.read.getRewards([0n]);
      const r1a = await marketPool.read.getRewards([1n]);
      
      assert(r0a <= ACENT18 && r1a <= ACENT18, `pending should be ~0, got r0=${r0a}, r1=${r1a}`);

      await marketPool.write.closeContract([0n], { account: trader.account });
    });

    it("Pro-rata withdrawal (CALL LR): expected TokenA/TokenB outputs match strike accounting; order-independent", async function () {
      // Lock intervals
      await setBtcPrice(52_800n * 10n ** ORACLE_DECIMALS);

      const callIdx = 2n;
      const strike18 = await strikeForCallIndex(callIdx);

      // LP deposits (equal)
      const lpDepositWBTC = 10n * pow10(WBTC_DECIMALS);
      await marketPool.write.deposit([true, callIdx, lpDepositWBTC], { account: owner.account }); // lpId 2
      await marketPool.write.deposit([true, callIdx, lpDepositWBTC], { account: lp2.account });  // lpId 3

      // Trader collateral and open
      await collateralPool.write.depositCollateral([50_000n * pow10(USDC_DECIMALS)], { account: trader2.account });
      const openAmtWBTC = 5n * pow10(WBTC_DECIMALS);
      await marketPool.write.openContract([true, callIdx, openAmtWBTC], { account: trader2.account }); // contractId 1

      // Make ITM and close to create callLR
      await setBtcPrice(((strike18 / 10n ** 18n) + 2000n) * 10n ** ORACLE_DECIMALS);
      await marketPool.write.closeContract([1n], { account: trader2.account });

      // Read strike infos for expected computation
      const s = await marketPool.read.getStrikeInfos([strike18]);
      assert(s.callLR > 0n);

      const state = { callLR: s.callLR, callLP: s.callLP, callLU: s.callLU, strike18 };

      // Expected for each LP: w = 10 WBTC (18d) = wbtcTo18(10e8)
      const lpAmount18 = wbtcTo18(lpDepositWBTC);

      const exp = expectedCallWithdrawLR(state, lpAmount18);

      // Withdraw order: lp2 first then owner (to catch race-condition)
      const lp2A0 = await balA(lp2.account.address);
      const lp2B0 = await balB(lp2.account.address);
      const ownerA0 = await balA(owner.account.address);
      const ownerB0 = await balB(owner.account.address);

      await marketPool.write.withdraw([3n], { account: lp2.account });  // first withdrawer
      await marketPool.write.withdraw([2n], { account: owner.account }); // second withdrawer

      const lp2A = (await balA(lp2.account.address)) - lp2A0;
      const lp2B = (await balB(lp2.account.address)) - lp2B0;
      const ownerA = (await balA(owner.account.address)) - ownerA0;
      const ownerB = (await balB(owner.account.address)) - ownerB0;

      // Convert expected 18d outputs to token decimals and compare
      const expA = toWBTC(exp.tokenA18);
      const expB = toUSDC(exp.tokenB18);

      approxEq("CALL LR lp2 TokenA", lp2A, expA, DUST_TOL);
      approxEq("CALL LR lp2 TokenB", lp2B, expB, DUST_TOL);
      approxEq("CALL LR owner TokenA", ownerA, expA, DUST_TOL);
      approxEq("CALL LR owner TokenB", ownerB, expB, DUST_TOL);
    });

    it("Rewards (PUT): total LP rewards == trader fees accrued (exact formula) + PutLR pro-rata withdraw outputs", async function () {
      await setBtcPrice(52_800n * 10n ** ORACLE_DECIMALS);

      const putIdx = 1n;
      const strike18 = await strikeForPutIndex(putIdx);

      // LP deposits put side (USDC)
      const lpDepositUSDC = 100_000n * pow10(USDC_DECIMALS);
      await marketPool.write.deposit([false, putIdx, lpDepositUSDC], { account: owner.account }); // lpId 4
      await marketPool.write.deposit([false, putIdx, lpDepositUSDC], { account: lp2.account });  // lpId 5

      // Trader collateral + open put
      await collateralPool.write.depositCollateral([200_000n * pow10(USDC_DECIMALS)], { account: trader.account });
      const openAmtUSDC = 40_000n * pow10(USDC_DECIMALS);
      const openAmt18 = usdcTo18(openAmtUSDC);

      await marketPool.write.openContract([false, putIdx, openAmtUSDC], { account: trader.account }); // contractId 2

      const rentPerSec = expectedPutRentPerSec(openAmt18);
      assert(rentPerSec > 0n);

      const dt = 150_000n;
      await elapse(Number(dt), 52_800n * 10n ** ORACLE_DECIMALS);

      const feesFromCP = await collateralPool.read.getUserFees([trader.account.address]);
      const expectedFees = rentPerSec * dt;
      console.log(feesFromCP);
      console.log(expectedFees);
      approxEq("PUT trader fees", feesFromCP, expectedFees, rentPerSec * 5n);

      // Total LP pending rewards
      const r4 = await marketPool.read.getRewards([4n]);
      const r5 = await marketPool.read.getRewards([5n]);
      const total = r4 + r5;
      approxEq("PUT total rewards vs trader fees", total, feesFromCP, DUST_TOL);
      approxEq("PUT LP split", r4, r5, 50n);

      // Now create PutLR by making price below strike and closing
      await setBtcPrice(30_000n * 10n ** ORACLE_DECIMALS);
      await marketPool.write.closeContract([2n], { account: trader.account });

      const s = await marketPool.read.getStrikeInfos([strike18]);
      assert(s.putLR > 0n);

      // Expected LR withdrawal outputs for each LP (full withdraw)
      const lpAmount18 = usdcTo18(lpDepositUSDC);

      console.log("putLP", s.putLP.toString());
      console.log("putLU", s.putLU.toString());
      console.log("putLR", s.putLR.toString());
      console.log("availableFunds", (s.putLP - s.putLU).toString());
      console.log("lpAmount18", lpAmount18.toString());
      const exp = expectedPutWithdrawLR({ putLR: s.putLR, putLP: s.putLP, putLU: s.putLU, strike18 }, lpAmount18);

      const r0 = await marketPool.read.getRewards([5n]);
      const r1 = await marketPool.read.getRewards([5n]);

      // Withdraw order reversed to catch race
      const ownerA0 = await balA(owner.account.address);
      const ownerB0 = await balB(owner.account.address);
      const lp2A0 = await balA(lp2.account.address);
      const lp2B0 = await balB(lp2.account.address);

      await marketPool.write.withdraw([5n], { account: lp2.account });  // first
      await marketPool.write.withdraw([4n], { account: owner.account }); // second

      const ownerA = (await balA(owner.account.address)) - ownerA0;
      const ownerB = (await balB(owner.account.address)) - ownerB0;
      const lp2A = (await balA(lp2.account.address)) - lp2A0;
      const lp2B = (await balB(lp2.account.address)) - lp2B0;

      const expA = toWBTC(exp.tokenA18);
      const expB = toUSDC(exp.tokenB18);

      approxEq("PUT LR lp2 TokenA", lp2A, expA, 2n);
      approxEq("PUT LR lp2 TokenB", lp2B, expB+toUSDC(r0), 2n);
      approxEq("PUT LR owner TokenA", ownerA, expA, 2n);
      approxEq("PUT LR owner TokenB", ownerB, expB+toUSDC(r1), 2n);
    });
  });
});
