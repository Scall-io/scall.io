// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IMain.sol";
import "./interfaces/IOwnable.sol";
import "./interfaces/IMarketPool.sol";
import "./interfaces/IERC20x.sol";
import "./interfaces/IERC721x.sol";

contract CallTokenDistributor {

    /*
    Every period, a specific amount of CALL Token become available to claim.
    LPs get a portion of this amount based on their size (OI in USD).
    Requirements :
    - LP have to be open for at least 48 hours (or any specific date)
    - If ITM => only active amount is counting (callLU/LpAmount)
    - If OTM => if in interval => 100% amount is counting
    */

    //Contract Address
    address private _CALLTOKEN;
    address private _MAIN;

    //Variable
    uint256 private _REQUIREDDURATION;

    /**
    * @notice Creates a new CALL token distributor for MarketPool LP rewards.
    * @param _requiredDuration Minimum time (in seconds) an LP position must be open to be eligible.
    * @param _callToken ERC20 token address to distribute as rewards.
    * @param _main Main protocol contract address used to discover markets and owner.
    */
    constructor(uint256 _requiredDuration, address _callToken, address _main) {
        _REQUIREDDURATION = _requiredDuration;
        _CALLTOKEN = _callToken;
        _MAIN = _main;
    }

    ////////////////////////////////////////////////////////////////// SET UP //////////////////////////////////////////////////////////////////
    uint256 public _amountDistributed;
    uint256 public _lpsCount;
    mapping(uint256 => address) private _idToLP;
    mapping(address => uint256) private _lpToId;
    mapping(address => uint256) private _rewards;

    ////////////////////////////////////////////////////////////////// PRIVATE FUNCTIONS //////////////////////////////////////////////////////////////////

    /**
    * @notice Checks whether a value exists inside an array.
    * @dev Linear scan; O(n). Intended for small arrays.
    * @param _x The value to find.
    * @param _array The array to search in.
    * @return True if `_x` is present in `_array`, false otherwise.
    */
    function isPartOf(uint256 _x, uint256[] memory _array) private pure returns(bool) {
        for(uint256 i ; i < _array.length ; i++) {
            if (_x == _array[i]) {
                return true;
            }
        }
        return false;
    }

    /**
    * @notice Registers an LP owner address if needed and credits newly computed rewards to them.
    * @dev Internal bookkeeping:
    *      - Assigns a numeric ID to `_address` the first time it appears.
    *      - Increments `_rewards[_address]` by `_amount`.
    * @param _address LP owner address to credit.
    * @param _amount Reward amount to add to `_address`.
    */
    function updateLP(address _address, uint256 _amount) private {

        if (_lpToId[_address] == 0) {
            _lpsCount++;
            _lpToId[_address] = _lpsCount;
            _idToLP[_lpsCount] = _address;
        }

        _rewards[_address] += _amount;
        _amountDistributed += _amount;
    }

    ////////////////////////////////////////////////////////////////// GET FUNCTIONS //////////////////////////////////////////////////////////////////
    
    /**
    * @notice Returns the minimum required duration for LP positions to be eligible for rewards.
    * @return Duration in seconds.
    */
    function getRequiredDuration() external view returns(uint256) {
        return _REQUIREDDURATION;
    }

    /**
    * @notice Returns the currently accrued (unclaimed) rewards for a given address.
    * @param _address The address to query.
    * @return Amount of CALL token rewards accrued for `_address`.
    */
    function getRewards(address _address) public view returns(uint256) {
        return _rewards[_address];
    }

    /**
    * @notice Returns the total rewards currently owed to all registered LP owners.
    * @dev Iterates over all registered LP addresses tracked in `_idToLP`.
    *      This is a view helper and can become expensive as `_lpsCount` grows.
    * @return Total rewards owed (sum of `_rewards` for all tracked LP addresses).
    */
    function getClaimableRewards() public view returns(uint256) {
        uint256 claimableRewards;

        // For all registered LPs
        for(uint256 i = 0 ; i < _lpsCount ; i++) {
            claimableRewards += _rewards[_idToLP[i+1]];
        }

        return claimableRewards;
    }

    /**
    * @notice Computes the total eligible LP amount across all markets, expressed in "USD-equivalent" units.
    * @dev Eligibility rules (as implemented):
    *      - LP position must be open at least `_REQUIREDDURATION`.
    *      - For calls:
    *          * If ITM (price > strike): eligible amount is proportional to active liquidity (callLU / lpAmount),
    *            and converted to USD-equivalent via (amount * strike) / 1e18.
    *          * If OTM and strike is within [minStrike, maxStrike]: 100% amount counted, USD-equivalent conversion.
    *      - For puts:
    *          * If ITM (price < strike): eligible amount proportional to active liquidity (putLU / lpAmount),
    *            using lpInfos.amount directly (assumes amount already represents USD-equivalent units).
    *          * If OTM and strike within interval: 100% amount counted (same unit assumption).
    * @return Total eligible amount used as the denominator for reward splits.
    */
    function getEligibleAmount() public view returns(uint256) {
        uint256 currentTime = block.timestamp;
        uint256 marketCount = IMain(_MAIN).getMarketCount();
        address marketAddr;
        address ERC721_LPAddr;
        uint256 totalSupply;
        uint256 lpID;
        IMarketPool.LpInfos memory lpInfos;
        IMarketPool.StrikeInfos memory strikeInfos;
        uint256 price;
        uint256 eligibleAmount;

        // For all markets
        for(uint256 i = 0 ; i < marketCount ; i++) {
            marketAddr = IMain(_MAIN).getIdToMarket(i);
            ERC721_LPAddr = IMarketPool(marketAddr).getERC721_LP();
            totalSupply = IERC721x(ERC721_LPAddr).totalSupply();

            // For all LPs contract
            for (uint256 ii = 0; ii < totalSupply; ii++) {
                lpID = IERC721x(ERC721_LPAddr).tokenByIndex(ii);
                lpInfos = IMarketPool(marketAddr).getLpInfos(lpID);

                // If active more than 48h
                if (currentTime - lpInfos.start > _REQUIREDDURATION) {
                    price = IMarketPool(marketAddr).getPrice();

                    // If isCall
                    if (lpInfos.isCall) {

                        // If ITM
                        if (price > lpInfos.strike ) {
                            strikeInfos = IMarketPool(marketAddr).getStrikeInfos(lpInfos.strike);

                            // If callLU >= LP amount
                            if (strikeInfos.callLU >= lpInfos.amount) {

                                // Full amount is eligible (USD equivalent)
                                eligibleAmount += (lpInfos.amount * lpInfos.strike) / 1e18;

                            } else /* callLU < LP amount */ {

                                // Only used part is eligible (USD equivalent)
                                eligibleAmount += ((strikeInfos.callLU * 1e18) / lpInfos.amount) * ((lpInfos.amount * lpInfos.strike) / 1e18) / 1e18;

                            }

                        } else /* is OTM */ {
                            uint256[] memory intervals = IMarketPool(marketAddr).getIntervals();

                            // If strike is part of Intervals
                            if (isPartOf(lpInfos.strike, intervals)) {

                                // Full amount eligible (USD equivalent)
                                eligibleAmount += (lpInfos.amount * lpInfos.strike) / 1e18;
                            }

                        }

                    } else /* is put */ {

                        // If ITM
                        if (price < lpInfos.strike ) {
                            strikeInfos = IMarketPool(marketAddr).getStrikeInfos(lpInfos.strike);

                            // If putLU >= LP amount
                            if (strikeInfos.putLU >= lpInfos.amount) {

                                // Full amount eligible
                                eligibleAmount += lpInfos.amount;

                            } else /* putLU < LP amount */ {

                                // Only used part is eligible
                                eligibleAmount += strikeInfos.putLU;

                            }

                        } else /* is OTM */ {
                            uint256[] memory intervals = IMarketPool(marketAddr).getIntervals();

                            // If strike is part of Intervals
                            if (isPartOf(lpInfos.strike, intervals)) {

                                // Full amount eligible
                                eligibleAmount += lpInfos.amount;

                            }
                            
                        }
                    }
                }
            }
        }

        return eligibleAmount;
    }

    ////////////////////////////////////////////////////////////////// OWNER FUNCTIONS //////////////////////////////////////////////////////////////////

    /**
    * @notice Deposits CALL tokens into this contract.
    * @dev Caller must approve this contract for `_amount` first.
    *      This function does not affect rewards accounting by itself.
    * @param _amount Amount of CALL tokens to transfer from caller to this contract.
    */
    function deposit(uint256 _amount) public {
       IERC20x(_CALLTOKEN).transferFrom(msg.sender, address(this), _amount);
    }

    /**
    * @notice Withdraws CALL tokens from this contract to the protocol owner.
    * @dev Only callable by the protocol owner (`IOwnable(_MAIN).owner()`).
    * @param _amount Amount of CALL tokens to transfer to the owner.
    */
    function withdraw(uint256 _amount) public {
        require(msg.sender == IOwnable(_MAIN).owner(), "You are not the owner");
        IERC20x(_CALLTOKEN).transfer(msg.sender, _amount);
    }

    /**
    * @notice Distributes `_amount` of CALL token rewards across eligible LPs proportionally to their eligible size.
    * @dev Only callable by the protocol owner (`IOwnable(_MAIN).owner()`).
    *      Steps (as implemented):
    *      1) Computes `totalEligibleAmount` by scanning all markets/LP NFTs (`getEligibleAmount()`).
    *      2) Scans again, and for each eligible LP NFT:
    *          - Computes that LP's eligible amount
    *          - Allocates `(_amount * eligibleAmount / totalEligibleAmount)` to the LP NFT owner via `updateLP()`
    * @param _amount Total CALL token amount to allocate across eligible LPs (accounting only).
    */
    /*
    function distributeRewards(uint256 _amount) public {
        require(msg.sender == IOwnable(_MAIN).owner(), "You are not the owner");
        uint256 currentTime = block.timestamp;
        uint256 marketCount = IMain(_MAIN).getMarketCount();
        address marketAddr;
        address ERC721_LPAddr;
        uint256 totalSupply;
        uint256 lpID;
        IMarketPool.LpInfos memory lpInfos;
        IMarketPool.StrikeInfos memory strikeInfos;
        uint256 price;
        uint256 eligibleAmount;

        // Get Eligible amount
        uint256 totalEligibleAmount = getEligibleAmount();
        require(totalEligibleAmount > 0, "No eligible LPs");

        // For all markets
        for(uint256 i = 0 ; i < marketCount ; i++) {
            marketAddr = IMain(_MAIN).getIdToMarket(i);
            ERC721_LPAddr = IMarketPool(marketAddr).getERC721_LP();
            totalSupply = IERC721x(ERC721_LPAddr).totalSupply();

            // For all LPs contract
            for (uint256 ii = 0; ii < totalSupply; ii++) {
                lpID = IERC721x(ERC721_LPAddr).tokenByIndex(ii);
                lpInfos = IMarketPool(marketAddr).getLpInfos(lpID);

                // If active more than _REQUIREDDURATION
                if (currentTime - lpInfos.start > _REQUIREDDURATION) {
                    price = IMarketPool(marketAddr).getPrice();

                    // If isCall
                    if (lpInfos.isCall) {

                        // If ITM
                        if (price > lpInfos.strike ) {
                            strikeInfos = IMarketPool(marketAddr).getStrikeInfos(lpInfos.strike);

                            // If callLU >= LP amount
                            if (strikeInfos.callLU >= lpInfos.amount) {

                                // Full amount is eligible (USD equivalent)
                                eligibleAmount = (lpInfos.amount * lpInfos.strike) / 1e18;

                                // Distribute Rewards
                                updateLP(IERC721x(ERC721_LPAddr).ownerOf(lpID), ((eligibleAmount * 1e18 / totalEligibleAmount) * _amount) / 1e18);

                            } else /* callLU < LP amount */ /* {

                                // Only used part is eligible (USD equivalent)
                                eligibleAmount = ((strikeInfos.callLU * 1e18) / lpInfos.amount) * ((lpInfos.amount * lpInfos.strike) / 1e18) / 1e18;

                                // Distribute Rewards
                                updateLP(IERC721x(ERC721_LPAddr).ownerOf(lpID), ((eligibleAmount * 1e18 / totalEligibleAmount) * _amount) / 1e18);

                            }

                        } else /* is OTM */ /*{
                            uint256[] memory intervals = IMarketPool(marketAddr).getIntervals();

                            // If strike is part of Intervals
                            if (isPartOf(lpInfos.strike, intervals)) {

                                // Full amount eligible (USD equivalent)
                                eligibleAmount = (lpInfos.amount * lpInfos.strike) / 1e18;

                                // Distribute Rewards
                                updateLP(IERC721x(ERC721_LPAddr).ownerOf(lpID), ((eligibleAmount * 1e18 / totalEligibleAmount) * _amount) / 1e18);

                            }

                        }

                    } else /* is put */ /*{

                        // If ITM
                        if (price < lpInfos.strike ) {
                            strikeInfos = IMarketPool(marketAddr).getStrikeInfos(lpInfos.strike);

                            // If putLU >= LP amount
                            if (strikeInfos.putLU >= lpInfos.amount) {

                                // Full amount eligible
                                eligibleAmount = lpInfos.amount;

                                // Distribute Rewards
                                updateLP(IERC721x(ERC721_LPAddr).ownerOf(lpID), ((eligibleAmount * 1e18 / totalEligibleAmount) * _amount) / 1e18);

                            } else /* putLU < LP amount *//* {

                                // Only used part is eligible
                                eligibleAmount = strikeInfos.putLU;

                                // Distribute Rewards
                                updateLP(IERC721x(ERC721_LPAddr).ownerOf(lpID), ((eligibleAmount * 1e18 / totalEligibleAmount) * _amount) / 1e18);

                            }

                        } else /* is OTM */ /*{
                            uint256[] memory intervals = IMarketPool(marketAddr).getIntervals();

                            // If strike is part of Intervals
                            if (isPartOf(lpInfos.strike, intervals)) {

                                // Full amount eligible
                                eligibleAmount = lpInfos.amount;

                                // Distribute Rewards
                                updateLP(IERC721x(ERC721_LPAddr).ownerOf(lpID), ((eligibleAmount * 1e18 / totalEligibleAmount) * _amount) / 1e18);

                            }
                            
                        }
                    }
                }
            }
        }

    }
    */

    /**
    * @notice Updates the minimum required duration for LP eligibility.
    * @dev Only callable by the protocol owner (`IOwnable(_MAIN).owner()`).
    * @param _amount New duration in seconds.
    */
    function setRequiredDuration(uint256 _amount) external {
        require(msg.sender == IOwnable(_MAIN).owner(), "You are not the owner");
        _REQUIREDDURATION = _amount;
    }

    ////////////////////////////////////////////////////////////////// USERS FUNCTIONS //////////////////////////////////////////////////////////////////

    /**
    * @notice Claims the caller's accrued CALL token rewards.
    * @dev Reverts if caller has no rewards.
    */
    function claimRewards() public {
        uint256 amt = _rewards[msg.sender];
        require(amt > 0, "No rewards");
        _rewards[msg.sender] = 0;
        IERC20x(_CALLTOKEN).transfer(msg.sender, amt);
    }

}