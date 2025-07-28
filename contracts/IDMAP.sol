// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDMAP {
    function registerSignal(string calldata description, uint256 categoryId) external returns (bytes32);
    function getSignal(bytes32 hash) external view returns (address owner, string memory description, uint256 categoryId);
}
