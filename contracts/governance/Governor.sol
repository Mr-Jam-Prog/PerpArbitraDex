// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorSettings} from "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorTimelockControl} from "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

/**
 * @title PerpDexGovernor
 * @notice Governance contract for PerpArbitraDEX
 * @dev Extends OpenZeppelin Governor with all necessary extensions
 */
contract PerpDexGovernor is 
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    // ============ CONSTRUCTOR ============
    constructor(
        string memory name,
        IVotes _token,
        TimelockController _timelock,
        uint256 _votingDelay,
        uint256 _votingPeriod,
        uint256 _proposalThreshold,
        uint256 _quorumPercentage
    )
        Governor(name)
        GovernorSettings(_votingDelay, _votingPeriod, _proposalThreshold)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(_quorumPercentage)
        GovernorTimelockControl(_timelock)
    {
        require(_quorumPercentage > 0 && _quorumPercentage <= 100, "Invalid quorum");
    }

    // ============ OVERRIDES ============

    function votingDelay()
        public
        view
        override(IGovernor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(IGovernor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber)
        public
        view
        override(IGovernor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    // ============ PROPOSAL EXECUTION ============

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    // ============ SUPPORTS INTERFACE ============

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ============ EMERGENCY FUNCTIONS ============

    /**
     * @notice Emergency cancel proposal (guardian only)
     * @param proposalId Proposal ID to cancel
     */
    function emergencyCancel(uint256 proposalId) external {
        // Only timelock guardian can emergency cancel
        require(
            TimelockController(payable(timelock())).hasRole(
                keccak256("GUARDIAN_ROLE"),
                msg.sender
            ),
            "Only guardian"
        );
        
        // Cancel proposal
        ProposalState currentState = state(proposalId);
        require(
            currentState == ProposalState.Queued,
            "Proposal not queued"
        );
        
        // Get proposal details
        (
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            bytes32 descriptionHash
        ) = getProposalParameters(proposalId);
        
        // Cancel via timelock
        TimelockController(payable(timelock())).cancel(
            timelock().hashOperationBatch(
                targets,
                values,
                calldatas,
                bytes32(0),
                descriptionHash
            )
        );
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get proposal parameters
     * @param proposalId Proposal ID
     */
    function getProposalParameters(uint256 proposalId)
        public
        view
        returns (
            address[] memory targets,
            uint256[] memory values,
            bytes[] memory calldatas,
            bytes32 descriptionHash
        )
    {
        return (
            getProposalTargets(proposalId),
            getProposalValues(proposalId),
            getProposalCalldatas(proposalId),
            proposalDescriptionHash(proposalId)
        );
    }

    /**
     * @notice Check if proposal is executable
     * @param proposalId Proposal ID
     * @return executable True if executable
     */
    function isExecutable(uint256 proposalId) external view returns (bool) {
        return state(proposalId) == ProposalState.Queued;
    }

    /**
     * @notice Get proposal voting power
     * @param proposalId Proposal ID
     * @return forVotes Votes for
     * @return againstVotes Votes against
     * @return abstainVotes Votes abstain
     */
    function getProposalVotes(uint256 proposalId)
        external
        view
        returns (uint256 forVotes, uint256 againstVotes, uint256 abstainVotes)
    {
        ProposalVote memory vote = proposalVotes(proposalId);
        return (vote.forVotes, vote.againstVotes, vote.abstainVotes);
    }
}