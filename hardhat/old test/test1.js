import { describe, it } from "node:test";
import hre from "hardhat";

const { viem, networkHelpers } = await hre.network.connect();


/* global BigInt */

describe("Scall", function () {


  let USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
  let WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
  let WBTC = "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6";

  let owner;
  let addr1;
  let addr2;

  let Main;
  let main;

  let MarketPool;
  let marketPool;

  let protocolInfos;

  let userInfos

  let CollateralPool;
  let collateralPool;

  let fakeTokenContract;
  let fakeUSDC;
  let fakeWETH;
  let fakeWBTC;

  let FakeOracle;
  let fakeEthOracle;
  let fakeBtcOracle;

  let wethContract;
  let wbtcContract;
  let usdcContract;

  let rewardsClaimed = 0n;
  let feesClaimed;

  describe("Initialization", function() {

    it("Should initialize accounts", async function() {
      const accounts = await viem.getWalletClients();
      owner = accounts[0];
      addr1 = accounts[1];
      addr2 = accounts[2];

    });

    it("Should create fake tokens", async function() {
  
      fakeUSDC = await viem.deployContract("fakeToken", ["fakeUSDC", "fUSDC", 6]);
      fakeWETH = await viem.deployContract("fakeToken", ["fakeWETH", "fWETH", 18]);
      fakeWBTC = await viem.deployContract("fakeToken", ["fakeWBTC", "fWBTC", 8]);

      await fakeUSDC.write.transfer([addr1.account.address, BigInt(10000e18)],
        { account: owner.account }
      );
      await fakeWBTC.write.transfer([addr1.account.address, BigInt(10000e18)],
        { account: owner.account }
      );

      await fakeUSDC.write.transfer([addr2.account.address, BigInt(10000000e18)],
        { account: owner.account }
      );
      await fakeWBTC.write.transfer([addr2.account.address, BigInt(10000e18)],
        { account: owner.account }
      );
  
    })

    it("Should deploy Fakeoracles", async function() {
    
      fakeEthOracle = await viem.deployContract("fakeOracle", [], { client: { wallet: owner } });
      fakeBtcOracle = await viem.deployContract("fakeOracle", [], { client: { wallet: owner } });

      await fakeEthOracle.write.setPrice([BigInt(2200e8)]);
      await fakeBtcOracle.write.setPrice([BigInt(52800e8)]);
    
    })
    
    it("Should create contracts", async function() {

      main = await viem.deployContract( "Main", [fakeUSDC.address, 6], { client: { wallet: owner } });
      collateralPool = await viem.deployContract("CollateralPool", [fakeUSDC.address, 6, main.address], { client: { wallet: owner } });
      protocolInfos = await viem.deployContract("ProtocolInfos", [main.address], { client: { wallet: owner } });
      userInfos = await viem.deployContract("UserInfos", [main.address], { client: { wallet: owner } });
        
    })

    it("Should initialize Main", async function() {

      await main.write.setCollateralPool([collateralPool.address], { account: owner.account });
  
    })
      
    it("Should create the market WBTC/USDC", async function() {
  
      marketPool = await viem.deployContract(
        "MarketPool",
        [
          main.address,         // address of Main
          fakeWBTC.address,     // base token
          8,                    // base token decimals
          fakeUSDC.address,     // quote token
          6,                    // quote token decimals
          fakeBtcOracle.address,// oracle
          8,                    // oracle decimals
          10,                   // ? parameter
          1000n * 10n ** 18n,   // BigInt(1000e18)
          20n * 10n ** 16n      // BigInt(20e16)
        ],
        { client: { wallet: owner } }
      );
  
    })

    it("Should link market to Main", async function() {
  
      await main.write.linkMarket([marketPool.address], { account: owner.account });        
    })

    it("Should do all approvals", async function() {
  
      const bigAmount = 1_000_000_000n * 10n ** 18n;  // 1000000000e18

      //
      // Approvals from owner
      //
      await fakeUSDC.write.approve([collateralPool.address, bigAmount], { account: owner.account });
      await fakeUSDC.write.approve([marketPool.address, bigAmount], { account: owner.account });
      await fakeWBTC.write.approve([marketPool.address, bigAmount], { account: owner.account });

      //
      // Approvals from addr1
      //
      await fakeUSDC.write.approve([collateralPool.address, bigAmount], { account: addr1.account });
      await fakeUSDC.write.approve([marketPool.address, bigAmount], { account: addr1.account });
      await fakeWBTC.write.approve([marketPool.address, bigAmount], { account: addr1.account });

      //
      // Approvals from addr2
      //
      await fakeUSDC.write.approve([collateralPool.address, bigAmount], { account: addr2.account });
      await fakeUSDC.write.approve([marketPool.address, bigAmount], { account: addr2.account });
      await fakeWBTC.write.approve([marketPool.address, bigAmount], { account: addr2.account });
  
    })

  });

  describe("Test Functions", function () {

    it("Should give oracle prices", async function () {

      const price = await marketPool.read.getPrice();

      console.log(
        "Current price:",
        Number(price / 10n ** 18n)   // Convert BigInt to readable number
      );

    });

  });

  describe("LPs :: Check", function () {

    it("Should deposit call LP at correct interval for Owner", async function () {
      // READ intervals
      let intervals = await marketPool.read.getIntervals([]);
      console.log("Intervals:", intervals);

      const strikeValue = 54000n * 10n ** 18n;

      // READ strike info
      let strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("Before deposit (owner):", strikeInfo);

      // WRITE deposit
      await marketPool.write.deposit(
        [true, 0n, 4n * 10n ** 8n],     // [isCall, index, amount]
        { account: owner.account }
      );

      // READ again
      strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("After deposit (owner):", strikeInfo);

    });

    it("Should deposit call LP at correct interval for addr2", async function () {

      const strikeValue = 54000n * 10n ** 18n;

      // READ strike info
      let strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("Before deposit (addr2):", strikeInfo);

      // WRITE deposit (addr2)
      await marketPool.write.deposit(
        [true, 0n, 3n * 10n ** 8n],
        { account: addr2.account }
      );

      // READ again
      strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("After deposit (addr2):", strikeInfo);

    });

  });

  describe("Trades :: Check", function () {

    it("Should deposit collateral for addr1", async function () {
      let userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos Before (addr1):", userInfo);

      await collateralPool.write.depositCollateral(
        [1500n * 10n ** 6n],          // 1500e6
        { account: addr1.account }
      );

      userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos After (addr1):", userInfo);
    });

    it("Should open a trade for addr1", async function () {
      const strikeValue = 54000n * 10n ** 18n;  // 54000 * 1e18

      let strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos Before:", strikeInfo);

      await marketPool.write.openContract(
        [true, 0, 5n * 10n ** 8n],       // true, 5e8
        { account: addr1.account }
      );

      strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos After:", strikeInfo);

      const userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos After (addr1):", userInfo);
    });

  });

  //
  // TIME
  //
  describe("Time :: Change", function () {

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(259200);
      console.log("...3 days");
    });

  });


  //
  // LP CHECK
  //
  describe("LPs :: Check 11111111111111", function () {

    it("Should give user rewards", async function () {

      let rewards = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(rewards / 10n ** 18n));

      rewards = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(rewards / 10n ** 18n));

    });

    it("Should give addr1 fees", async function () {

      const fees = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC:", Number(fees / 10n ** 18n));

    });

  });


  //
  // DASHBOARD TESTS
  //
  describe("Trades :: Check Dashboard", function () {

    it("Should give market's total OI", async function () {
      const tx = await protocolInfos.read.getMarketOpenInterest([0n]);
      console.log(tx);
    });

    it("Should give market's total Liquidity Provided", async function () {
      const tx = await protocolInfos.read.getMarketLiquidityProvided([0n]);
      console.log(tx);
    });

    it("Should give market's available liquidation", async function () {
      const tx = await protocolInfos.read.getMarketAvailableLiquidation([0n]);
      console.log(tx);
    });

  });


  //
  // TRADES CHECK
  //
  describe("Trades :: Check", function () {

    it("Should give addr1 fees", async function () {
      const fees = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC:", Number(fees / 10n ** 18n));
    });

    it("Should give addr1 balance", async function () {
      const balance = await collateralPool.read.balanceOf([addr1.account.address]);
      console.log("Trader collateral balance USDC:", Number(balance / 10n ** 18n));
    });

    it("Should say if need to liquidate addr1", async function () {
      const needLiq = await collateralPool.read.needLiquidation([addr1.account.address]);
      console.log("Trader need liquidation:", needLiq);
    });

    it("Should deposit collateral for addr1", async function () {
      let userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("Before:", userInfo);

      await collateralPool.write.depositCollateral(
        [1000n * 10n ** 6n],
        { account: addr1.account }
      );

      userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("After:", userInfo);
    });

    it("Should give addr1 balance", async function () {
      const balance = await collateralPool.read.balanceOf([addr1.account.address]);
      console.log("Trader balance USDC:", Number(balance / 10n ** 18n));
    });

  });

  describe("LPs :: Check 222222222222222", function () {

    it("Should give user rewards", async function () {

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });

  describe("LPs :: Check", function () {

    it("Should claim fees for addr2", async function () {

      // GET rewards first
      const tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));

      // balance before
      const balanceBefore = await fakeUSDC.read.balanceOf([addr2.account.address]);

      // claim (Viem write)
      await collateralPool.write.claimRewards(
        [0n, 1n, 0n],
        { account: addr2.account }
      );

      // balance after
      const balanceAfter = await fakeUSDC.read.balanceOf([addr2.account.address]);

      console.log(
        "Claimed:",
        Number((balanceAfter - balanceBefore) / 10n ** 6n)
      );


      rewardsClaimed = tx;  // store BigInt reward
    });

  });

  describe("LPs :: Check 3333333333333333", function () {

    it("Should give user rewards again", async function () {

      console.log(
        "Total Rewards Claimed :", Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));

    });

    it("Should give addr1 fees", async function () {
      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });

  //
  // TRADES CHECK
  //
  describe("Trades :: Check", function () {

    it("Should open a trade for addr1", async function () {

      const strikeValue = 54000n * 10n ** 18n;

      let tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos Before:", tx);

      // store previous fees
      const fees = await collateralPool.read.getUserFees([addr1.account.address]);
      feesClaimed = fees;

      // open contract for addr1 (Viem write)
      await marketPool.write.openContract(
        [true, 0, 2n * 10n ** 8n],      // [isCall, index, size]
        { account: addr1.account }
      );

      tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos After:", tx);

      tx = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos After:", tx);
    });

  });


  //
  // LP CHECK – AFTER TRADE
  //
  describe("LPs :: Check 444444444444444444", function () {

    it("Should give user rewards", async function () {

      console.log("Total Rewards Claimed:", Number(rewardsClaimed / 10n ** 18n));

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner:", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2:", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {

      console.log("Total Fees Claimed:", Number(feesClaimed / 10n ** 18n));

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC:", Number(tx / 10n ** 18n));
    });

  });


  //
  // TIME ADVANCE
  //
  describe("Time :: Change", function () {

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(259200);
      console.log("...3 days");
    });

  });


  //
  // TRADES CHECK AGAIN
  //
  describe("Trades :: Check 55555555555555555", function () {

    it("Should give user rewards", async function () {

      console.log("Total Rewards Claimed:", Number(rewardsClaimed / 10n ** 18n));

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner:", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2:", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {

      console.log("Total Fees Claimed:", Number(feesClaimed / 10n ** 18n));

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC:", Number(tx / 10n ** 18n));
    });

  });

  describe("LPs :: Check", function () {

    it("Should claim fees for owner", async function () {
      const tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner:", Number(tx / 10n ** 18n));
      rewardsClaimed += tx;

      const balanceAV = await fakeUSDC.read.balanceOf([owner.account.address]);
      await collateralPool.write.claimRewards(
        [0n, 0n, 0n],
        { account: owner.account }
      );
      const balanceAP = await fakeUSDC.read.balanceOf([owner.account.address]);

      console.log(
        "Claimed (owner, USDC):",
        Number((balanceAP - balanceAV) / 10n ** 6n)
      );
    });

    it("Should claim fees for addr2", async function () {
      const tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2:", Number(tx / 10n ** 18n));
      rewardsClaimed += tx;

      const balanceAV = await fakeUSDC.read.balanceOf([addr2.account.address]);
      await collateralPool.write.claimRewards(
        [0n, 1n, 0n],
        { account: addr2.account }
      );
      const balanceAP = await fakeUSDC.read.balanceOf([addr2.account.address]);

      console.log(
        "Claimed (addr2, USDC):",
        Number((balanceAP - balanceAV) / 10n ** 6n)
      );
    });

  });

  describe("Trades :: Check 6666666666666", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed:",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner:", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2:", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed:",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC:", Number(tx / 10n ** 18n));
    });

  });

  describe("Time :: Change", function () {

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(86400);
      console.log("...1 day");
    });

  });

  describe("Trades :: Check", function () {

    it("Should give addr1 fees", async function () {
      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC:", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 balance", async function () {
      const tx = await collateralPool.read.balanceOf([addr1.account.address]);
      console.log("Trader balance USDC:", Number(tx / 10n ** 18n));
    });

    it("Should say if need to liquidate addr1", async function () {
      const tx = await collateralPool.read.needLiquidation([addr1.account.address]);
      console.log("Trader need liquidation:", tx);
    });

    it("Should deposit collateral for addr1", async function () {
      let info = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("Before:", info);

      await collateralPool.write.depositCollateral(
        [1000n * 10n ** 6n],           // 1000e6
        { account: addr1.account }
      );

      info = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("After:", info);
    });

    it("Should give addr1 balance", async function () {
      const tx = await collateralPool.read.balanceOf([addr1.account.address]);
      console.log("Trader balance USDC:", Number(tx / 10n ** 18n));
    });

  });

  //
  // TRADES :: CHECK (FIRST PART)
  //
  describe("Trades :: Check 77777777777777777", function () {

    it("Should give user rewards", async function () {

      console.log("Total Rewards Claimed :", Number(rewardsClaimed / 10n ** 18n));

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {

      console.log("Total Fees Claimed :", Number(feesClaimed / 10n ** 18n));

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  //
  // ORACLES :: PRICES MOVE
  //
  describe("Oracles :: Prices moove", function () {

    it("should moove the prices", async function () {

      // Update oracle (Viem write)
      await fakeBtcOracle.write.setPrice(
        [58200n * 10n ** 8n],        // 58200e8
        { account: owner.account }
      );

      const price = await marketPool.read.getPrice();
      console.log("Current price:", Number(price / 10n ** 18n));
    });

  });


  //
  // LPs :: CLAIM FEES
  //
  describe("LPs :: Check", function () {

    it("Should claim fees for owner", async function () {

      const tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));
      rewardsClaimed += tx;

      const balanceAV = await fakeUSDC.read.balanceOf([owner.account.address]);

      await collateralPool.write.claimRewards(
        [0n, 0n, 0n],
        { account: owner.account }
      );

      const balanceAP = await fakeUSDC.read.balanceOf([owner.account.address]);

      console.log(
        "USDC claimed (owner):",
        Number((balanceAP - balanceAV) / 10n ** 6n)
      );
    });

    it("Should claim fees for addr2", async function () {

      const tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
      rewardsClaimed += tx;

      const balanceAV = await fakeUSDC.read.balanceOf([addr2.account.address]);

      await collateralPool.write.claimRewards(
        [0n, 1n, 0n],
        { account: addr2.account }
      );

      const balanceAP = await fakeUSDC.read.balanceOf([addr2.account.address]);

      console.log(
        "USDC claimed (addr2):",
        Number((balanceAP - balanceAV) / 10n ** 6n)
      );
    });

  });


  //
  // FINAL CHECK
  //
  describe("Trades :: Check aaaaaaaaaaaaa", function () {

    it("Should give user rewards", async function () {

      console.log("Total Rewards Claimed :", Number(rewardsClaimed / 10n ** 18n));

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {

      console.log("Total Fees Claimed :", Number(feesClaimed / 10n ** 18n));

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  describe("Trades :: Check", function () {

    it("Should exercise contract 1", async function () {
      const balanceBTCAV = await fakeWBTC.read.balanceOf([addr1.account.address]);
      const balanceUSDCAV = await fakeUSDC.read.balanceOf([addr1.account.address]);

      let tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Fees claimed :", Number(tx / 10n ** 18n));
      feesClaimed += tx;

      await marketPool.write.closeContract(
        [0n],
        { account: addr1.account }
      );

      const balanceBTCAP = await fakeWBTC.read.balanceOf([addr1.account.address]);
      const balanceUSDCAP = await fakeUSDC.read.balanceOf([addr1.account.address]);

      console.log(
        "Balance WBTC change:",
        Number((balanceBTCAP - balanceBTCAV) / 10n ** 8n)
      );
      console.log(
        "Balance USDC change:",
        Number((balanceUSDCAP - balanceUSDCAV) / 10n ** 6n)
      );
    });

  });


  describe("Trades :: Check 888888888888888", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("Trades :: Check 999999999999999", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });

  describe("Time :: Change", function () {

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(86400);
      console.log("...1 days");
    });

  });


  describe("Trades :: Check", function () {

    it("Should give addr1 fees", async function () {
      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 balance", async function () {
      const tx = await collateralPool.read.balanceOf([addr1.account.address]);
      console.log("Trader balance USDC :", Number(tx / 10n ** 18n));
    });

    it("Should say if need to liquidiate addr1", async function () {
      const tx = await collateralPool.read.needLiquidation([addr1.account.address]);
      console.log("Trader need liquidation :", tx);
    });

    it("Should deposit collateral for addr1", async function () {
      let tx = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("Before:", tx);

      await collateralPool.write.depositCollateral(
        [3000n * 10n ** 6n],
        { account: addr1.account }
      );

      tx = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("After:", tx);
    });

    it("Should give addr1 balance", async function () {
      const tx = await collateralPool.read.balanceOf([addr1.account.address]);
      console.log("Trader balance USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("Trades :: Check 10101010101010101010", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("Trades :: Check Dashboard", function () {

    it("Should give market's total OI", async function () {
      const tx = await protocolInfos.read.getMarketOpenInterest([0n]);
      console.log(tx);
    });

    it("Should give market's total Liquidity Provided", async function () {
      const tx = await protocolInfos.read.getMarketLiquidityProvided([0n]);
      console.log(tx);
    });

    it("Should give market's available liquidation", async function () {
      const tx = await protocolInfos.read.getMarketAvailableLiquidation([0n]);
      console.log(tx);
    });

    it("Should give market's owner LP infos", async function () {
      const tx = await userInfos.read.getUserLpInfosForMarket(
        [0n, owner.account.address]
      );
      console.log(tx);
    });

    it("Should give market's addr2 LP infos", async function () {
      const tx = await userInfos.read.getUserLpInfosForMarket(
        [0n, addr2.account.address]
      );
      console.log(tx);
    });

  });


  describe("LPs :: Check", function () {

    it("Should withdraw call LP for Owner", async function () {
      const strikeValue = 54000n * 10n ** 18n;

      let tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("Before withdraw:", tx);

      await marketPool.write.withdraw(
        [0n],
        { account: owner.account }
      );

      tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("After withdraw:", tx);

      rewardsClaimed += 33n * 10n ** 18n;
    });

  });

  describe("Trades :: Check 11 11 11 11 11 11 11", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for owner :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("Time :: Change", function () {

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(172800);
      console.log("...2 days");
    });

  });


  describe("Trades :: Check 121212121212121212", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      console.log("rewards for owner : 0");

      const tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("Trades :: Check", function () {

    it("Should give addr1 fees", async function () {
      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 balance", async function () {
      const tx = await collateralPool.read.balanceOf([addr1.account.address]);
      console.log("Trader balance USDC :", Number(tx / 10n ** 18n));
    });

    it("Should say if need to liquidiate addr1", async function () {
      const tx = await collateralPool.read.needLiquidation([addr1.account.address]);
      console.log("Trader need liquidation :", tx);
    });

  });


  describe("LPs :: Check", function () {

    it("Should claim fees for addr1", async function () {
      let tx = await collateralPool.read.getRewardsForLp([0n, 0n, 0n]);
      console.log("rewards for addr1 :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));

      const balanceAV = await fakeUSDC.read.balanceOf([addr2.account.address]);
      await collateralPool.write.claimRewards(
        [0n, 1n, 0n],
        { account: addr2.account }
      );
      const balanceAP = await fakeUSDC.read.balanceOf([addr2.account.address]);

      console.log(
        "Claimed (addr2):",
        Number((balanceAP - balanceAV) / 10n ** 6n)
      );

      rewardsClaimed += tx;
    });

  });


  describe("Trades :: Check ggggggggggggggggggggg", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      console.log("rewards for owner : 0");

      const tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("LPs :: Check", function () {

    it("Should deposit call LP at correct interval for Owner", async function () {
      const strikeValue = 57000n * 10n ** 18n;

      let tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("Before deposit (owner):", tx);

      const amountValue = 172500000000n;

      await marketPool.write.deposit(
        [false, 0n, amountValue],
        { account: owner.account }
      );

      tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("After deposit (owner):", tx);
    });

    it("Should deposit call LP at correct interval for addr2", async function () {
      const strikeValue = 57000n * 10n ** 18n;

      let tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("Before deposit (addr2):", tx);

      const amountValue = 57000000000n;

      await marketPool.write.deposit(
        [false, 0n, amountValue],
        { account: addr2.account }
      );

      tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("After deposit (addr2):", tx);
    });

  });


  describe("Trades :: Check", function () {

    it("Should open a trade for addr1", async function () {
      const strikeValue = 57000n * 10n ** 18n;
      const amountValue = 114000000000n;

      let tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Fees claimed :", Number(tx / 10n ** 18n));
      feesClaimed += tx;

      await marketPool.write.openContract(
        [false, 0, amountValue],
        { account: addr1.account }
      );

      tx = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikekInfos After :", tx);

      tx = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos After :", tx);
    });

  });


  describe("Trades :: Check hhhhhhhhhhhhhhhhhhhhhh", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 2n, 0n]);
      console.log("rewards for owner put :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 call :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 3n, 0n]);
      console.log("rewards for addr2 put :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("Time :: Change", function () {

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(259200);
      console.log("...3 days");
    });

  });

  describe("Trades :: Check Dashboard", function () {

    it("Should give market's total OI", async function () {
      const tx = await protocolInfos.read.getMarketOpenInterest([0n]);
      console.log(tx);
    });

    it("Should give market's total Liquidity Provided", async function () {
      const tx = await protocolInfos.read.getMarketLiquidityProvided([0n]);
      console.log(tx);
    });

    it("Should give market's available liquidation", async function () {
      const tx = await protocolInfos.read.getMarketAvailableLiquidation([0n]);
      console.log(tx);
    });

  });


  describe("Oracles :: Prices moove", function () {

    it("should moove the prices", async function () {
      await fakeBtcOracle.write.setPrice(
        [55900n * 10n ** 8n],
        { account: owner.account }
      );

      const tx = await marketPool.read.getPrice();
      console.log("Current price :", Number(tx / 10n ** 18n));
    });

  });


  describe("Trades :: Check iiiiiiiiiiiiiiiiiiiiiiiiiii", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 2n, 0n]);
      console.log("rewards for owner put :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 call :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 3n, 0n]);
      console.log("rewards for addr2 put :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("Trades :: Check", function () {

    it("Should exercise contract 2", async function () {
      const balanceBTCAV = await fakeWBTC.read.balanceOf([addr1.account.address]);
      const balanceUSDCAV = await fakeUSDC.read.balanceOf([addr1.account.address]);

      let tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Fees claimed :", Number(tx / 10n ** 18n));
      feesClaimed += tx;

      tx = await marketPool.read.getContractInfos([2n]);
      console.log("ContractInfos before close :", tx);

      await marketPool.write.closeContract(
        [2n],
        { account: addr1.account }
      );

      const balanceBTCAP = await fakeWBTC.read.balanceOf([addr1.account.address]);
      const balanceUSDCAP = await fakeUSDC.read.balanceOf([addr1.account.address]);

      console.log(
        "Balance WBTC change:",
        Number((balanceBTCAP - balanceBTCAV) / 10n ** 8n)
      );
      console.log(
        "Balance USDC change:",
        Number((balanceUSDCAP - balanceUSDCAV) / 10n ** 6n)
      );
    });

  });


  describe("LPs :: Check", function () {

    it("Should claim fees for addr1", async function () {
      let tx = await collateralPool.read.getRewardsForLp([0n, 2n, 0n]);
      console.log("rewards for owner put :", Number(tx / 10n ** 18n));
      rewardsClaimed += tx;

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 call :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 3n, 0n]);
      console.log("rewards for addr2 put :", Number(tx / 10n ** 18n));
      rewardsClaimed += tx;

      let balanceAV = await fakeUSDC.read.balanceOf([owner.account.address]);
      await collateralPool.write.claimRewards(
        [0n, 2n, 0n],
        { account: owner.account }
      );
      let balanceAP = await fakeUSDC.read.balanceOf([owner.account.address]);
      console.log(
        "Owner claimed USDC:",
        Number((balanceAP - balanceAV) / 10n ** 6n)
      );

      balanceAV = await fakeUSDC.read.balanceOf([addr2.account.address]);
      await collateralPool.write.claimRewards(
        [0n, 3n, 0n],
        { account: addr2.account }
      );
      balanceAP = await fakeUSDC.read.balanceOf([addr2.account.address]);
      console.log(
        "Addr2 claimed USDC:",
        Number((balanceAP - balanceAV) / 10n ** 6n)
      );
    });

  });


  describe("Trades :: Check jjjjjjjjjjjjjjjjjjjjjj", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 2n, 0n]);
      console.log("rewards for owner put :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 call :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 3n, 0n]);
      console.log("rewards for addr2 put :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });


  describe("Trades :: Check Dashboard", function () {

    it("Should give market's total OI", async function () {
      const tx = await protocolInfos.read.getMarketOpenInterest([0n]);
      console.log(tx);
    });

    it("Should give market's total Liquidity Provided", async function () {
      const tx = await protocolInfos.read.getMarketLiquidityProvided([0n]);
      console.log(tx);
    });

    it("Should give market's available liquidation", async function () {
      const tx = await protocolInfos.read.getMarketAvailableLiquidation([0n]);
      console.log(tx);
    });

    it("Should give market's owner LP infos", async function () {
      const tx = await userInfos.read.getUserLpInfosForMarket(
        [0n, owner.account.address]
      );
      console.log(tx);
    });

    it("Should give market's addr2 LP infos", async function () {
      const tx = await userInfos.read.getUserLpInfosForMarket(
        [0n, addr2.account.address]
      );
      console.log(tx);
    });

    it("Should give market's balance detail", async function () {
      const tx = await protocolInfos.read.getMarketBalanceDetail([0n]);
      console.log(tx);
    });

  });

  describe("Oracles :: Prices moove", function () {

    it("should moove the prices", async function () {
      await fakeBtcOracle.write.setPrice(
        [52800n * 10n ** 8n],
        { account: owner.account }
      );

      const tx = await marketPool.read.getPrice();
      console.log("Current price :", Number(tx / 10n ** 18n));
    });

  });

  describe("LPs :: Check", function () {

    it("Should deposit call LP at correct interval for Owner", async function () {
      // READ intervals
      let intervals = await marketPool.read.getIntervals([]);
      console.log("Intervals:", intervals);

      const strikeValue = 54000n * 10n ** 18n;

      // READ strike info
      let strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("Before deposit (owner):", strikeInfo);

      // WRITE deposit
      await marketPool.write.deposit(
        [true, 0n, 4n * 10n ** 8n],     // [isCall, index, amount]
        { account: owner.account }
      );

      // READ again
      strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("After deposit (owner):", strikeInfo);

    });

  });

  describe("Trades :: Check", function () {

    it("Should deposit collateral for addr1", async function () {
      let userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos Before (addr1):", userInfo);

      await collateralPool.write.depositCollateral(
        [1500n * 10n ** 6n],          // 1500e6
        { account: addr1.account }
      );

      userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos After (addr1):", userInfo);
    });

    it("Should open a trade for addr1", async function () {
      const strikeValue = 54000n * 10n ** 18n;  // 54000 * 1e18

      let strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos Before:", strikeInfo);

      await marketPool.write.openContract(
        [true, 0, 1n * 10n ** 8n],       // true, 2e8
        { account: addr1.account }
      );

      strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos After:", strikeInfo);

      const userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos After (addr1):", userInfo);
    });

  });

  //
  // TIME
  //
  describe("Time :: Change", function () {

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(259200);
      console.log("...3 days");
    });

  });

  describe("LPs :: Check", function () {

    it("Should give market's addr2 call LP infos", async function () {
      let tx = await marketPool.read.getLpInfos(
        [1n]
      );
      console.log(tx);
    });

    it("Should claim fees for addr2 call", async function () {

      let tx = await collateralPool.read.getRewardsForLp([0n, 1n, 2n]);
      console.log("rewards for addr2 call :", Number(tx / 10n ** 18n));

      rewardsClaimed += tx;

      let balanceAV = await fakeUSDC.read.balanceOf([addr2.account.address]);
      await collateralPool.write.claimRewards(
        [0n, 1n, 2n],
        { account: addr2.account }
      );
      let balanceAP = await fakeUSDC.read.balanceOf([addr2.account.address]);
      console.log(
        "Addr2 claimed USDC:",
        Number((balanceAP - balanceAV) / 10n ** 6n)
      );
    });

  });


  describe("Trades :: Check hhhhhhhhhhhhhhhhhhhhh", function () {

    it("Should give user rewards", async function () {
      console.log(
        "Total Rewards Claimed :",
        Number(rewardsClaimed / 10n ** 18n)
      );

      let tx = await collateralPool.read.getRewardsForLp([0n, 2n, 0n]);
      console.log("rewards for owner put :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 1n, 0n]);
      console.log("rewards for addr2 call :", Number(tx / 10n ** 18n));

      tx = await collateralPool.read.getRewardsForLp([0n, 3n, 0n]);
      console.log("rewards for addr2 put :", Number(tx / 10n ** 18n));
    });

    it("Should give addr1 fees", async function () {
      console.log(
        "Total Fees Claimed :",
        Number(feesClaimed / 10n ** 18n)
      );

      const tx = await collateralPool.read.getUserFees([addr1.account.address]);
      console.log("Trader fees USDC :", Number(tx / 10n ** 18n));
    });

  });

});
