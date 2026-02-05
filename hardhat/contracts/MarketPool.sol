// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./ERC721_Contract.sol";
import "./ERC721_LP.sol";
import "./interfaces/IChainlink.sol";
import "./interfaces/IERC20x.sol";
import "./interfaces/IERC721x.sol";
import "./interfaces/IMain.sol";
import "./interfaces/ICollateralPool.sol";

/// @title MarketPool - Manages perpetual options with liquidity provision and collateral
/// @notice This contract allows users to deposit liquidity, withdraw liquidity, open, and close option contracts.
/// @dev Interacts with external ERC20 and ERC721 contracts to manage assets and NFT-based positions.
contract MarketPool {

    event Deposit(address indexed user, bool isCall, uint256 amount, uint256 strike, uint256 lpId);
    event Withdraw(address indexed user, uint256 lpId, uint256 amountA, uint256 amountB);
    event ContractOpened(address indexed user, bool isCall, uint256 amount, uint256 strike, uint256 contractId);
    event ContractClosed(address indexed user, uint256 contractId, uint256 amount);

    //Base
    uint256 private _lpCount;
    uint256 private _contractCount;

    //Contract Address
    address private _MAIN;
    address private _ERC721_CONTRACT;
    address private _ERC721_LP;

    //Not Variable
    address private _TOKENA; // Asset
    uint256 private _TOKENA_DECIMALS;
    address private _TOKENB; // Collateral Token
    uint256 private _TOKENB_DECIMALS;

    //Variable
    address private _PRICEFEED;
    uint256 private _PRICEFEED_DECIMAL;
    uint256 private _INTERVALLENGTH;
    uint256 private _RANGE;
    uint256 private _YIELD;
    uint256 private _MAX_PRICE_STALENESS;

    /// @notice Initializes the MarketPool contract with the provided parameters and deploys two ERC721 contracts for options and liquidity positions.
    /// @param _main Address of the main contract governing the market pool.
    /// @param _tokenA Address of the asset token for call options.
    /// @param _tokenB Address of the collateral token for put options.
    /// @param _pricefeed Address of the Chainlink price feed contract for the underlying asset.
    /// @param _pricefeedDecimal The number of decimals used in the Chainlink price feed data.
    /// @param _range The range for strike prices based on the current price.
    /// @param _yield The yield percentage used to calculate premium costs.    
    constructor(address _main, address _tokenA, uint8 _tokenADecimals, address _tokenB, uint8 _tokenBDecimals, address _pricefeed, uint256 _pricefeedDecimal, uint256 _intervalLength, uint256 _range, uint256 _yield) {
        _MAIN = _main;
        _TOKENA = _tokenA;
        _TOKENA_DECIMALS = _tokenADecimals;
        _TOKENB = _tokenB;
        _TOKENB_DECIMALS = _tokenBDecimals;
        
        ERC721_Contract erc721_contract = new ERC721_Contract(address(this), "XPO", "XPO");
        _ERC721_CONTRACT = address(erc721_contract);

        ERC721_LP erc721_lp = new ERC721_LP(address(this), "LP", "LP");
        _ERC721_LP = address(erc721_lp);

        _PRICEFEED = _pricefeed;
        _PRICEFEED_DECIMAL = _pricefeedDecimal;
        _INTERVALLENGTH = _intervalLength;
        _RANGE = _range;
        _YIELD = _yield;
        _MAX_PRICE_STALENESS = 3600;
    }

    ////////////////////////////////////////////////////////////////// SET UP //////////////////////////////////////////////////////////////////

    struct StrikeInfos {
        uint256 callLP; // Liquidity provided
        uint256 callLU; // Liquidity under use
        uint256 callLR; // Liquidity returned (amount in oposite token) represent the amount exchanged after ITM contract executed (still counted in callLP)
        uint256 putLP;
        uint256 putLU;
        uint256 putLR;
        uint256 accCallPerShare; // Accumulated reward per Share since inseption
        uint256 accPutPerShare;
        uint256 lastUpdate; // start timestamp of this strike state
    }  

    struct LpInfos {
        bool isCall;
        uint256 strike;
        uint256 amount;
        uint256 start;
        uint256 rewardDebt;
    }  

    struct ContractInfos {
        bool isCall;
        uint256 strike;
        uint256 amount;
        uint256 rent;
        uint256 start;
    }

    mapping(uint256 => LpInfos) private _lpIdToInfos;
    mapping(uint256 => ContractInfos) private _contractIdToInfos;
    mapping(uint256 => StrikeInfos) private _strikeToInfos;

    ////////////////////////////////////////////////////////////////// BASE FUNCTIONS //////////////////////////////////////////////////////////////////

    /// @notice Returns the address of the main contract
    /// @return The address of the main contract
    function getMain() external view returns(address) {
        return _MAIN;
    }

    /// @notice Returns the address of the ERC721 contract for user positions
    /// @return The address of the ERC721 contract
    function getERC721_Contract() external view returns(address) {
        return _ERC721_CONTRACT;
    }

    /// @notice Returns the address of the ERC721 contract for liquidity provider positions
    /// @return The address of the ERC721 LP contract
    function getERC721_LP() external view returns(address) {
        return _ERC721_LP;
    }

    /// @notice Returns the address of Token A (the asset)
    /// @return The address of Token A
    function getTokenA() external view returns(address) {
        return _TOKENA;
    }

    /// @notice Returns the address of Token B (collateral token)
    /// @return The address of Token B
    function getTokenB() external view returns(address) {
        return _TOKENB;
    }

    // @notice Returns the address of the price feed contract
    /// @return The address of the price feed
    function getPriceFeed() external view returns(address) {
        return _PRICEFEED;
    }

    /// @notice Returns the range parameter used in pricing intervals
    /// @return The range parameter value
    function getIntervalLength() external view returns(uint256) {
        return _INTERVALLENGTH;
    }

    /// @notice Returns the range parameter used in pricing intervals
    /// @return The range parameter value
    function getRange() external view returns(uint256) {
        return _RANGE;
    }

    /// @notice Returns the yield rate for options
    /// @return The yield rate
    function getYield() external view returns(uint256) {
        return _YIELD;
    }

    /// @notice Returns chainlink's max price staleness
    /// @return The max price staleness
    function getMaxPriceStaleness() external view returns(uint256) {
        return _MAX_PRICE_STALENESS;
    }

    /// @notice Retrieves the details of a specific contract by ID
    /// @param _id The ID of the contract
    /// @return ContractInfos struct containing contract details
    function getContractInfos(uint256 _id) external view returns(ContractInfos memory) {
        return _contractIdToInfos[_id];
    }

    /// @notice Retrieves the details of a specific LP position by ID
    /// @param _id The ID of the LP position
    /// @return LpInfos struct containing LP position details
    function getLpInfos(uint256 _id) external view returns(LpInfos memory) {
        return _lpIdToInfos[_id];        
    }

    /// @notice Retrieves information about a specific strike
    /// @param _strike The strike price for which information is requested
    /// @return StrikeInfos struct containing strike information
    function getStrikeInfos(uint256 _strike) external view returns(StrikeInfos memory) {
        return _strikeToInfos[_strike];
    }

    /// @notice Updates the price feed and decimal values
    /// @dev Can only be called by the main contract
    /// @param _priceFeed The new price feed address
    /// @param _decimal The decimal precision of the price feed
    function setPriceFeed(address _priceFeed, uint256 _decimal) external {
        require(msg.sender == _MAIN, "You are not allowed");
        _PRICEFEED = _priceFeed;
        _PRICEFEED_DECIMAL = _decimal;
    }

    /// @notice Updates the interval length
    /// @dev Can only be called by the main contract
    /// @param _length The new length value
    function setIntervalLength(uint256 _length) external {
        require(msg.sender == _MAIN, "You are not allowed");
        require(_length > 0 && _length % 2 == 0, "Invalid length: Must be a positive even number");
        _INTERVALLENGTH = _length;
    }

    /// @notice Updates the range value
    /// @dev Can only be called by the main contract
    /// @param _range The new range value
    function setRange(uint256 _range) external {
        require(msg.sender == _MAIN, "You are not allowed");
        _RANGE = _range;
    }

    /// @notice Updates Chainlink's max price staleness
    /// @dev Can only be called by the main contract
    /// @param _maxPriceStaleness The new max price staleness
    function setMaxPriceStaleness(uint256 _maxPriceStaleness) external {
        require(msg.sender == _MAIN, "You are not allowed");
        _MAX_PRICE_STALENESS = _maxPriceStaleness;
    }

    ////////////////////////////////////////////////////////////////// INTERNAL //////////////////////////////////////////////////////////////////

    /// @notice Converts an amount from Token A's decimals to 18 decimals.
    /// @param _amount The amount in Token A's decimals to convert.
    /// @return The converted amount in 18 decimals.
    function tokenATo18(uint256 _amount) private view returns(uint256) {
        return (_amount * 1e18)/10**_TOKENA_DECIMALS;
    }

    /// @notice Converts an amount from Token B's decimals to 18 decimals.
    /// @param _amount The amount in Token B's decimals to convert.
    /// @return The converted amount in 18 decimals
    function tokenBTo18(uint256 _amount) private view returns(uint256) {
        return (_amount * 1e18)/10**_TOKENB_DECIMALS;
    }

    /// @notice Converts an amount from 18 decimals to Token A's decimals.
    /// @param _amount The amount in 18 decimals to convert.
    /// @return The converted amount in Token A's decimals.
    function toTokenADecimals(uint256 _amount) private view returns(uint256) {
        return (_amount * 10**_TOKENA_DECIMALS)/1e18;
    }

    /// @notice Converts an amount from 18 decimals to Token B's decimals.
    /// @param _amount The amount in 18 decimals to convert.
    /// @return The converted amount in Token B's decimals.
    function toTokenBDecimals(uint256 _amount) private view returns(uint256) {
        return (_amount * 10**_TOKENB_DECIMALS)/1e18;
    }

    /// @notice Updates the cumulative reward-per-share accumulators for a given strike.
    /// @dev This function implements an O(1) accumulator model (MasterChef-style).
    ///      It accrues rewards since the last update based on elapsed time, current utilization,
    ///      and total liquidity provided at the strike, then increases:
    ///      - accCallPerShare when callLP > 0
    ///      - accPutPerShare when putLP  > 0
    ///      If liquidity is zero, the corresponding accumulator is not increased.
    ///      This function must be called before any change to strike-level state (LP/LU) to keep accounting correct.
    /// @param _strike The strike price (18 decimals) identifying the strike bucket to update.
    function _updateStrike(uint256 _strike) private {
        StrikeInfos storage s = _strikeToInfos[_strike];
        uint256 dt = block.timestamp - s.lastUpdate;
        if (dt == 0) return;

        // Call accumulator
        if (s.callLP > 0) {
            uint256 rewardsPerYear =
                (((s.callLU * _strike) / 1e18) * _YIELD) / 1e18;
            uint256 rewards = (rewardsPerYear * dt) / 31536000; // 18 decimals
            s.accCallPerShare += (rewards * 1e18) / s.callLP;
        }

        // Put accumulator
        if (s.putLP > 0) {
            uint256 rewardsPerYear = (s.putLU * _YIELD) / 1e18;
            uint256 rewards = (rewardsPerYear * dt) / 31536000;
            s.accPutPerShare += (rewards * 1e18) / s.putLP;
        }

        s.lastUpdate = block.timestamp;
    }

    ////////////////////////////////////////////////////////////////// GET FUNCTIONS //////////////////////////////////////////////////////////////////

    /// @notice Fetches the current price of the underlying asset from the Chainlink price feed.
    /// @return The current price of the asset, adjusted to a standard 18 decimal format.
    function getPrice() public view returns(uint256) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = IChainlink(_PRICEFEED).latestRoundData();

        require(answeredInRound >= roundId, "Stale oracle round");
        require(block.timestamp - updatedAt <= _MAX_PRICE_STALENESS, "Oracle price stale");
        
        return uint256(answer) * (1e18/10**_PRICEFEED_DECIMAL);
    }

    /// @notice Returns the interval range around the current price based on a defined range value.
    /// @dev Calculates a lower and upper bound around the current price, expanded by `_RANGE` on both sides.
    /// @return An array containing the lower and upper bounds of the interval.
    function getIntervals() public view returns(uint256[] memory) {
        uint256 currentPrice = getPrice();

        uint256 modulo = currentPrice % _RANGE;

        uint256 lowerBound = currentPrice - modulo;
        uint256 upperBound = lowerBound + _RANGE;

        uint256[] memory intervals = new uint256[](_INTERVALLENGTH);
        uint256 last = lowerBound;

        uint256 halfLength = _INTERVALLENGTH / 2;

        // Fill the first half with lower bounds
        for (uint256 i = 0; i < halfLength; i++) {

            // Security in case RANGE*i > Price
            if (lowerBound > _RANGE * (i + 1)) {
                intervals[i] = lowerBound - _RANGE * (i + 1);
                last = intervals[i];
            } else {
                intervals[i] = last;
            }
            
        }

        // Fill the second half with upper bounds
        for (uint256 i = halfLength; i < _INTERVALLENGTH; i++) {
            intervals[i] = upperBound + _RANGE * (i - halfLength + 1);
        }

        return intervals;
    }

    /// @notice Returns the pending rewards for a given LP position.
    /// @dev Computes pending rewards in O(1) using a cumulative reward-per-share accumulator.
    ///      The function reads the current accumulator for the position’s strike and simulates the
    ///      additional accumulator increment that would be applied by `_updateStrike()` based on
    ///      elapsed time since the strike’s last update. No state is modified.
    ///      Pending rewards = (amount * accPerShare / 1e18) - rewardDebt.
    /// @param _id The LP position NFT id.
    /// @return rewards The pending rewards for this position (18 decimals).
    function getRewards(uint256 _id) public view returns(uint256) {

        // Get infos
        LpInfos memory thisLP = _lpIdToInfos[_id];

        uint256 acc = thisLP.isCall ? _strikeToInfos[thisLP.strike].accCallPerShare : _strikeToInfos[thisLP.strike].accPutPerShare;

        // Simulate the missing accumulator update since lastUpdate (view-only)
        uint256 dt = block.timestamp - _strikeToInfos[thisLP.strike].lastUpdate;
        uint256 rewardsPerYear;
        uint256 rewardsForDt;
        uint256 extraPerShare;
        if (dt > 0) {
            if (thisLP.isCall) {
               
                if (_strikeToInfos[thisLP.strike].callLP > 0) {

                    rewardsPerYear = (((_strikeToInfos[thisLP.strike].callLU * thisLP.strike) / 1e18) * _YIELD) / 1e18;
                    rewardsForDt = (rewardsPerYear * dt) / 31536000;
                    extraPerShare = (rewardsForDt * 1e18) / _strikeToInfos[thisLP.strike].callLP;

                    acc += extraPerShare;
                }
            } else {

                if (_strikeToInfos[thisLP.strike].putLP > 0) {

                    rewardsPerYear = (_strikeToInfos[thisLP.strike].putLU * _YIELD) / 1e18;
                    rewardsForDt = (rewardsPerYear * dt) / 31536000;
                    extraPerShare = (rewardsForDt * 1e18) / _strikeToInfos[thisLP.strike].putLP;

                    acc += extraPerShare;
                }
            }
        }

        uint256 accumulated = (thisLP.amount * acc) / 1e18;
        uint256 rewards = accumulated - thisLP.rewardDebt;
        
        return (rewards);
    }

    ////////////////////////////////////////////////////////////////// USERS FUNCTIONS //////////////////////////////////////////////////////////////////

    /// @notice Deposits liquidity into a strike bucket and mints an LP position NFT.
    /// @dev Uses cumulative reward-per-share accounting.
    ///      Calls `_updateStrike(strike)` before modifying strike totals to ensure the accumulator
    ///      reflects rewards up to the current timestamp.
    ///      The new position’s `rewardDebt` is initialized using the updated accumulator so the depositor
    ///      cannot claim rewards accrued before the deposit.
    /// @param _isCall True to deposit Token A (call side), false to deposit Token B (put side).
    /// @param _strikeIndex Index returned by `getIntervals()` selecting the strike bucket.
    /// @param _amount Amount of tokens deposited (token decimals).
    /// @return lpId The newly minted LP position NFT id.
    function deposit(bool _isCall, uint256 _strikeIndex, uint256 _amount) external returns(uint256) {
        require(_amount > 1e2, "_amount too low");
        require(_strikeIndex < _INTERVALLENGTH / 2, "Wrong Strike Index");

        // Intervals Check
        uint256[] memory interval = getIntervals();

        // Transfer token, get Strike and update strike Infos
        uint256 balBefore;
        uint256 balAfter;
        uint256 strike;
        uint256 amount;
        if (_isCall) {

            // Transaction
            balBefore = IERC20x(_TOKENA).balanceOf(address(this));
            IERC20x(_TOKENA).transferFrom(msg.sender, address(this), _amount);
            balAfter = IERC20x(_TOKENA).balanceOf(address(this));

            strike = interval[(_INTERVALLENGTH / 2) + _strikeIndex];
            amount = tokenATo18(_amount);
            
        } else {

            // Transaction
            balBefore = IERC20x(_TOKENB).balanceOf(address(this));
            IERC20x(_TOKENB).transferFrom(msg.sender, address(this), _amount);
            balAfter = IERC20x(_TOKENB).balanceOf(address(this));

            strike = interval[_strikeIndex];
            amount = tokenBTo18(_amount);
        }

        require(balAfter - balBefore == _amount, "Sent != Received");

        // Strike Update
        _updateStrike(strike);        

        // Read acc and Update Liquidity after security checks
        uint256 acc;
        if (_isCall == true) {
            acc = _strikeToInfos[strike].accCallPerShare;
            _strikeToInfos[strike].callLP += amount;
        } else {
            acc = _strikeToInfos[strike].accPutPerShare;
            _strikeToInfos[strike].putLP += amount;
        }

        // Set Lp position
        LpInfos memory newLP = LpInfos(_isCall, strike, amount, block.timestamp, (amount * acc) / 1e18);
        _lpIdToInfos[_lpCount] = newLP;
        IERC721x(_ERC721_LP).mint(msg.sender, _lpCount);

        // Emit the deposit event
        emit Deposit(msg.sender, _isCall, _amount, strike, _lpCount);

        _lpCount++;  

        return  (_lpCount - 1);     
    }

    /// @notice Withdraws liquidity from an LP position.
    /// @dev Updates the strike accumulator via `_updateStrike()` before changing strike totals.
    ///      Any pending rewards are realized through CollateralPool (which calls `claimRewards` on this contract),
    ///      then liquidity is reduced. If the position is fully withdrawn, the LP NFT is burned.
    /// @param _id The LP position NFT id.
    /// @return tokenAtoTransfer Amount of Token A returned (token decimals).
    /// @return tokenBtoTransfer Amount of Token B returned (token decimals).
    /// @return claimedRewards Reward amount paid out via CollateralPool (token decimals after conversion/distribution logic).
    function withdraw(uint256 _id) external returns(uint256, uint256, uint256) {
        require(msg.sender == IERC721x(_ERC721_LP).ownerOf(_id), "You are not the owner");
        
        // Get Infos
        LpInfos memory thisLP = _lpIdToInfos[_id];
        StrikeInfos memory strikeInfos = _strikeToInfos[thisLP.strike];
        uint256 liquidityReturned;
        uint256 availableFunds;
        uint256 tokenAtoTransfer;
        uint256 tokenBtoTransfer;
        uint256 share;

        // Strike Update
        _updateStrike(thisLP.strike);

        // Claim Rewards
        uint256 claimedRewards = ICollateralPool(IMain(_MAIN).getCollateralPool()).claimRewards(IMain(_MAIN).getMarketId(address(this)), _id);

        // Call or Put ?
        if (thisLP.isCall) {

            availableFunds = strikeInfos.callLP - strikeInfos.callLU;
            require(availableFunds > 0, "no available funds");

            if (strikeInfos.callLR > 0) {

                // A-equivalent of B in the pool
                liquidityReturned = (strikeInfos.callLR * 1e18) / thisLP.strike;

                // Safety: avoid underflow if rounding makes liquidityReturned slightly > availableFunds
                if (liquidityReturned > availableFunds) {
                    liquidityReturned = availableFunds;
                }

                // How much this LP is actually withdrawing now (in A-units of claim)
                uint256 w = thisLP.amount;
                if (w > availableFunds) w = availableFunds; // partial withdraw if not enough free funds

                // Compute Share
                share = (w * 1e18) / availableFunds;

                // Transfers ->
                /*
                Note:
                uint256 bFree = strikeInfos.callLR;
                uint256 aFree = availableFunds - liquidityReturned; // Token A sitting free
                uint256 tokenBtoTransfer = (bFree * share) / 1e18;
                uint256 tokenAtoTransfer = (aFree * share) / 1e18;
                */
                tokenBtoTransfer = (strikeInfos.callLR * share) / 1e18;
                tokenAtoTransfer = ((availableFunds - liquidityReturned) * share) / 1e18;

                // Changes
                _strikeToInfos[thisLP.strike].callLR -= tokenBtoTransfer;
                _strikeToInfos[thisLP.strike].callLP -= w;

                if (w == thisLP.amount) {
                    IERC721x(_ERC721_LP).burn(_id);
                } else {
                    _lpIdToInfos[_id].amount -= w; // withdrew only the available part
                }

            } else {

                // If available funds can't cover LP amount
                if (availableFunds < thisLP.amount) {

                    // Transfers
                    tokenBtoTransfer = 0;
                    tokenAtoTransfer = availableFunds;

                    // Changes
                    _lpIdToInfos[_id].amount -= availableFunds;
                    _strikeToInfos[thisLP.strike].callLP -= availableFunds;

                } else {

                    // Transfers
                    tokenBtoTransfer = 0;
                    tokenAtoTransfer = thisLP.amount;

                    // Changes
                    _strikeToInfos[thisLP.strike].callLP -= thisLP.amount;
                    IERC721x(_ERC721_LP).burn(_id);
                }

            }
            

        } else {

            availableFunds = strikeInfos.putLP - strikeInfos.putLU;
            require(availableFunds > 0, "no available funds");

            if (strikeInfos.putLR > 0) {

                // B-equivalent of A in the pool
                liquidityReturned = (strikeInfos.putLR * thisLP.strike) / 1e18;

                // Safety: avoid underflow if rounding makes liquidityReturned slightly > availableFunds
                if (liquidityReturned > availableFunds) {
                    liquidityReturned = availableFunds;
                }

                // How much this LP is actually withdrawing now (in B-units of claim)
                uint256 w = thisLP.amount;
                if (w > availableFunds) w = availableFunds; // partial withdraw if not enough free funds

                // Compute Share
                share = (w * 1e18) / availableFunds;

                // Transfers
                /*
                Note:
                uint256 aFree = strikeInfos.putLR
                uint256 bFree = availableFunds - liquidityReturned;
                uint256 tokenAtoTransfer = (aFree * share) / 1e18;
                uint256 tokenBtoTransfer = (bFree * share) / 1e18;
                */
                tokenAtoTransfer = (strikeInfos.putLR * share) / 1e18;
                tokenBtoTransfer = ((availableFunds - liquidityReturned) * share) / 1e18;

                // Changes
                _strikeToInfos[thisLP.strike].putLR -= tokenAtoTransfer;
                _strikeToInfos[thisLP.strike].putLP -= w;

                if (w == thisLP.amount) {
                    IERC721x(_ERC721_LP).burn(_id);
                } else {
                    _lpIdToInfos[_id].amount -= w; // withdrew only the available part
                }


            } else {

                // If available funds can't cover LP amount
                if (availableFunds < thisLP.amount) {

                    // Transfers
                    tokenAtoTransfer = 0;
                    tokenBtoTransfer = availableFunds;

                    // Changes
                    _lpIdToInfos[_id].amount -= availableFunds;
                    _strikeToInfos[thisLP.strike].putLP -= availableFunds;

                } else {

                    // Transfers
                    tokenAtoTransfer = 0;
                    tokenBtoTransfer = thisLP.amount;

                    // Changes
                    _strikeToInfos[thisLP.strike].putLP -= thisLP.amount;
                    IERC721x(_ERC721_LP).burn(_id);

                }
            }
        }

        // Transfers
        if (tokenAtoTransfer > 0) {
            IERC20x(_TOKENA).transfer(msg.sender, toTokenADecimals(tokenAtoTransfer));
        }

        if (tokenBtoTransfer > 0) {
            IERC20x(_TOKENB).transfer(msg.sender, toTokenBDecimals(tokenBtoTransfer));
        }

        // Emit the withdrawal event
        emit Withdraw(msg.sender, _id, toTokenADecimals(tokenAtoTransfer), toTokenBDecimals(tokenBtoTransfer));

        return (toTokenADecimals(tokenAtoTransfer), toTokenBDecimals(tokenBtoTransfer), claimedRewards);                
    }

    /// @notice Opens a new perpetual option contract using available strike liquidity.
    /// @dev Calls `_updateStrike(strike)` before modifying strike utilization (LU) to keep
    ///      reward-per-share accounting correct for LPs at this strike.
    ///      Mints a contract NFT and updates the user’s rent in CollateralPool.
    /// @param _isCall True for call contract, false for put contract.
    /// @param _strikeIndex Index returned by `getIntervals()` selecting the strike bucket.
    /// @param _amount Contract size (token decimals).
    function openContract(bool _isCall, uint256 _strikeIndex, uint256 _amount) external {
        require(_amount > 1e2, "_amount too low");
        require(_strikeIndex < _INTERVALLENGTH / 2, "Wrong Strike Index");

        // Intervals Check
        uint256[] memory intervals = getIntervals();        

        // Get infos
        uint256 strike;
        uint256 amount;
        uint256 availableLiquidity;
        uint256 rent;
        if (_isCall) {
            strike = intervals[_strikeIndex + (_INTERVALLENGTH / 2)];        
            amount = tokenATo18(_amount);
            availableLiquidity = _strikeToInfos[strike].callLP - _strikeToInfos[strike].callLU - (_strikeToInfos[strike].callLR*1e18)/strike;
            rent = ((((amount*strike)/1e18)*_YIELD)/1e18)/31536000;
        } else {
            strike = intervals[_strikeIndex];
            amount = tokenBTo18(_amount);
            availableLiquidity = _strikeToInfos[strike].putLP - _strikeToInfos[strike].putLU - (_strikeToInfos[strike].putLR*strike)/1e18;
            rent = ((amount*_YIELD)/1e18)/31536000;
        }

        // Security
        require(rent > 0, "Rent too low");
        require(ICollateralPool(IMain(_MAIN).getCollateralPool()).canOpenContract(msg.sender, rent), "No enough collateral");
        require(amount <= availableLiquidity, "No enough liquidity");

        // Strike Update
        _updateStrike(strike);

        // Update Liquidity Usage after checks
        if (_isCall == true) {
            _strikeToInfos[strike].callLU += amount;
        } else {
            _strikeToInfos[strike].putLU += amount;
        }

        // Set Contract
        ContractInfos memory newContract = ContractInfos(_isCall, strike, amount, rent, block.timestamp);
        _contractIdToInfos[_contractCount] = newContract;
        IERC721x(_ERC721_CONTRACT).mint(msg.sender, _contractCount);

        // Update CollateralPool
        ICollateralPool(IMain(_MAIN).getCollateralPool()).updateUserInfos(msg.sender, true, rent, block.timestamp);

        // Emit the contract opened event
        emit ContractOpened(msg.sender, _isCall, _amount, strike, _contractCount);

        _contractCount++;
    }

    
    /// @notice Closes an existing option contract and settles it against the current price.
    /// @dev Calls `_updateStrike(strike)` before modifying strike utilization (LU) to ensure
    ///      LP rewards remain correctly accounted.
    ///      Burns the contract NFT and updates the user’s rent in CollateralPool.
    /// @param _id The contract NFT id.
    function closeContract(uint256 _id) external {
        require(msg.sender == IERC721x(_ERC721_CONTRACT).ownerOf(_id), "You are not the owner");

        // Get Infos
        ContractInfos memory userContract = _contractIdToInfos[_id];
        address contractOwner = IERC721x(_ERC721_CONTRACT).ownerOf(_id);
        uint256 currentPrice = getPrice();

        // Strike Update
        _updateStrike(userContract.strike);

        // Call or Put ?
        if (userContract.isCall) {

            // if contract ITM, then pay strike x amount and receive amount (token call), else nothing
            if (currentPrice > userContract.strike) {
                IERC20x(_TOKENB).transferFrom(msg.sender, address(this), toTokenBDecimals((userContract.strike * userContract.amount)/1e18));
                IERC20x(_TOKENA).transfer(msg.sender, toTokenADecimals(userContract.amount));
                _strikeToInfos[userContract.strike].callLR += (userContract.strike * userContract.amount)/1e18;
            }

            _strikeToInfos[userContract.strike].callLU -= userContract.amount;

        } else {

            // if contract ITM, then pay amount (token Put) and receive strike x amount, else nothing
            if (currentPrice < userContract.strike) {
                IERC20x(_TOKENA).transferFrom(msg.sender, address(this), toTokenADecimals((userContract.amount * 1e18)/userContract.strike));
                IERC20x(_TOKENB).transfer(msg.sender, toTokenBDecimals(userContract.amount));
                _strikeToInfos[userContract.strike].putLR += (userContract.amount * 1e18)/userContract.strike;
                
            }

            _strikeToInfos[userContract.strike].putLU -= userContract.amount;

        }

        // Update CollateralPool
        ICollateralPool(IMain(_MAIN).getCollateralPool()).updateUserInfos(contractOwner, false, userContract.rent, block.timestamp);

        // Burn the contract token and emit the event
        IERC721x(_ERC721_CONTRACT).burn(_id);
        emit ContractClosed(contractOwner, _id, userContract.amount);        
    }

    /// @notice Liquidates an undercollateralized contract on behalf of CollateralPool.
    /// @dev Only callable by CollateralPool. Calls `_updateStrike(strike)` before changing strike utilization (LU)
    ///      to preserve correct accumulator accounting, then settles and burns the contract NFT and updates rent.
    /// @param _id The contract NFT id.
    /// @param _liquidator The address performing liquidation (used for settlement flows if applicable).
    function liquidateContract(uint256 _id, address _liquidator) external {
        require(msg.sender == IMain(_MAIN).getCollateralPool() , "Only Collateral Pool");
        require(_liquidator != address(0), "Bad liquidator");

        // Get Infos
        ContractInfos memory userContract = _contractIdToInfos[_id];
        address contractOwner = IERC721x(_ERC721_CONTRACT).ownerOf(_id);
        uint256 currentPrice = getPrice();

        // Strike Update
        _updateStrike(userContract.strike);

        // Call or Put ?
        if (userContract.isCall) {

            // if contract ITM, then pay strike x amount and receive amount (token call), else nothing
            if (currentPrice > userContract.strike) {
                IERC20x(_TOKENB).transferFrom(_liquidator, address(this), toTokenBDecimals((userContract.strike * userContract.amount)/1e18));
                IERC20x(_TOKENA).transfer(_liquidator, toTokenADecimals(userContract.amount));
                _strikeToInfos[userContract.strike].callLR += (userContract.strike * userContract.amount)/1e18;
            }

            _strikeToInfos[userContract.strike].callLU -= userContract.amount;

        } else {

            // if contract ITM, then pay amount (token Put) and receive strike x amount, else nothing
            if (currentPrice < userContract.strike) {
                IERC20x(_TOKENA).transferFrom(_liquidator, address(this), toTokenADecimals((userContract.amount * 1e18)/userContract.strike));
                IERC20x(_TOKENB).transfer(_liquidator, toTokenBDecimals(userContract.amount));
                _strikeToInfos[userContract.strike].putLR += (userContract.amount * 1e18)/userContract.strike;
                
            }

            _strikeToInfos[userContract.strike].putLU -= userContract.amount;

        }

        // Update CollateralPool
        ICollateralPool(IMain(_MAIN).getCollateralPool()).updateUserInfos(contractOwner, false, userContract.rent, block.timestamp);

        // Burn the contract token and emit the event
        IERC721x(_ERC721_CONTRACT).burn(_id);
        emit ContractClosed(contractOwner, _id, userContract.amount);        
    }

    /// @notice Realizes and returns rewards for a given LP position.
    /// @dev Callable only by the CollateralPool. Updates the strike accumulator via `_updateStrike()`
    ///      then computes rewards in O(1) using the reward-per-share model and updates the position’s
    ///      `rewardDebt` to the latest accumulated value.
    ///      This function does not transfer tokens; it returns the reward amount for CollateralPool to distribute.
    /// @param _id The LP position NFT id.
    /// @return rewards The realized rewards for this position (18 decimals).
    function claimRewards(uint256 _id) external returns(uint256) {
        require(msg.sender == IMain(_MAIN).getCollateralPool() , "Only Collateral Pool");

        // Get infos
        LpInfos memory thisLP = _lpIdToInfos[_id];

        // Update Strike
        _updateStrike(thisLP.strike);        

        uint256 acc = thisLP.isCall ? _strikeToInfos[thisLP.strike].accCallPerShare : _strikeToInfos[thisLP.strike].accPutPerShare;
        uint256 accumulated = (thisLP.amount * acc) / 1e18;
        uint256 rewards = accumulated - thisLP.rewardDebt;

        // Update LP Infos
        _lpIdToInfos[_id].rewardDebt = accumulated;

        return rewards;
    }
    
}
