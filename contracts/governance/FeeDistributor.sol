// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title FeeDistributor
 * @notice Distributes protocol fees to stakeholders
 * @dev Supports multiple recipient groups with configurable shares
 */
contract FeeDistributor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ STRUCTS ============
    struct Recipient {
        address account;
        uint256 share; // 1e18 = 100%
        uint256 claimed;
        bool active;
    }

    struct Distribution {
        uint256 totalAmount;
        uint256 distributedAmount;
        uint256 timestamp;
        bool completed;
    }

    // ============ CONSTANTS ============
    uint256 public constant SHARE_SCALE = 1e18;
    uint256 public constant MAX_SHARE = 0.8e18; // 80% max per recipient

    // ============ STATE VARIABLES ============
    IERC20 public immutable quoteToken;
    address public immutable treasury;
    
    Recipient[] public recipients;
    mapping(uint256 => Distribution) public distributions;
    mapping(address => uint256) public lastClaimTime;
    
    uint256 public totalShares;
    uint256 public distributionCounter;
    uint256 public claimCooldown = 1 days;

    // ============ EVENTS ============
    event RecipientAdded(address indexed account, uint256 share);
    event RecipientUpdated(address indexed account, uint256 oldShare, uint256 newShare);
    event RecipientRemoved(address indexed account);
    event FeesCollected(uint256 amount, uint256 distributionId);
    event FeesDistributed(uint256 distributionId, uint256 amount);
    event Claimed(address indexed account, uint256 amount, uint256 distributionId);
    event ClaimCooldownUpdated(uint256 oldCooldown, uint256 newCooldown);

    // ============ MODIFIERS ============
    modifier onlyTreasury() {
        require(msg.sender == treasury, "Only treasury");
        _;
    }

    modifier validShare(uint256 share) {
        require(share <= MAX_SHARE, "Share too high");
        require(share > 0, "Invalid share");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(address _quoteToken, address _treasury) {
        require(_quoteToken != address(0), "Invalid quote token");
        require(_treasury != address(0), "Invalid treasury");
        
        quoteToken = IERC20(_quoteToken);
        treasury = _treasury;
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Collect fees from treasury
     * @param amount Amount to collect
     */
    function collectFees(uint256 amount) external onlyTreasury nonReentrant {
        require(amount > 0, "Invalid amount");
        require(recipients.length > 0, "No recipients configured");
        require(totalShares == SHARE_SCALE, "Shares not 100%");
        
        // Transfer from treasury
        quoteToken.safeTransferFrom(treasury, address(this), amount);
        
        // Create distribution
        distributionCounter++;
        distributions[distributionCounter] = Distribution({
            totalAmount: amount,
            distributedAmount: 0,
            timestamp: block.timestamp,
            completed: false
        });
        
        emit FeesCollected(amount, distributionCounter);
    }

    /**
     * @notice Claim fees for a recipient
     * @param distributionId Distribution ID to claim from
     */
    function claim(uint256 distributionId) external nonReentrant {
        require(distributionId <= distributionCounter, "Invalid distribution");
        require(distributionId > 0, "Invalid distribution");
        
        Distribution storage distribution = distributions[distributionId];
        require(!distribution.completed, "Distribution completed");
        
        // Find recipient
        uint256 recipientIndex = _findRecipientIndex(msg.sender);
        require(recipientIndex != type(uint256).max, "Not a recipient");
        
        Recipient storage recipient = recipients[recipientIndex];
        require(recipient.active, "Recipient inactive");
        
        // Check cooldown
        require(
            block.timestamp >= lastClaimTime[msg.sender] + claimCooldown,
            "Claim cooldown"
        );
        
        // Calculate claimable amount
        uint256 claimableAmount = (distribution.totalAmount * recipient.share) / SHARE_SCALE;
        require(claimableAmount > 0, "Nothing to claim");
        
        // Update distribution
        distribution.distributedAmount += claimableAmount;
        recipient.claimed += claimableAmount;
        lastClaimTime[msg.sender] = block.timestamp;
        
        // Check if distribution is complete
        if (distribution.distributedAmount >= distribution.totalAmount) {
            distribution.completed = true;
            emit FeesDistributed(distributionId, distribution.totalAmount);
        }
        
        // Transfer tokens
        quoteToken.safeTransfer(msg.sender, claimableAmount);
        
        emit Claimed(msg.sender, claimableAmount, distributionId);
    }

    /**
     * @notice Claim fees for multiple distributions
     * @param distributionIds Array of distribution IDs
     */
    function claimMultiple(uint256[] calldata distributionIds) external nonReentrant {
        require(distributionIds.length > 0, "No distributions");
        
        uint256 recipientIndex = _findRecipientIndex(msg.sender);
        require(recipientIndex != type(uint256).max, "Not a recipient");
        
        Recipient storage recipient = recipients[recipientIndex];
        require(recipient.active, "Recipient inactive");
        
        // Check cooldown
        require(
            block.timestamp >= lastClaimTime[msg.sender] + claimCooldown,
            "Claim cooldown"
        );
        
        uint256 totalClaimable = 0;
        
        for (uint256 i = 0; i < distributionIds.length; i++) {
            uint256 distributionId = distributionIds[i];
            require(distributionId <= distributionCounter, "Invalid distribution");
            require(distributionId > 0, "Invalid distribution");
            
            Distribution storage distribution = distributions[distributionId];
            if (distribution.completed) continue;
            
            uint256 claimableAmount = (distribution.totalAmount * recipient.share) / SHARE_SCALE;
            totalClaimable += claimableAmount;
            
            distribution.distributedAmount += claimableAmount;
            if (distribution.distributedAmount >= distribution.totalAmount) {
                distribution.completed = true;
                emit FeesDistributed(distributionId, distribution.totalAmount);
            }
        }
        
        require(totalClaimable > 0, "Nothing to claim");
        
        recipient.claimed += totalClaimable;
        lastClaimTime[msg.sender] = block.timestamp;
        
        quoteToken.safeTransfer(msg.sender, totalClaimable);
        
        emit Claimed(msg.sender, totalClaimable, 0); // 0 for batch claim
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Add a new recipient
     * @param account Recipient address
     * @param share Share percentage (1e18 = 100%)
     */
    function addRecipient(address account, uint256 share) 
        external 
        onlyTreasury 
        validShare(share) 
    {
        require(account != address(0), "Invalid account");
        require(_findRecipientIndex(account) == type(uint256).max, "Already recipient");
        require(totalShares + share <= SHARE_SCALE, "Exceeds 100%");
        
        recipients.push(Recipient({
            account: account,
            share: share,
            claimed: 0,
            active: true
        }));
        
        totalShares += share;
        
        emit RecipientAdded(account, share);
    }

    /**
     * @notice Update recipient share
     * @param account Recipient address
     * @param newShare New share percentage
     */
    function updateRecipient(address account, uint256 newShare) 
        external 
        onlyTreasury 
        validShare(newShare) 
    {
        uint256 index = _findRecipientIndex(account);
        require(index != type(uint256).max, "Not a recipient");
        
        Recipient storage recipient = recipients[index];
        uint256 oldShare = recipient.share;
        
        require(totalShares - oldShare + newShare <= SHARE_SCALE, "Exceeds 100%");
        
        totalShares = totalShares - oldShare + newShare;
        recipient.share = newShare;
        
        emit RecipientUpdated(account, oldShare, newShare);
    }

    /**
     * @notice Remove recipient
     * @param account Recipient address
     */
    function removeRecipient(address account) external onlyTreasury {
        uint256 index = _findRecipientIndex(account);
        require(index != type(uint256).max, "Not a recipient");
        
        Recipient storage recipient = recipients[index];
        require(recipient.active, "Already inactive");
        
        totalShares -= recipient.share;
        recipient.active = false;
        
        emit RecipientRemoved(account);
    }

    /**
     * @notice Update claim cooldown
     * @param newCooldown New cooldown in seconds
     */
    function updateClaimCooldown(uint256 newCooldown) external onlyTreasury {
        require(newCooldown <= 7 days, "Cooldown too long");
        
        emit ClaimCooldownUpdated(claimCooldown, newCooldown);
        claimCooldown = newCooldown;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get claimable amount for a recipient
     * @param account Recipient address
     * @param distributionId Distribution ID
     * @return claimableAmount Claimable amount
     */
    function getClaimable(address account, uint256 distributionId) 
        external 
        view 
        returns (uint256) 
    {
        if (distributionId == 0 || distributionId > distributionCounter) return 0;
        
        Distribution storage distribution = distributions[distributionId];
        if (distribution.completed) return 0;
        
        uint256 index = _findRecipientIndex(account);
        if (index == type(uint256).max) return 0;
        
        Recipient storage recipient = recipients[index];
        if (!recipient.active) return 0;
        
        return (distribution.totalAmount * recipient.share) / SHARE_SCALE;
    }

    /**
     * @notice Get total claimable across all distributions
     * @param account Recipient address
     * @return totalClaimable Total claimable amount
     */
    function getTotalClaimable(address account) external view returns (uint256) {
        uint256 index = _findRecipientIndex(account);
        if (index == type(uint256).max) return 0;
        
        Recipient storage recipient = recipients[index];
        if (!recipient.active) return 0;
        
        uint256 total = 0;
        for (uint256 i = 1; i <= distributionCounter; i++) {
            Distribution storage distribution = distributions[i];
            if (!distribution.completed) {
                total += (distribution.totalAmount * recipient.share) / SHARE_SCALE;
            }
        }
        
        return total;
    }

    /**
     * @notice Get recipient count
     * @return count Number of recipients
     */
    function getRecipientCount() external view returns (uint256) {
        return recipients.length;
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Find recipient index by address
     * @param account Address to find
     * @return index Recipient index or max uint256 if not found
     */
    function _findRecipientIndex(address account) internal view returns (uint256) {
        for (uint256 i = 0; i < recipients.length; i++) {
            if (recipients[i].account == account && recipients[i].active) {
                return i;
            }
        }
        return type(uint256).max;
    }
}