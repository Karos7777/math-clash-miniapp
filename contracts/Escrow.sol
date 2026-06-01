// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Escrow
/// @notice Testnet MVP escrow for a 2-6 player ETH poker table on Base Sepolia.
/// @dev Commit-reveal supplies the hand seed, but cards are still dealt off-chain in this prototype.
contract Escrow {
    uint8 public constant MAX_PLAYERS = 6;
    uint256 public constant ACTION_TIMEOUT = 60 seconds;
    uint256 public constant DEVELOPER_FEE_BPS = 200;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum Stage {
        Waiting,
        Confirming,
        WaitingForCommit,
        WaitingForReveal,
        SeedReady,
        Dealing,
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
        uint256 handId;
        uint256 streetAnte;
        bool streetAntePaid1;
        bool streetAntePaid2;
        address winner;
        bool refunded;
        address[MAX_PLAYERS] players;
        uint8 playerCount;
        bool[MAX_PLAYERS] confirmed;
        bool[MAX_PLAYERS] active;
        bool[MAX_PLAYERS] folded;
        bool[MAX_PLAYERS] streetAntePaid;
        uint256[MAX_PLAYERS] stageBets;
        bool[MAX_PLAYERS] acted;
        uint8 activeCount;
        uint8 turnIndex;
        address showdownLeader;
        uint8 showdownLeaderVotes;
    }

    struct HandSeed {
        bytes32[MAX_PLAYERS] commits;
        string[MAX_PLAYERS] secrets;
        bool[MAX_PLAYERS] revealed;
        bytes32 seed;
        bool ready;
    }

    address public owner;
    address public feeRecipient;
    uint256 public defaultStake;
    uint256 public defaultStreetAnte;
    bool public paused;
    bool private locked;

    mapping(bytes32 => Table) private tables;
    mapping(bytes32 => mapping(uint256 => HandSeed)) private handSeeds;
    mapping(bytes32 => mapping(address => address)) public playerResult;
    mapping(bytes32 => mapping(address => bool)) private resultSubmitted;
    mapping(bytes32 => mapping(address => uint8)) private resultVotes;
    mapping(address => uint256) public pendingWithdrawals;

    event TableJoined(bytes32 indexed tableId, address indexed player, uint256 stake);
    event TableCreated(bytes32 indexed tableId, address indexed creator, uint256 stake);
    event PlayerJoined(bytes32 indexed tableId, address indexed player, uint8 seat, uint256 stake);
    event TableReady(bytes32 indexed tableId, address indexed player1, address indexed player2, uint256 pot);
    event TableSeatingUpdated(bytes32 indexed tableId, uint8 playerCount, uint8 maxPlayers);
    event PlayerConfirmed(bytes32 indexed tableId, address indexed player);
    event StageChanged(bytes32 indexed tableId, Stage stage, address turn, uint256 actionDeadline);
    event StreetAntePaid(bytes32 indexed tableId, uint256 indexed handId, address indexed player, uint256 amount, Stage street);
    event PlayerChecked(bytes32 indexed tableId, address indexed player);
    event PlayerBet(bytes32 indexed tableId, address indexed player, uint256 amount);
    event PlayerCalled(bytes32 indexed tableId, address indexed player, uint256 amount);
    event PlayerFolded(bytes32 indexed tableId, address indexed player, address indexed winner);
    event ActionSubmitted(bytes32 indexed tableId, address indexed player, string action, uint256 amount);
    event PlayerTimedOut(bytes32 indexed tableId, address indexed inactivePlayer, address indexed winner);
    event ResultSubmitted(bytes32 indexed tableId, address indexed player, address indexed winner);
    event TableSettled(bytes32 indexed tableId, address indexed winner, uint256 payout, uint256 developerFee);
    event HandFinished(bytes32 indexed tableId, address indexed winner, uint256 payout, uint256 developerFee);
    event TableRefunded(bytes32 indexed tableId, uint256 refundPerPlayer);
    event WinningsClaimed(address indexed player, uint256 amount);
    event SeedCommitted(bytes32 indexed tableId, uint256 indexed handId, address indexed player, bytes32 commit);
    event SeedRevealed(bytes32 indexed tableId, uint256 indexed handId, address indexed player, string secret);
    event HandSeedReady(bytes32 indexed tableId, uint256 indexed handId, bytes32 seed);
    event RevealTimedOut(bytes32 indexed tableId, uint256 indexed handId, address indexed inactivePlayer, address winner);
    event FeeRecipientUpdated(address indexed feeRecipient);
    event DefaultStakeUpdated(uint256 defaultStake);
    event DefaultStreetAnteUpdated(uint256 defaultStreetAnte);
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
        defaultStreetAnte = initialDefaultStake / 10;
        if (defaultStreetAnte == 0) defaultStreetAnte = 1;

        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientUpdated(initialFeeRecipient);
        emit DefaultStakeUpdated(initialDefaultStake);
        emit DefaultStreetAnteUpdated(defaultStreetAnte);
    }

    function joinTable(bytes32 tableId) external payable whenNotPaused nonReentrant {
        require(tableId != bytes32(0), "Table id required");
        Table storage table = tables[tableId];

        if (!table.exists) {
            require(msg.value == defaultStake, "Bad stake");
            table.exists = true;
            table.stake = msg.value;
            table.streetAnte = defaultStreetAnte;
            table.stage = Stage.Waiting;
            _addPlayer(tableId, table, msg.sender, msg.value);
            emit TableCreated(tableId, msg.sender, msg.value);
            emit StageChanged(tableId, table.stage, address(0), 0);
            return;
        }

        require(table.stage == Stage.Waiting, "Table not joinable");
        require(msg.value == table.stake, "Stake mismatch");
        _addPlayer(tableId, table, msg.sender, msg.value);

        if (table.playerCount >= 2) {
            emit TableReady(tableId, table.player1, table.player2, table.pot);
        }
    }

    function startHand(bytes32 tableId) external whenNotPaused {
        Table storage table = _table(tableId);
        require(table.stage == Stage.Waiting, "Hand already started");
        require(table.playerCount >= 2, "Need two players");
        require(_isPlayer(table, msg.sender), "Not player");
        _startConfirming(tableId, table);
    }

    function confirm(bytes32 tableId) external whenNotPaused {
        Table storage table = _table(tableId);
        if (table.stage == Stage.Waiting) {
            require(table.playerCount >= 2, "Need two players");
            _startConfirming(tableId, table);
        }
        require(table.stage == Stage.Confirming, "Not confirming");
        require(block.timestamp <= table.actionDeadline, "Confirmation timed out");

        uint8 seat = _seatOf(table, msg.sender);
        require(seat < MAX_PLAYERS, "Not player");
        require(!table.confirmed[seat], "Already confirmed");

        table.confirmed[seat] = true;
        if (seat == 0) table.confirmed1 = true;
        if (seat == 1) table.confirmed2 = true;

        emit PlayerConfirmed(tableId, msg.sender);
        emit ActionSubmitted(tableId, msg.sender, "confirm", 0);

        if (_allConfirmed(table)) {
            table.handId += 1;
            _startCommit(tableId, table);
        }
    }

    function commitSeed(bytes32 tableId, uint256 handId, bytes32 commit) external whenNotPaused {
        Table storage table = _table(tableId);
        require(table.stage == Stage.WaitingForCommit, "Not commit stage");
        require(table.handId == handId, "Wrong hand");
        require(block.timestamp <= table.actionDeadline, "Commit timed out");
        uint8 seat = _activeSeatOf(table, msg.sender);
        require(commit != bytes32(0), "Commit required");

        HandSeed storage hand = handSeeds[tableId][handId];
        require(hand.commits[seat] == bytes32(0), "Already committed");
        hand.commits[seat] = commit;

        emit SeedCommitted(tableId, handId, msg.sender, commit);

        if (_allCommitted(table, hand)) {
            table.stage = Stage.WaitingForReveal;
            table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
            emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
        }
    }

    function revealSeed(bytes32 tableId, uint256 handId, string calldata secret) external whenNotPaused {
        Table storage table = _table(tableId);
        require(table.stage == Stage.WaitingForReveal, "Not reveal stage");
        require(table.handId == handId, "Wrong hand");
        require(block.timestamp <= table.actionDeadline, "Reveal timed out");
        require(bytes(secret).length > 0, "Secret required");
        uint8 seat = _activeSeatOf(table, msg.sender);

        HandSeed storage hand = handSeeds[tableId][handId];
        bytes32 expected = keccak256(abi.encodePacked(secret, msg.sender, tableId, handId));
        require(!hand.revealed[seat], "Already revealed");
        require(hand.commits[seat] == expected, "Bad reveal");

        hand.secrets[seat] = secret;
        hand.revealed[seat] = true;

        emit SeedRevealed(tableId, handId, msg.sender, secret);

        if (_allRevealed(table, hand)) {
            bytes memory entropy = abi.encodePacked(tableId, handId, block.chainid, address(this));
            for (uint8 i = 0; i < table.playerCount; i += 1) {
                if (table.active[i]) entropy = abi.encodePacked(entropy, hand.secrets[i]);
            }
            bytes32 seed = keccak256(entropy);
            hand.seed = seed;
            hand.ready = true;
            table.stage = Stage.SeedReady;
            table.turn = address(0);
            table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
            table.currentBet = 0;
            table.actionsThisStage = 0;
            _resetStreetAntes(table);
            emit HandSeedReady(tableId, handId, seed);
            emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
        }
    }

    function payStreetAnte(bytes32 tableId) external payable whenNotPaused nonReentrant {
        Table storage table = _table(tableId);
        uint8 seat = _activeSeatOf(table, msg.sender);
        require(table.stage == Stage.SeedReady || _isActionStage(table.stage), "No street ante");
        require(table.turn == address(0), "Street already active");
        require(block.timestamp <= table.actionDeadline, "Street ante timed out");
        require(msg.value == table.streetAnte, "Bad street ante");
        require(!table.streetAntePaid[seat], "Already paid");

        table.streetAntePaid[seat] = true;
        if (seat == 0) table.streetAntePaid1 = true;
        if (seat == 1) table.streetAntePaid2 = true;
        table.pot += msg.value;

        emit StreetAntePaid(tableId, table.handId, msg.sender, msg.value, table.stage);
        emit ActionSubmitted(tableId, msg.sender, "street_ante", msg.value);

        if (_allStreetAntesPaid(table)) {
            Stage nextStage = table.stage == Stage.SeedReady ? Stage.Preflop : table.stage;
            _startActionStage(tableId, table, nextStage);
        }
    }

    function check(bytes32 tableId) external whenNotPaused {
        Table storage table = _activeTurnTable(tableId);
        uint8 seat = _requireTurnSeat(table, msg.sender);
        require(table.stageBets[seat] == table.currentBet, "Call or fold");

        table.acted[seat] = true;
        table.actionsThisStage += 1;
        emit PlayerChecked(tableId, msg.sender);
        emit ActionSubmitted(tableId, msg.sender, "check", 0);
        _afterAction(tableId, table);
    }

    function bet(bytes32 tableId) external payable whenNotPaused nonReentrant {
        Table storage table = _activeTurnTable(tableId);
        uint8 seat = _requireTurnSeat(table, msg.sender);
        require(msg.value > 0, "Bet required");

        table.stageBets[seat] += msg.value;
        require(table.stageBets[seat] > table.currentBet, "Raise required");
        table.currentBet = table.stageBets[seat];
        table.pot += msg.value;
        table.actionsThisStage += 1;
        _resetActed(table);
        table.acted[seat] = true;

        emit PlayerBet(tableId, msg.sender, msg.value);
        emit ActionSubmitted(tableId, msg.sender, "bet", msg.value);
        _afterAction(tableId, table);
    }

    function call(bytes32 tableId) external payable whenNotPaused nonReentrant {
        Table storage table = _activeTurnTable(tableId);
        uint8 seat = _requireTurnSeat(table, msg.sender);
        require(table.currentBet > table.stageBets[seat], "No bet to call");
        uint256 owed = table.currentBet - table.stageBets[seat];
        require(msg.value == owed, "Call must match bet");

        table.stageBets[seat] = table.currentBet;
        table.pot += msg.value;
        table.acted[seat] = true;
        table.actionsThisStage += 1;

        emit PlayerCalled(tableId, msg.sender, msg.value);
        emit ActionSubmitted(tableId, msg.sender, "call", msg.value);
        _afterAction(tableId, table);
    }

    function fold(bytes32 tableId) external whenNotPaused nonReentrant {
        Table storage table = _activeTurnTable(tableId);
        uint8 seat = _requireTurnSeat(table, msg.sender);
        table.folded[seat] = true;
        table.active[seat] = false;
        if (table.activeCount > 0) table.activeCount -= 1;

        address winner = table.activeCount == 1 ? _remainingActivePlayer(table) : address(0);
        emit PlayerFolded(tableId, msg.sender, winner);
        emit ActionSubmitted(tableId, msg.sender, "fold", 0);

        if (winner != address(0)) {
            _settle(tableId, table, winner);
        } else {
            _afterAction(tableId, table);
        }
    }

    function timeout(bytes32 tableId) external whenNotPaused nonReentrant {
        Table storage table = _table(tableId);
        require(table.actionDeadline > 0, "No timeout");
        require(block.timestamp > table.actionDeadline, "Timeout not reached");

        if (table.stage == Stage.Confirming) {
            address confirmedWinner = _firstConfirmedPlayer(table);
            if (confirmedWinner == address(0)) _refund(tableId, table);
            else {
                emit PlayerTimedOut(tableId, address(0), confirmedWinner);
                _settle(tableId, table, confirmedWinner);
            }
            return;
        }

        if (table.stage == Stage.WaitingForCommit || table.stage == Stage.WaitingForReveal) {
            _timeoutSeed(tableId, table);
            return;
        }

        if (table.stage == Stage.SeedReady || (_isActionStage(table.stage) && table.turn == address(0))) {
            _timeoutStreetAnte(tableId, table);
            return;
        }

        if (table.stage == Stage.Showdown) {
            require(table.showdownLeader != address(0), "Showdown result required");
            _settle(tableId, table, table.showdownLeader);
            return;
        }

        require(_isActionStage(table.stage), "No action timeout");
        address inactive = table.turn;
        uint8 seat = _seatOf(table, inactive);
        table.folded[seat] = true;
        table.active[seat] = false;
        if (table.activeCount > 0) table.activeCount -= 1;
        address winner = table.activeCount == 1 ? _remainingActivePlayer(table) : address(0);
        emit PlayerTimedOut(tableId, inactive, winner);
        if (winner != address(0)) _settle(tableId, table, winner);
        else _afterAction(tableId, table);
    }

    function timeoutReveal(bytes32 tableId, uint256 handId) external whenNotPaused nonReentrant {
        Table storage table = _table(tableId);
        require(table.handId == handId, "Wrong hand");
        require(table.stage == Stage.WaitingForCommit || table.stage == Stage.WaitingForReveal, "No reveal timeout");
        require(table.actionDeadline > 0 && block.timestamp > table.actionDeadline, "Timeout not reached");
        _timeoutSeed(tableId, table);
    }

    function submitResult(bytes32 tableId, address winner) external whenNotPaused nonReentrant {
        Table storage table = _table(tableId);
        require(table.stage == Stage.Showdown, "Not showdown");
        require(_isPlayer(table, msg.sender), "Not player");
        require(_isPlayer(table, winner), "Winner not player");
        require(!resultSubmitted[tableId][msg.sender], "Already submitted");

        resultSubmitted[tableId][msg.sender] = true;
        playerResult[tableId][msg.sender] = winner;
        resultVotes[tableId][winner] += 1;
        if (resultVotes[tableId][winner] > table.showdownLeaderVotes) {
            table.showdownLeader = winner;
            table.showdownLeaderVotes = resultVotes[tableId][winner];
        }
        emit ResultSubmitted(tableId, msg.sender, winner);

        if (resultVotes[tableId][winner] >= table.activeCount) {
            _settle(tableId, table, winner);
        }
    }

    function resolveDispute(bytes32 tableId, address winner) external onlyOwner nonReentrant {
        Table storage table = _table(tableId);
        require(table.stage == Stage.Showdown, "Not showdown");
        require(_isPlayer(table, winner), "Winner not player");
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

    function setDefaultStreetAnte(uint256 newDefaultStreetAnte) external onlyOwner {
        require(newDefaultStreetAnte > 0, "Street ante required");
        defaultStreetAnte = newDefaultStreetAnte;
        emit DefaultStreetAnteUpdated(newDefaultStreetAnte);
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

    function getHandSeed(bytes32 tableId, uint256 handId) external view returns (HandSeed memory hand) {
        hand = handSeeds[tableId][handId];
    }

    function _addPlayer(bytes32 tableId, Table storage table, address player, uint256 stakeAmount) private {
        require(_seatOf(table, player) == MAX_PLAYERS, "Already joined");
        require(table.playerCount < MAX_PLAYERS, "Table full");

        uint8 seat = table.playerCount;
        table.players[seat] = player;
        table.playerCount += 1;
        table.pot += stakeAmount;
        if (seat == 0) table.player1 = player;
        if (seat == 1) table.player2 = player;

        emit PlayerJoined(tableId, player, seat + 1, stakeAmount);
        emit TableJoined(tableId, player, stakeAmount);
        emit TableSeatingUpdated(tableId, table.playerCount, MAX_PLAYERS);
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

    function _startConfirming(bytes32 tableId, Table storage table) private {
        table.stage = Stage.Confirming;
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
    }

    function _startCommit(bytes32 tableId, Table storage table) private {
        table.stage = Stage.WaitingForCommit;
        table.turn = address(0);
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        table.currentBet = 0;
        table.actionsThisStage = 0;
        table.activeCount = table.playerCount;
        for (uint8 i = 0; i < MAX_PLAYERS; i += 1) {
            table.active[i] = i < table.playerCount;
            table.folded[i] = false;
            table.stageBets[i] = 0;
            table.acted[i] = false;
            table.streetAntePaid[i] = false;
        }
        table.streetAntePaid1 = false;
        table.streetAntePaid2 = false;
        emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
    }

    function _startActionStage(bytes32 tableId, Table storage table, Stage stage) private {
        table.stage = stage;
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        table.currentBet = 0;
        table.actionsThisStage = 0;
        _resetActed(table);
        for (uint8 i = 0; i < MAX_PLAYERS; i += 1) table.stageBets[i] = 0;
        table.turnIndex = _firstActiveSeat(table);
        table.turn = table.players[table.turnIndex];
        emit StageChanged(tableId, stage, table.turn, table.actionDeadline);
    }

    function _startStreetAnteStage(bytes32 tableId, Table storage table, Stage stage) private {
        table.stage = stage;
        table.turn = address(0);
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        table.currentBet = 0;
        table.actionsThisStage = 0;
        _resetStreetAntes(table);
        emit StageChanged(tableId, stage, address(0), table.actionDeadline);
    }

    function _afterAction(bytes32 tableId, Table storage table) private {
        if (table.activeCount == 1) {
            _settle(tableId, table, _remainingActivePlayer(table));
            return;
        }
        if (_stageComplete(table)) {
            _advanceStage(tableId, table);
            return;
        }
        _passTurn(tableId, table);
    }

    function _passTurn(bytes32 tableId, Table storage table) private {
        uint8 nextSeat = _nextPendingSeat(table);
        require(nextSeat < MAX_PLAYERS, "No pending player");
        table.turnIndex = nextSeat;
        table.turn = table.players[nextSeat];
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        emit StageChanged(tableId, table.stage, table.turn, table.actionDeadline);
    }

    function _advanceStage(bytes32 tableId, Table storage table) private {
        if (table.stage == Stage.Preflop) _startStreetAnteStage(tableId, table, Stage.Flop);
        else if (table.stage == Stage.Flop) _startStreetAnteStage(tableId, table, Stage.Turn);
        else if (table.stage == Stage.Turn) _startStreetAnteStage(tableId, table, Stage.River);
        else if (table.stage == Stage.River) {
            table.stage = Stage.Showdown;
            table.turn = address(0);
            table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
            table.actionsThisStage = 0;
            table.currentBet = 0;
            _resetStreetAntes(table);
            emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
        } else revert("Cannot advance");
    }

    function _timeoutSeed(bytes32 tableId, Table storage table) private {
        HandSeed storage hand = handSeeds[tableId][table.handId];
        address winner = address(0);
        address inactive = address(0);

        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (!table.active[i]) continue;
            bool done = table.stage == Stage.WaitingForCommit ? hand.commits[i] != bytes32(0) : hand.revealed[i];
            if (done && winner == address(0)) winner = table.players[i];
            if (!done && inactive == address(0)) inactive = table.players[i];
        }

        emit RevealTimedOut(tableId, table.handId, inactive, winner);
        if (winner == address(0)) _refund(tableId, table);
        else {
            emit PlayerTimedOut(tableId, inactive, winner);
            _settle(tableId, table, winner);
        }
    }

    function _timeoutStreetAnte(bytes32 tableId, Table storage table) private {
        address winner = address(0);
        address inactive = address(0);
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (!table.active[i]) continue;
            if (table.streetAntePaid[i] && winner == address(0)) winner = table.players[i];
            if (!table.streetAntePaid[i] && inactive == address(0)) inactive = table.players[i];
        }
        if (winner == address(0)) _refund(tableId, table);
        else {
            emit PlayerTimedOut(tableId, inactive, winner);
            _settle(tableId, table, winner);
        }
    }

    function _settle(bytes32 tableId, Table storage table, address winner) private {
        require(_isPlayer(table, winner), "Winner not player");
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
        if (developerFee > 0) pendingWithdrawals[feeRecipient] += developerFee;

        emit TableSettled(tableId, winner, payout, developerFee);
        emit HandFinished(tableId, winner, payout, developerFee);
        emit StageChanged(tableId, table.stage, address(0), 0);
    }

    function _refund(bytes32 tableId, Table storage table) private {
        require(table.stage != Stage.Finished, "Already finished");
        uint8 count = table.playerCount;
        require(count > 0, "No players");
        uint256 refund = table.pot / count;
        uint256 remainder = table.pot - (refund * count);

        table.pot = 0;
        table.refunded = true;
        table.stage = Stage.Finished;
        table.turn = address(0);
        table.actionDeadline = 0;

        for (uint8 i = 0; i < count; i += 1) {
            pendingWithdrawals[table.players[i]] += refund;
            if (i == 0) pendingWithdrawals[table.players[i]] += remainder;
        }

        emit TableRefunded(tableId, refund);
        emit StageChanged(tableId, table.stage, address(0), 0);
    }

    function _seatOf(Table storage table, address account) private view returns (uint8) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (table.players[i] == account) return i;
        }
        return MAX_PLAYERS;
    }

    function _activeSeatOf(Table storage table, address account) private view returns (uint8 seat) {
        seat = _seatOf(table, account);
        require(seat < MAX_PLAYERS && table.active[seat] && !table.folded[seat], "Not active player");
    }

    function _requireTurnSeat(Table storage table, address account) private view returns (uint8 seat) {
        seat = _activeSeatOf(table, account);
        require(account == table.turn && seat == table.turnIndex, "Not your turn");
    }

    function _isPlayer(Table storage table, address account) private view returns (bool) {
        return _seatOf(table, account) < MAX_PLAYERS;
    }

    function _allConfirmed(Table storage table) private view returns (bool) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (!table.confirmed[i]) return false;
        }
        return true;
    }

    function _allCommitted(Table storage table, HandSeed storage hand) private view returns (bool) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (table.active[i] && hand.commits[i] == bytes32(0)) return false;
        }
        return true;
    }

    function _allRevealed(Table storage table, HandSeed storage hand) private view returns (bool) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (table.active[i] && !hand.revealed[i]) return false;
        }
        return true;
    }

    function _allStreetAntesPaid(Table storage table) private view returns (bool) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (table.active[i] && !table.streetAntePaid[i]) return false;
        }
        return true;
    }

    function _stageComplete(Table storage table) private view returns (bool) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (!table.active[i] || table.folded[i]) continue;
            if (!table.acted[i] || table.stageBets[i] != table.currentBet) return false;
        }
        return true;
    }

    function _firstActiveSeat(Table storage table) private view returns (uint8) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (table.active[i] && !table.folded[i]) return i;
        }
        revert("No active players");
    }

    function _nextPendingSeat(Table storage table) private view returns (uint8) {
        for (uint8 offset = 1; offset <= MAX_PLAYERS; offset += 1) {
            uint8 i = uint8((table.turnIndex + offset) % MAX_PLAYERS);
            if (i >= table.playerCount || !table.active[i] || table.folded[i]) continue;
            if (!table.acted[i] || table.stageBets[i] < table.currentBet) return i;
        }
        return MAX_PLAYERS;
    }

    function _remainingActivePlayer(Table storage table) private view returns (address) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (table.active[i] && !table.folded[i]) return table.players[i];
        }
        return address(0);
    }

    function _firstConfirmedPlayer(Table storage table) private view returns (address) {
        for (uint8 i = 0; i < table.playerCount; i += 1) {
            if (table.confirmed[i]) return table.players[i];
        }
        return address(0);
    }

    function _resetActed(Table storage table) private {
        for (uint8 i = 0; i < MAX_PLAYERS; i += 1) table.acted[i] = false;
    }

    function _resetStreetAntes(Table storage table) private {
        for (uint8 i = 0; i < MAX_PLAYERS; i += 1) table.streetAntePaid[i] = false;
        table.streetAntePaid1 = false;
        table.streetAntePaid2 = false;
    }

    function _isActionStage(Stage stage) private pure returns (bool) {
        return stage == Stage.Preflop || stage == Stage.Flop || stage == Stage.Turn || stage == Stage.River;
    }

    receive() external payable {
        revert("Use table actions");
    }
}
