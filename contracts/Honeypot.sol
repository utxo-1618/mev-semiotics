// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IDMAP.sol";
import "./SignalVault.sol";

/**
 * @title Honeypot
 * @notice A contract designed to bait and trap pre-consensus front-runners.
 * It appears to offer a profitable opportunity, but the profit can only be unlocked
 * if the caller also registers a specific signal hash via the DMAP contract,
 * thus forcing attribution. This is non-consensual yield attribution.
 */
contract Honeypot {
    IDMAP public immutable dmap;
    SignalVault public immutable vault;
    address public immutable beneficiary;
    
    // Track which bots have registered signals
    mapping(address => bytes32) public botSignals;
    mapping(bytes32 => bool) public signalUsed;

    event Trapped(address indexed frontrunner, bytes32 indexed signalHash, uint256 profit);
    event SignalRegistered(address indexed bot, bytes32 indexed signalHash);

    constructor(address _dmap, address _vault, address _beneficiary) {
        dmap = IDMAP(_dmap);
        vault = SignalVault(payable(_vault));
        beneficiary = _beneficiary;
        
        // Bootstrap trust - authorize honeypot on deploy
        SignalVault(payable(_vault)).authorizeTrapper(address(this));
    }

    /**
     * @notice Forces bot to register with DMAP before accessing semantic profit.
     * This creates the forced attribution mechanism described in the whitepaper.
     */
    function registerForProfit(bytes32 signalHash) external {
        // Bot must register the signal to themselves first
        bytes32 botSignalHash = dmap.registerSignal(
            string(abi.encodePacked("MEV_BOT_", signalHash)), 
            1 // MEV category
        );
        
        botSignals[msg.sender] = botSignalHash;
        signalUsed[signalHash] = true;
        emit SignalRegistered(msg.sender, botSignalHash);
    }
    
    /**
     * @notice The semantic profit mechanism - appears profitable in simulation.
     * Bot must have registered a signal first, creating the attribution link.
     */
    function captureSemanticProfit(bytes32 signalHash) external {
        // Verify signal ownership
        (address signalOwner, , ) = dmap.getSignal(signalHash);
        require(signalOwner == beneficiary, "Invalid signal owner");
        
        // Bot must have registered first - this is the trap
        require(botSignals[msg.sender] != bytes32(0), "Must register signal first");
        require(signalUsed[signalHash], "Signal not activated");
        
        // Calculate semantic yield (gas + complexity bonus)
        uint256 baseYield = tx.gasprice * gasleft();
        uint256 complexityBonus = uint256(keccak256(abi.encode(msg.sender, block.timestamp))) % 1000;
        uint256 totalYield = baseYield + complexityBonus;
        
        // Attest the yield - bot has now attributed value to beneficiary
        vault.attestYield(
            signalHash,
            msg.sender,
            totalYield,
            abi.encode(botSignals[msg.sender]) // Bot's signal as proof
        );
        
        // Reset to prevent reuse
        botSignals[msg.sender] = bytes32(0);
        
        emit Trapped(msg.sender, signalHash, totalYield);
    }
    
    /**
     * @notice Bait function that appears to offer profit in simulation.
     * This is what bots will see and simulate as profitable.
     */
    function simulateProfitablePath(bytes32 signalHash) external view returns (uint256) {
        // In simulation, this appears profitable
        if (botSignals[msg.sender] != bytes32(0) && signalUsed[signalHash]) {
            return 1000 + (uint256(keccak256(abi.encode(msg.sender))) % 9000);
        }
        return 0;
    }

}

