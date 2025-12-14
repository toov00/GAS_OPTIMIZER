// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title Inefficient Contract
 * @notice This contract contains intentional gas inefficiencies for testing the analyzer
 */
contract Inefficient {
    // Not using constant for fixed value
    uint256 public MAX_SUPPLY = 10000;
    
    // Not using immutable for address set in constructor
    address public owner;
    
    // Poor storage packing - wastes slots
    uint128 public valueA;      // Slot 0 (16 bytes)
    uint256 public valueB;      // Slot 1 (32 bytes) 
    uint128 public valueC;      // Slot 2 (16 bytes) - could pack with valueA!
    bool public isActive;       // Slot 3 (1 byte) - could pack!
    uint64 public timestamp;    // Slot 4 (8 bytes) - could pack!
    
    // State arrays
    uint256[] public items;
    mapping(address => uint256) public balances;
    
    // Custom struct
    struct User {
        uint256 id;
        address wallet;
        uint128 balance;
        bool active;
    }
    
    User[] public users;

    constructor() {
        owner = msg.sender;
    }

    // Uses memory instead of calldata for external function
    function processData(uint256[] memory data) external pure returns (uint256) {
        uint256 sum = 0;  // Unnecessary zero initialization
        for (uint256 i = 0; i < data.length; i++) {  // i++ instead of ++i
            sum += data[i];
        }
        return sum;
    }

    // Multiple gas inefficiencies
    function inefficientLoop() external {
        // Reading items.length from storage on each iteration
        for (uint256 i = 0; i < items.length; i++) {  // No unchecked increment
            // Process item
            uint256 value = items[i];
            if (value > 0) {  // Could use != 0
                balances[msg.sender] += value;
            }
        }
    }

    // Uses require with string instead of custom error
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(amount > 0, "Amount must be positive");  // Also > 0 instead of != 0
        
        balances[msg.sender] -= amount;
        
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    // Division by power of 2 without using shift
    function calculateFee(uint256 amount) public pure returns (uint256) {
        return amount / 4;  // Could use >> 2
    }

    // Multiplication by power of 2 without using shift
    function doubleValue(uint256 value) public pure returns (uint256) {
        return value * 2;  // Could use << 1
    }

    // Postfix increment outside loop
    function incrementCounter(uint256 counter) public pure returns (uint256) {
        counter++;  // Could use ++counter or counter += 1
        return counter;
    }

    // Expensive operation first in condition
    function checkConditions(address user) external view returns (bool) {
        // Expensive storage read before cheap comparison
        if (balances[user] > 0 && user != address(0)) {
            return true;
        }
        return false;
    }

    // Long addition instead of increment
    function addOne(uint256 x) public pure returns (uint256) {
        x = x + 1;  // Could use ++x
        return x;
    }

    // Better version for comparison
    function efficientLoop() external {
        uint256 len = items.length;  // Cached length
        for (uint256 i = 0; i < len; ) {
            uint256 value = items[i];
            if (value != 0) {  // Using != 0
                balances[msg.sender] += value;
            }
            unchecked { ++i; }  // Unchecked increment
        }
    }

    // Accept ETH
    receive() external payable {}
}

// Example of well-optimized contract for comparison
contract Optimized {
    // Using constant
    uint256 public constant MAX_SUPPLY = 10000;
    
    // Using immutable
    address public immutable owner;
    
    // Proper storage packing
    uint128 public valueA;      // Slot 0 (16 bytes)
    uint128 public valueC;      // Slot 0 (16 bytes) - packed!
    uint64 public timestamp;    // Slot 1 (8 bytes)
    bool public isActive;       // Slot 1 (1 byte) - packed!
    uint256 public valueB;      // Slot 2 (32 bytes)
    
    uint256[] public items;
    mapping(address => uint256) public balances;

    // Custom error
    error InsufficientBalance(uint256 available, uint256 required);
    error ZeroAmount();
    error TransferFailed();

    constructor() {
        owner = msg.sender;
    }

    // Using calldata
    function processData(uint256[] calldata data) external pure returns (uint256) {
        uint256 sum;  // No initialization
        uint256 len = data.length;
        for (uint256 i; i < len; ) {
            sum += data[i];
            unchecked { ++i; }
        }
        return sum;
    }

    // Using custom errors and bit shifts
    function withdraw(uint256 amount) external {
        uint256 balance = balances[msg.sender];  // Cache storage
        if (balance < amount) revert InsufficientBalance(balance, amount);
        if (amount == 0) revert ZeroAmount();  // Using == 0
        
        balances[msg.sender] = balance - amount;
        
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    // Using bit shift
    function calculateFee(uint256 amount) public pure returns (uint256) {
        return amount >> 2;  // Efficient division by 4
    }

    receive() external payable {}
}
