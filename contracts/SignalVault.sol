// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./IDMAP.sol";

// --- Interfaces ---

// LayerZero Interface
interface ILayerZeroEndpoint {
    function send(uint16 _dstChainId, bytes calldata _toAddress, bytes calldata _payload, address payable _refundAddress, address _zroPaymentAddress, bytes calldata _adapterParams) external payable;
}

/**
 * @title SignalVault
 * @notice Decentralized, non-custodial vault for MEV-correlated yield capture with advanced features.
 */
contract SignalVault is ReentrancyGuard, Ownable {

    // --- Events ---
    event YieldAttested(bytes32 indexed signalHash, address indexed frontrunner, uint256 yieldAmount, bool proofValid);
    event YieldHarvestedForSignal(address indexed emitter, bytes32 indexed signalHash, uint256 amount);
    event YieldClaimed(address indexed claimer, uint256 amount);
    event TrapperAuthorized(address indexed trapper, bool isAuthorized);
    event SimulationBait(bytes32 indexed signalHash, uint256 indexed blockNumber, uint256 projectedYield);
    event GasConversionFactorUpdated(uint256 oldFactor, uint256 newFactor);
    event MarginUpdated(uint256 oldMargin, uint256 newMargin);
    
    // --- MEV Simulation Constants ---
    uint256 private constant SIMULATION_MULTIPLIER = 1618; // phi * 1000 for fixed-point
    uint256 private constant RECURSIVE_DEPTH_LIMIT = 5;   // Max recursive trap depth
    
    // --- Gas-to-ETH Conversion ---
    uint256 private gasUnitToEth = 1e9; // Default: 1 gwei of gas = 1 nano ETH
    uint256 private marginBasisPoints = 0; // Default: 0% margin (100 bp = 1%)

    // --- Structs ---
    struct Signal {
        address emitter;
        uint256 blockEmitted;
    }

    // --- Constants ---

    // --- State ---
    IDMAP public immutable dmap;
    mapping(bytes32 => Signal) public signals;
    mapping(bytes32 => uint256) public signalYield;  // Track yield per signal hash
    mapping(bytes32 => bool) public isYieldAttested; // Prevent duplicate attestations
    mapping(address => uint256) public harvestedYield;
    mapping(address => bool) public authorizedTrappers;
    
    // Gas-optimized packed structs (32-byte aligned)
    struct PackedSignal {
        address emitter;     // 20 bytes
        uint32 blockNumber; // 4 bytes
        uint8 flags;        // 1 byte
        bytes7 reserved;    // 7 bytes padding for future use
    } // Total: 32 bytes
    
    // --- LayerZero State ---
    ILayerZeroEndpoint public layerZeroEndpoint;
    mapping(uint16 => bytes) public remoteAddress;

    // --- Constructor ---
constructor(address _dmap, address initialOwner) {
        _transferOwnership(initialOwner);
        dmap = IDMAP(_dmap);
    }

    // --- Core Logic ---

    modifier onlyAuthorizedTrapper() {
        require(authorizedTrappers[msg.sender], "Not authorized trapper");
        _;
    }

    function attestYield(
        bytes32 signalHash,
        address frontrunner,
        uint256 yieldAmount,
        bytes calldata signature
    ) external onlyAuthorizedTrapper {
        
        // Emit simulation bait before core logic - this is what MEV bots will see first
        // Check for overflow before multiplication
        require(yieldAmount <= type(uint256).max / SIMULATION_MULTIPLIER, "Yield overflow");
        uint256 projectedYield = (yieldAmount * SIMULATION_MULTIPLIER) / 1000;
        emit SimulationBait(signalHash, block.number, projectedYield);
        require(frontrunner != address(0), "Invalid frontrunner address");
        require(yieldAmount > 0, "Yield amount must be positive");
        // Allow multiple attestations per signal for cumulative yield

        (address signalOwner, ,) = dmap.getSignal(signalHash);
        require(signalOwner != address(0), "Signal does not exist");

        // Attribution Proof Verification with Ethereum Signed Message prefix
        bytes32 messageHash = keccak256(abi.encodePacked(signalHash, frontrunner, yieldAmount));
        bytes32 ethSignedMessageHash = ECDSA.toEthSignedMessageHash(messageHash);
        address signer = ECDSA.recover(ethSignedMessageHash, signature);
        bool proofValid = (signer == signalOwner);

        // Update yield tracking per signal hash and total yield
        signalYield[signalHash] += yieldAmount;
        harvestedYield[signalOwner] += yieldAmount;
        // Remove isYieldAttested[signalHash] = true; to allow multiple attestations
        _updateTotalYield(yieldAmount, true); // Increase total yield
        
        emit YieldAttested(signalHash, frontrunner, yieldAmount, proofValid);
    }

    function harvestYield(bytes32[] calldata hashes) external nonReentrant {
        require(hashes.length > 0, "No signals provided");
        uint256 totalHarvest = 0;

        for (uint i = 0; i < hashes.length; i++) {
            bytes32 hash = hashes[i];
            (address signalOwner, ,) = dmap.getSignal(hash);
            require(signalOwner == msg.sender, "Not your signal");

            // Get yield specific to this signal hash
            uint256 yield = signalYield[hash];
            require(yield > 0, "No yield for signal");

            // Clear signal yield and add to total
            signalYield[hash] = 0;
            totalHarvest += yield;

            // Emit per-signal harvest event for better traceability
            emit YieldHarvestedForSignal(msg.sender, hash, yield);
        }

        // Update harvested yield tracking
        harvestedYield[msg.sender] += totalHarvest;
    }

    function withdrawYield(uint256 amount) external nonReentrant {
        uint256 userYield = harvestedYield[msg.sender];
        require(userYield >= amount, "Insufficient yield");

        harvestedYield[msg.sender] -= amount;
        _updateTotalYield(amount, false); // Decrease total yield
        
        // Convert gas metrics to ETH value with margin adjustment
        uint256 ethValue = _convertGasToETH(amount);
        require(address(this).balance >= ethValue, "Insufficient contract balance");
        
        (bool success, ) = msg.sender.call{value: ethValue, gas: 30000}("");
        require(success, "Transfer failed");
        emit YieldClaimed(msg.sender, amount);
    }

    // --- Autonomous Functions ---
    
    // --- LayerZero Functions ---
    function setLayerZeroEndpoint(address _layerZeroEndpoint) external onlyOwner {
        layerZeroEndpoint = ILayerZeroEndpoint(_layerZeroEndpoint);
    }

    function setRemote(uint16 _dstChainId, bytes calldata _remoteAddress) external onlyOwner {
        remoteAddress[_dstChainId] = _remoteAddress;
    }

    // --- LayerZero Send Parameters ---
    struct CrossChainParams {
        uint16 dstChainId;
        address toAddress;
        uint256 amount;
        bytes adapterParams;
    }

    function withdrawYieldToChain(
        CrossChainParams calldata params
    ) external payable nonReentrant {
        // Pre-flight validation
        require(remoteAddress[params.dstChainId].length != 0, "Destination chain not supported");
        require(params.toAddress != address(0), "Invalid destination address");
        require(params.amount > 0, "Amount must be positive");
        
        // Validate user yield and update state before external calls
        uint256 userYield = harvestedYield[msg.sender];
        require(userYield >= params.amount, "Insufficient yield");
        harvestedYield[msg.sender] -= params.amount;
        _updateTotalYield(params.amount, false); // Decrease total yield

        // Cache LayerZero endpoint to prevent potential manipulation
        ILayerZeroEndpoint endpoint = layerZeroEndpoint;
        require(address(endpoint) != address(0), "LZ endpoint not configured");

        // Prepare cross-chain message with minimum payload size
        bytes memory payload = abi.encode(
            msg.sender,    // Original sender for attribution
            params.amount  // Amount being bridged
        );

        // Convert gas metrics to ETH value with margin for cross-chain transfer
        uint256 ethValue = _convertGasToETH(params.amount);
        require(address(this).balance >= ethValue + msg.value, "Insufficient balance for transfer and fees");
        
        // Attempt LayerZero send with failure recovery
        try endpoint.send{
            value: ethValue + msg.value  // Send converted value + LZ fees
        }(
            params.dstChainId,
            abi.encodePacked(params.toAddress),
            payload,
            payable(msg.sender),  // Refund address for unused LZ fees
            address(0),           // No zroPaymentAddress needed
            params.adapterParams  // Allow custom LZ adapter params
        ) {
            // Success case: event emitted, state updated
            emit YieldClaimed(msg.sender, params.amount);
        } catch Error(string memory reason) {
            // Revert state changes on LZ failure
            harvestedYield[msg.sender] += params.amount;
            _updateTotalYield(params.amount, true); // Restore total yield
            revert(string(abi.encodePacked("LZ send failed: ", reason)));
        } catch {
            // Generic LZ failure
            harvestedYield[msg.sender] += params.amount;
            _updateTotalYield(params.amount, true); // Restore total yield
            revert("LZ send failed");
        }
    }

    // --- Admin ---
    function setAuthorizedTrapper(address trapper, bool authorized) external onlyOwner {
        require(trapper != address(0), "Invalid trapper address");
        authorizedTrappers[trapper] = authorized;
        emit TrapperAuthorized(trapper, authorized);
    }
    
    // Public function for Honeypot self-authorization on deployment
    function authorizeTrapper(address trapper) external {
        require(trapper != address(0), "Invalid trapper address");
        require(msg.sender == trapper, "Can only self-authorize");
        authorizedTrappers[trapper] = true;
        emit TrapperAuthorized(trapper, true);
    }
    
    // Update gas-to-ETH conversion factor
    function setGasConversionFactor(uint256 newFactor) external onlyOwner {
        require(newFactor > 0, "Conversion factor must be positive");
        uint256 oldFactor = gasUnitToEth;
        gasUnitToEth = newFactor;
        emit GasConversionFactorUpdated(oldFactor, newFactor);
    }
    
    // Update margin basis points (100 bp = 1%)
    function setMarginBasisPoints(uint256 newMargin) external onlyOwner {
        require(newMargin <= 10000, "Margin cannot exceed 100%");
        uint256 oldMargin = marginBasisPoints;
        marginBasisPoints = newMargin;
        emit MarginUpdated(oldMargin, newMargin);
    }
    
    // Get current gas-to-ETH conversion factor
    function getGasConversionFactor() public view returns (uint256) {
        return gasUnitToEth;
    }
    
    // Get current margin basis points
    function getMarginBasisPoints() public view returns (uint256) {
        return marginBasisPoints;
    }
    
    // Internal function to convert gas to ETH with margin
    function _convertGasToETH(uint256 gasAmount) internal view returns (uint256) {
        // Base conversion
        uint256 baseETH = gasAmount / gasUnitToEth;
        
        // Apply margin if set (reduces payout to users)
        if (marginBasisPoints > 0) {
            uint256 marginReduction = (baseETH * marginBasisPoints) / 10000;
            return baseETH > marginReduction ? baseETH - marginReduction : 0;
        }
        
        return baseETH;
    }
    
    // View function to preview conversion
    function previewGasToETHConversion(uint256 gasAmount) external view returns (uint256) {
        return _convertGasToETH(gasAmount);
    }


// Track total yield for emergency sweep safety
    uint256 private _totalYield;

    function getTotalHarvestedYield() public view returns (uint256) {
        return _totalYield;
    }

    // Update total yield tracking in core functions
    function _updateTotalYield(uint256 amount, bool increase) internal {
        if (increase) {
            _totalYield += amount;
        } else {
            _totalYield = amount >= _totalYield ? 0 : _totalYield - amount;
        }
    }
    
    // --- Receive Ether ---
    receive() external payable {}
}

