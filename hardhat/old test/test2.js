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

  let main;

  let marketPool;

  let protocolInfos;

  let userInfos

  let collateralPool;

  let fakeUSDC;
  let fakeWBTC;

  let fakeEthOracle;
  let fakeBtcOracle;

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
    
      fakeBtcOracle = await viem.deployContract("fakeOracle", [], { client: { wallet: owner } });

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

      const strikeValue = 55000n * 10n ** 18n;

      // READ strike info
      let strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("Before deposit (owner):", strikeInfo);

      // WRITE deposit
      await marketPool.write.deposit(
        [true, 1n, 5n * 10n ** 8n],     // [isCall, index, amount]
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
      const strikeValue = 55000n * 10n ** 18n;  // 55000 * 1e18

      let strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos Before:", strikeInfo);

      await marketPool.write.openContract(
        [true, 1, 2n * 10n ** 8n],       // true, 2e8
        { account: addr1.account }
      );

      strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos After:", strikeInfo);

      const userInfo = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos After (addr1):", userInfo);
    });

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(259200);
      console.log("...3 days");

      await fakeBtcOracle.write.setPrice(
        [52800n * 10n ** 8n],
        { account: owner.account }
      );
    });

    it("Should deposit collateral for addr2", async function () {
      let userInfo = await collateralPool.read.getUserInfos([addr2.account.address]);
      console.log("UserInfos Before (addr2):", userInfo);

      await collateralPool.write.depositCollateral(
        [1500n * 10n ** 6n],          // 1500e6
        { account: addr2.account }
      );

      userInfo = await collateralPool.read.getUserInfos([addr2.account.address]);
      console.log("UserInfos After (addr2):", userInfo);
    });

    it("Should open a trade for addr2", async function () {
      const strikeValue = 55000n * 10n ** 18n;  // 55000 * 1e18

      let strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos Before:", strikeInfo);

      await marketPool.write.openContract(
        [true, 1, 1n * 10n ** 8n],       // true, 1e8
        { account: addr2.account }
      );

      strikeInfo = await marketPool.read.getStrikeInfos([strikeValue]);
      console.log("StrikeInfos After:", strikeInfo);

      const userInfo = await collateralPool.read.getUserInfos([addr2.account.address]);
      console.log("UserInfos After (addr2):", userInfo);
    });

  });

  //
  // TIME
  //
  describe("Time :: Change", function () {

    it("should change block and timestamp", async function () {
      await networkHelpers.mine(1814400);
      console.log("...21 days");

      await fakeBtcOracle.write.setPrice(
        [52800n * 10n ** 8n],
        { account: owner.account }
      ); 
    });       

  });
  
  //
  // TRADER INFOS
  //
  describe("Trader infos", function () {

    it("should give trader infos", async function () {
      const x = await collateralPool.read.getUserInfos([addr1.account.address]);
      console.log("UserInfos:", x);
    });

    it("should give trader balance", async function () {
      const x = await collateralPool.read.balanceOf([addr1.account.address]);
      console.log("Balance:", x / 10n ** 18n);
    });

    it("should say if need liquidation", async function () {
      const x = await collateralPool.read.needLiquidation([addr1.account.address]);
      console.log("Need Liquidation :", x);
    });

    it("should liquidate the user", async function () {
      const x = await collateralPool.read.liquidateContract([0,0]);
      console.log("Need Liquidation :", x);
    });

  });

});
