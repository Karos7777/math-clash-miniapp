// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Escrow
/// @notice Testnet MVP escrow for a two-player ETH poker table on Base Sepolia.
/// @dev Card dealing is intentionally off-chain in this prototype and is not fully trustless yet.
contract Escrow {
    uint256 public constant ACTION_TIMEOUT = 60 seconds;
    uint256 public constant DEVELOPER_FEE_BPS = 200;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum Stage {
        Waiting,
        Confirming,
        Preflop,
        Flop,
        Turn,
        River,
        Showdown,
        Finished
    }

    struct Table {
        bool exists;
        address player1;
        address player2;
        uint256 stake;
        uint256 pot;
        Stage stage;
        address turn;
        uint256 actionDeadline;
        uint256 currentBet;
        uint8 actionsThisStage;
        bool confirmed1;
        bool confirmed2;
        address winner;
        bool refunded;
    }

    address public owner;
    address public feeRecipient;
    uint256 public defaultStake;
    bool public paused;
    bool private locked;

    mapping(bytes32 => Table) private tables;
    mapping(bytes32 => mapping(address => address)) public playerResult;
    mapping(address => uint256) public pendingWithdrawals;

    event TableJoined(bytes32 indexed tableId, address indexed player, uint256 stake);
    event TableReady(bytes32 indexed tableId, address indexed player1, address indexed player2, uint256 pot);
    event PlayerConfirmed(bytes32 indexed tableId, address indexed player);
    event StageChanged(bytes32 indexed tableId, Stage stage, address turn, uint256 actionDeadline);
    event PlayerChecked(bytes32 indexed tableId, address indexed player);
    event PlayerBet(bytes32 indexed tableId, address indexed player, uint256 amount);
    event PlayerCalled(bytes32 indexed tableId, address indexed player, uint256 amount);
    event PlayerFolded(bytes32 indexed tableId, address indexed player, address indexed winner);
    event PlayerTimedOut(bytes32 indexed tableId, address indexed inactivePlayer, address indexed winner);
    event ResultSubmitted(bytes32 indexed tableId, address indexed player, address indexed winner);
    event TableSettled(bytes32 indexed tableId, address indexed winner, uint256 payout, uint256 developerFee);
    event TableRefunded(bytes32 indexed tableId, uint256 refundPerPlayer);
    event WinningsClaimed(address indexed player, uint256 amount);
    event FeeRecipientUpdated(address indexed feeRecipient);
    event DefaultStakeUpdated(uint256 defaultStake);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialFeeRecipient, uint256 initialDefaultStake) {
        require(initialFeeRecipient != address(0), "Fee recipient required");
        require(initialDefaultStake > 0, "Stake required");

        owner = msg.sender;
        feeRecipient = initialFeeRecipient;
        defaultStake = initialDefaultStake;

        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientUpdated(initialFeeRecipient);
        emit DefaultStakeUpdated(initialDefaultStake);
    }

    function joinTable(bytes32 tableId) external payable whenNotPaused nonReentrant {
        require(tableId != bytes32(0), "Table id required");
        Table storage table = tables[tableId];

        if (!table.exists) {
            require(msg.value == defaultStake, "Bad stake");
            table.exists = true;
            table.player1 = msg.sender;
            table.stake = msg.value;
            table.pot = msg.value;
            table.stage = Stage.Waiting;
            emit TableJoined(tableId, msg.sender, msg.value);
            emit StageChanged(tableId, table.stage, address(0), 0);
            return;
        }

        require(table.stage == Stage.Waiting, "Table not joinable");
        require(table.player2 == address(0), "Table full");
        require(msg.sender != table.player1, "Already joined");
        require(msg.value == table.stake, "Stake mismatch");

        table.player2 = msg.sender;
        table.pot += msg.value;
        table.stage = Stage.Confirming;
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;

        emit TableJoined(tableId, msg.sender, msg.value);
        emit TableReady(tableId, table.player1, table.player2, table.pot);
        emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
    }

    function confirm(bytes32 tableId) external whenNotPaused {
        Table storage table = _table(tableId);
        require(table.stage == Stage.Confirming, "Not confirming");
        require(block.timestamp <= table.actionDeadline, "Confirmation timed out");
        require(_isPlayer(table, msg.sender), "Not player");

        if (msg.sender == table.player1) {
            require(!table.confirmed1, "Already confirmed");
            table.confirmed1 = true;
        } else {
            require(!table.confirmed2, "Already confirmed");
            table.confirmed2 = true;
        }

        emit PlayerConfirmed(tableId, msg.sender);

        if (table.confirmed1 && table.confirmed2) {
            _startStage(tableId, table, Stage.Preflop, table.player1);
        }
    }

    function check(bytes32 tableId) external whenNotPaused {
        Table storage table = _activeTurnTable(tableId);
        require(table.currentBet == 0, "Call or fold");
        require(msg.sender == table.turn, "Not your turn");

        table.actionsThisStage += 1;
        emit PlayerChecked(tableId, msg.sender);

        if (table.actionsThisStage >= 2) {
            _advanceStage(tableId, table);
        } else {
            _passTurn(tableId, table);
        }
    }

    function bet(bytes32 tableId) external payable whenNotPaused nonReentrant {
        Table storage table = _activeTurnTable(tableId);
        require(msg.sender == table.turn, "Not your turn");
        require(table.currentBet == 0, "Bet already open");
        require(msg.value > 0, "Bet required");

        table.currentBet = msg.value;
        table.pot += msg.value;
        table.actionsThisStage = 1;
        table.turn = _opponent(table, msg.sender);
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;

        emit PlayerBet(tableId, msg.sender, msg.value);
        emit StageChanged(tableId, table.stage, table.turn, table.actionDeadline);
    }

    function call(bytes32 tableId) external payable whenNotPaused nonReentrant {
        Table storage table = _activeTurnTable(tableId);
        require(msg.sender == table.turn, "Not your turn");
        require(table.currentBet > 0, "No bet to call");
        require(msg.value == table.currentBet, "Call must match bet");

        table.pot += msg.value;
        table.currentBet = 0;
        table.actionsThisStage = 2;

        emit PlayerCalled(tableId, msg.sender, msg.value);
        _advanceStage(tableId, table);
    }

    function fold(bytes32 tableId) external whenNotPaused nonReentrant {
        Table storage table = _activeTurnTable(tableId);
        require(msg.sender == table.turn, "Not your turn");

        address winner = _opponent(table, msg.sender);
        emit PlayerFolded(tableId, msg.sender, winner);
        _settle(tableId, table, winner);
    }

    function timeout(bytes32 tableId) external whenNotPaused nonReentrant {
        Table storage table = _table(tableId);
        require(table.actionDeadline > 0, "No timeout");
        require(block.timestamp > table.actionDeadline, "Timeout not reached");

        if (table.stage == Stage.Confirming) {
            if (table.confirmed1 && !table.confirmed2) {
                emit PlayerTimedOut(tableId, table.player2, table.player1);
                _settle(tableId, table, table.player1);
            } else if (table.confirmed2 && !table.confirmed1) {
                emit PlayerTimedOut(tableId, table.player1, table.player2);
                _settle(tableId, table, table.player2);
            } else {
                _refund(tableId, table);
            }
            return;
        }

        if (table.stage == Stage.Showdown) {
            address result1 = playerResult[tableId][table.player1];
            address result2 = playerResult[tableId][table.player2];
            if (result1 != address(0) && result2 == address(0)) {
                emit PlayerTimedOut(tableId, table.player2, result1);
                _settle(tableId, table, result1);
                return;
            }
            if (result2 != address(0) && result1 == address(0)) {
                emit PlayerTimedOut(tableId, table.player1, result2);
                _settle(tableId, table, result2);
                return;
            }
            revert("Showdown result required");
        }

        require(_isActionStage(table.stage), "No action timeout");
        address inactive = table.turn;
        address winner = _opponent(table, inactive);
        emit PlayerTimedOut(tableId, inactive, winner);
        _settle(tableId, table, winner);
    }

    function submitResult(bytes32 tableId, address winner) external whenNotPaused nonReentrant {
        Table storage table = _table(tableId);
        require(table.stage == Stage.Showdown, "Not showdown");
        require(_isPlayer(table, msg.sender), "Not player");
        require(winner == table.player1 || winner == table.player2, "Winner not player");

        playerResult[tableId][msg.sender] = winner;
        emit ResultSubmitted(tableId, msg.sender, winner);

        address result1 = playerResult[tableId][table.player1];
        address result2 = playerResult[tableId][table.player2];
        if (result1 != address(0) && result1 == result2) {
            _settle(tableId, table, winner);
        }
    }

    function resolveDispute(bytes32 tableId, address winner) external onlyOwner nonReentrant {
        Table storage table = _table(tableId);
        require(table.stage == Stage.Showdown, "Not showdown");
        require(winner == table.player1 || winner == table.player2, "Winner not player");
        _settle(tableId, table, winner);
    }

    function claimWinnings() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to claim");
        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit WinningsClaimed(msg.sender, amount);
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "Fee recipient required");
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(newFeeRecipient);
    }

    function setDefaultStake(uint256 newDefaultStake) external onlyOwner {
        require(newDefaultStake > 0, "Stake required");
        defaultStake = newDefaultStake;
        emit DefaultStakeUpdated(newDefaultStake);
    }

    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Owner required");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function getTable(bytes32 tableId) external view returns (Table memory table) {
        table = tables[tableId];
    }

    function _activeTurnTable(bytes32 tableId) private view returns (Table storage table) {
        table = _table(tableId);
        require(_isActionStage(table.stage), "Not action stage");
        require(table.turn != address(0), "No turn");
        require(block.timestamp <= table.actionDeadline, "Action timed out");
    }

    function _table(bytes32 tableId) private view returns (Table storage table) {
        table = tables[tableId];
        require(table.exists, "Table not found");
    }

    function _startStage(bytes32 tableId, Table storage table, Stage stage, address turn) private {
        table.stage = stage;
        table.turn = turn;
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        table.actionsThisStage = 0;
        table.currentBet = 0;
        emit StageChanged(tableId, stage, turn, table.actionDeadline);
    }

    function _passTurn(bytes32 tableId, Table storage table) private {
        table.turn = _opponent(table, table.turn);
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        emit StageChanged(tableId, table.stage, table.turn, table.actionDeadline);
    }

    function _advanceStage(bytes32 tableId, Table storage table) private {
        if (table.stage == Stage.Preflop) {
            _startStage(tableId, table, Stage.Flop, table.player1);
        } else if (table.stage == Stage.Flop) {
            _startStage(tableId, table, Stage.Turn, table.player1);
        } else if (table.stage == Stage.Turn) {
            _startStage(tableId, table, Stage.River, table.player1);
        } else if (table.stage == Stage.River) {
            table.stage = Stage.Showdown;
            table.turn = address(0);
            table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
            table.actionsThisStage = 0;
            table.currentBet = 0;
            emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
        } else {
            revert("Cannot advance");
        }
    }

    function _settle(bytes32 tableId, Table storage table, address winner) private {
        require(winner == table.player1 || winner == table.player2, "Winner not player");
        require(table.stage != Stage.Finished, "Already finished");

        uint256 grossPot = table.pot;
        uint256 developerFee = (grossPot * DEVELOPER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 payout = grossPot - developerFee;

        table.pot = 0;
        table.winner = winner;
        table.stage = Stage.Finished;
        table.turn = address(0);
        table.actionDeadline = 0;

        pendingWithdrawals[winner] += payout;
        if (developerFee > 0) {
            pendingWithdrawals[feeRecipient] += developerFee;
        }

        emit TableSettled(tableId, winner, payout, developerFee);
        emit StageChanged(tableId, table.stage, address(0), 0);
    }

    function _refund(bytes32 tableId, Table storage table) private {
        require(table.stage != Stage.Finished, "Already finished");
        uint256 half = table.pot / 2;
        uint256 remainder = table.pot - (half * 2);

        table.pot = 0;
        table.refunded = true;
        table.stage = Stage.Finished;
        table.turn = address(0);
        table.actionDeadline = 0;

        pendingWithdrawals[table.player1] += half + remainder;
        pendingWithdrawals[table.player2] += half;

        emit TableRefunded(tableId, half);
        emit StageChanged(tableId, table.stage, address(0), 0);
    }

    function _isActionStage(Stage stage) private pure returns (bool) {
        return stage == Stage.Preflop || stage == Stage.Flop || stage == Stage.Turn || stage == Stage.River;
    }

    function _isPlayer(Table storage table, address account) private view returns (bool) {
        return account == table.player1 || account == table.player2;
    }

    function _opponent(Table storage table, address account) private view returns (address) {
        if (account == table.player1) return table.player2;
        if (account == table.player2) return table.player1;
        revert("Not player");
    }

    receive() external payable {
        revert("Use table actions");
    }
}
