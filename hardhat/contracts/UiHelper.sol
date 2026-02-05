// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./interfaces/IMain.sol";
import "./interfaces/ICollateralPool.sol";
import "./interfaces/IMarketPool.sol";
import "./interfaces/IERC721x.sol";

contract UiHelper {

    address private _MAIN;
    
    constructor(address _main) {
        _MAIN = _main;
    }

    function getMarketAssetPrice(uint256 _index) public view returns(uint256) {
        IMarketPool marketPool = IMarketPool(IMain(_MAIN).getIdToMarket(_index));
        return marketPool.getPrice();
    }

    function getMarketOpenInterest(uint256 _index) public view returns(uint256[2] memory) {

        IMarketPool marketPool = IMarketPool(IMain(_MAIN).getIdToMarket(_index));
        address ERC721_Contrat = marketPool.getERC721_Contract();
        uint256 ID;
        IMarketPool.ContractInfos memory contractInfos;
        uint256 callOI;
        uint256 putOI;

        //For all open contracts => add their amount
        for(uint256 i ; i < IERC721x(ERC721_Contrat).totalSupply() ; i++) {
            ID = IERC721x(ERC721_Contrat).tokenByIndex(i);
            contractInfos = marketPool.getContractInfos(ID);
            if (contractInfos.isCall) {
                callOI += contractInfos.amount;
            } else {
                putOI += contractInfos.amount;
            }
        }

        return [callOI, putOI];
    }

    function getMarketLiquidityProvided(uint256 _index) public view returns(uint256[2] memory) {

        // Get Infos
        IMarketPool marketPool = IMarketPool(IMain(_MAIN).getIdToMarket(_index));
        address ERC721_LP = marketPool.getERC721_LP();
        uint256 ID;
        IMarketPool.LpInfos memory lpInfos;
        uint256 callLP;
        uint256 putLP;

        //For all LPs 
        for(uint256 i ; i < IERC721x(ERC721_LP).totalSupply() ; i++) {
            ID = IERC721x(ERC721_LP).tokenByIndex(i);
            lpInfos = marketPool.getLpInfos(ID);

            // Add their amount
            if (lpInfos.isCall) {
                callLP += lpInfos.amount;
            } else {
                putLP += lpInfos.amount;
            }
        }

        return [callLP, putLP];
    }

    function getMarketsAvlLiquidity(uint256 _index) public view returns(uint256[] memory) {
        
        // Get Infos
        uint256 marketCount = IMain(_MAIN).getMarketCount();
        IMain.marketInfos memory marketInfos = IMain(_MAIN).getIdToMarketInfos(_index);

        // Answer
        uint256[] memory _avlLiquidity = new uint256[](marketInfos.intervalLength);

        // Initialization
        IMain.marketInfos memory thisMarketInfos;
        IMarketPool thisMarketPool;
        uint256 thisStrike;
        IMarketPool.StrikeInfos memory thisStrikeInfos;

        // For all markets
        for(uint256 i = 0 ; i < marketCount ; i++) {
            thisMarketInfos = IMain(_MAIN).getIdToMarketInfos(i);

            // If same market
            if (marketInfos.tokenA == thisMarketInfos.tokenA) {
                if (marketInfos.priceFeed == thisMarketInfos.priceFeed) {
                    if (marketInfos.range == thisMarketInfos.range) {
                        if (marketInfos.intervalLength == thisMarketInfos.intervalLength) {
                            
                            // For each available strike Index
                            for (uint256 ii = 0 ; ii < marketInfos.intervalLength ; ii++) {
                                thisMarketPool = IMarketPool(IMain(_MAIN).getIdToMarket(i));
                                thisStrike = thisMarketPool.getIntervals()[ii];
                                thisStrikeInfos = thisMarketPool.getStrikeInfos(thisStrike);

                                // If Put side
                                if (ii < marketInfos.intervalLength / 2) {
                                    // avl = (putLP - putLU - putLR * strike) / strike;
                                    _avlLiquidity[ii] += ((thisStrikeInfos.putLP - thisStrikeInfos.putLU - ((thisStrikeInfos.putLR * thisStrike) / 1e18)) * 1e18) / thisStrike;
                                } else {
                                    // avl = callLP - callLU - callLR / strike;
                                    _avlLiquidity[ii] += thisStrikeInfos.callLP - thisStrikeInfos.callLU - (thisStrikeInfos.callLR * 1e18) / thisStrike;
                                }
                                
                            }
                        }
                    }
                }
            }
        }

        return _avlLiquidity;
    }

    struct MarketStats {
        uint256 OI;
        uint256 liquidity;
    }

    // Return Open Interest and Total Liquidity for all same markets (same asset, range etc...)
    // Open Interest in base asset
    function getMarketsStats(uint256 _index) public view returns(MarketStats memory) {
        
        // Get Infos
        uint256 marketCount = IMain(_MAIN).getMarketCount();
        IMain.marketInfos memory marketInfos = IMain(_MAIN).getIdToMarketInfos(_index);

        // Initialization
        IMain.marketInfos memory thisMarketInfos;
        MarketStats memory marketStats;
        uint256[2] memory marketOI;
        uint256[2] memory marketLiquidity;

        // For all markets
        for(uint256 i = 0 ; i < marketCount ; i++) {
            thisMarketInfos = IMain(_MAIN).getIdToMarketInfos(i);

            // If same market
            if (marketInfos.tokenA == thisMarketInfos.tokenA) {
                if (marketInfos.priceFeed == thisMarketInfos.priceFeed) {
                    if (marketInfos.range == thisMarketInfos.range) {
                        if (marketInfos.intervalLength == thisMarketInfos.intervalLength) {
                            marketOI = getMarketOpenInterest(i);
                            marketLiquidity = getMarketLiquidityProvided(i);

                            // Add OpenInterest
                            marketStats.OI += ((marketOI[0] * getMarketAssetPrice(i)) / 1e18)+ marketOI[1];

                            // Add Liquidity
                            marketStats.liquidity += ((marketLiquidity[0] * getMarketAssetPrice(i)) / 1e18) + marketLiquidity[1];                      
                        }
                    }
                }
            }
        }

        return marketStats;
    }

    struct StrikeAprInfo {
        uint256 yield;
        uint256 callAvlLiq;
        uint256 putAvlLiq;
    }

    // Stike 18 decimals
    // Given a strike and a market, get all APR Options and associated Available Liquidity for all the same markets (same asset, range etc...)
    function getStrikeAprOptions(uint256 _index, uint256 _strike) external view returns(StrikeAprInfo[] memory) {

        // Get Infos
        uint256 marketCount = IMain(_MAIN).getMarketCount();
        IMain.marketInfos memory marketInfos = IMain(_MAIN).getIdToMarketInfos(_index);

        // Initialization
        IMain.marketInfos memory thisMarketInfos;
        uint256 sameMarketCount;

        // For all markets
        for(uint256 x = 0 ; x < marketCount ; x++) {
            thisMarketInfos = IMain(_MAIN).getIdToMarketInfos(x);

            // If same market
            if (marketInfos.tokenA == thisMarketInfos.tokenA) {
                if (marketInfos.priceFeed == thisMarketInfos.priceFeed) {
                    if (marketInfos.range == thisMarketInfos.range) {
                        if (marketInfos.intervalLength == thisMarketInfos.intervalLength) {
                            // Count same market
                            sameMarketCount ++;
                        }
                    }
                }
            }
        }

        // Initialization
        StrikeAprInfo[] memory strikeAprInfos = new StrikeAprInfo[](sameMarketCount);
        IMarketPool.StrikeInfos memory thisStrikeInfos;

        // For all markets
        for(uint256 i = 0 ; i < sameMarketCount ; i++) {
            thisMarketInfos = IMain(_MAIN).getIdToMarketInfos(i);

            // If same market
            if (marketInfos.tokenA == thisMarketInfos.tokenA) {
                if (marketInfos.priceFeed == thisMarketInfos.priceFeed) {
                    if (marketInfos.range == thisMarketInfos.range) {
                        if (marketInfos.intervalLength == thisMarketInfos.intervalLength) {

                            // For the same Strike
                            thisStrikeInfos = IMarketPool(IMain(_MAIN).getIdToMarket(i)).getStrikeInfos(_strike);

                            // Add APR and Liquidity
                            strikeAprInfos[i].yield = thisMarketInfos.yield;
                            strikeAprInfos[i].putAvlLiq = ((thisStrikeInfos.putLP - thisStrikeInfos.putLU - ((thisStrikeInfos.putLR * _strike) / 1e18)) * 1e18) / _strike;
                            strikeAprInfos[i].callAvlLiq = thisStrikeInfos.callLP - thisStrikeInfos.callLU - (thisStrikeInfos.callLR * 1e18) / _strike;

                        }
                    }
                }
            }
        }

        return strikeAprInfos;       
    }

    function getTotalRewardsForLP(address _lp) public view returns(uint256) {
        uint256 marketCount = IMain(_MAIN).getMarketCount();
        address marketAddr;
        address ERC721_LpAddr;
        uint256 totalOwned;
        uint256 ID;
        uint256 rewards;

        // For all markets
        for(uint256 i = 0 ; i < marketCount ; i++) {
            marketAddr = IMain(_MAIN).getIdToMarket(i);
            ERC721_LpAddr = IMarketPool(marketAddr).getERC721_LP();
            totalOwned = IERC721x(ERC721_LpAddr).balanceOf(_lp);

            // For all Ids
            for(uint256 ii = 0 ; ii < totalOwned ; ii++) {
                ID = IERC721x(ERC721_LpAddr).tokenOfOwnerByIndex(_lp, ii);

                // Get rewards
                rewards += IMarketPool(marketAddr).getRewards(ID);
            }
            
        }

        return rewards;
    }

    struct ContractInfos {
        uint256 index;
        address owner;
        uint256 ID;
        address asset;
        bool isCall;
        uint256 strike;
        uint256 amount;
        uint256 rent;
        uint256 start;
        bool isITM;
        uint256 totalRent;
        uint256 collateral;
        bool needLiquidation;
    }

    function getMarketAllContractsInfos(uint256 _index) public view returns(ContractInfos[] memory) {

        IMarketPool marketPool = IMarketPool(IMain(_MAIN).getIdToMarket(_index));
        ICollateralPool collateralPool = ICollateralPool(IMain(_MAIN).getCollateralPool());
        address ERC721_Contrat = marketPool.getERC721_Contract();
        uint256 ID;
        address owner;
        IMarketPool.ContractInfos memory contractInfos;
        ContractInfos[] memory allContractsInfos = new ContractInfos[](IERC721x(ERC721_Contrat).totalSupply());

        //For all open contracts => add their infos
        for(uint256 i = 0 ; i < IERC721x(ERC721_Contrat).totalSupply() ; i++) {
            ID = IERC721x(ERC721_Contrat).tokenByIndex(i);
            owner = IERC721x(ERC721_Contrat).ownerOf(ID);
            contractInfos = marketPool.getContractInfos(ID);
            allContractsInfos[i] = ContractInfos({
                index: _index,
                owner: owner,
                ID: ID,
                asset: marketPool.getTokenA(),
                isCall: contractInfos.isCall,
                strike: contractInfos.strike,
                amount: contractInfos.amount,
                rent: contractInfos.rent,
                start: contractInfos.start,
                isITM: contractInfos.isCall ? ((getMarketAssetPrice(_index) > contractInfos.strike) ? true : false) : ((getMarketAssetPrice(_index) > contractInfos.strike) ? false : true),
                totalRent: collateralPool.getUserInfos(owner).rent,
                collateral: collateralPool.balanceOf(owner),
                needLiquidation: collateralPool.needLiquidation(owner)
            });
        }

        return allContractsInfos;
    }

    function getAllContractInfos() public view returns(ContractInfos[] memory) {
        uint256 marketCount = IMain(_MAIN).getMarketCount();
        uint256 totalContracts;
        uint256 index;
        IMarketPool marketPool;

        // Get total contracts count
        for(uint256 i ; i < marketCount ; i++) {
            marketPool = IMarketPool(IMain(_MAIN).getIdToMarket(i));
            address ERC721_Contrat = marketPool.getERC721_Contract();
            totalContracts += IERC721x(ERC721_Contrat).totalSupply();
        }

        // Prepare answer array
        ContractInfos[] memory allContractsInfos = new ContractInfos[](totalContracts);

        // For all markets, get all contracts infos
        for(uint256 ii ; ii < marketCount ; ii++) {
            marketPool = IMarketPool(IMain(_MAIN).getIdToMarket(ii));
            ContractInfos[] memory marketContractsInfos = getMarketAllContractsInfos(ii);

            // Add to answer
            for(uint256 iii ; iii < marketContractsInfos.length ; iii++) {
                allContractsInfos[index] = marketContractsInfos[iii];
                index++;
            }
        }

        return allContractsInfos;
    }

    function getOlderIndex(ContractInfos[] memory _array) public pure returns(uint256) {
        uint256 index = 0;

        for(uint256 i = 0 ; i < _array.length ; i++) {
            if (_array[i].start < _array[index].start) {
                index = i;
            }
        }

        return index;
    }

    function getRecentContracts() external view returns (ContractInfos[] memory) {

        //Get Infos
        ContractInfos[] memory allContractsInfos = getAllContractInfos();

        // Initialization
        ContractInfos memory thisContract;
        ContractInfos[] memory recentContracts = new ContractInfos[](10);
        uint256 smallestTimestampIndex;

        // For all contracts
        for(uint256 i = 0 ; i < allContractsInfos.length ; i++) {
            thisContract = allContractsInfos[i];

            // Get the 10 most recent contracts
            if (i <= 9) {
                recentContracts[i] = thisContract;
            } else {
                smallestTimestampIndex = getOlderIndex(recentContracts);
                if (thisContract.start > recentContracts[smallestTimestampIndex].start) {
                    recentContracts[smallestTimestampIndex] = thisContract;
                }
            }            
        }

        return recentContracts;
    }

    function getAllMarketsInfos() external view returns(IMain.marketInfos[] memory) {
        IMain main = IMain(_MAIN);
        uint256 marketCount = main.getMarketCount();
        IMain.marketInfos[] memory allMarketsInfos = new IMain.marketInfos[](marketCount);

        for(uint256 i ; i < marketCount ; i++) {
            allMarketsInfos[i] = main.getIdToMarketInfos(i);
        }

        return allMarketsInfos;
    }

}

