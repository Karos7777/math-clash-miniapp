// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Escrow
/// @notice Six-seat on-chain poker table. Players sit with an ETH buy-in, then
/// every hand starts only after players confirm by sending the ante transaction.
/// Bets, calls, and raises are payable transactions that move ETH into the hand pot.
contract Escrow {
    uint8 public constant MAX_SEATS = 6;
    uint8 private constant NO_SEAT = type(uint8).max;
    uint256 public constant ACTION_TIMEOUT = 5 minutes;
    uint256 public constant DEVELOPER_FEE_BPS = 200;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    enum TableState {
        WAITING,
        HAND_ANTE,
        HAND_COMMIT,
        HAND_BET,
        HAND_REVEAL,
        HAND_SETTLED,
        TABLE_CLOSED
    }

    address public owner;
    address public feeRecipient;
    bool public paused;
    bool private locked;

    TableState public tableState;
    address[MAX_SEATS] public seats;
    uint8 public seatCount;

    uint256 public immutable handAnte;
    uint256 public immutable minBuyIn;
    uint256 public handNumber;
    uint256 public handPot;
    uint256 public currentBet;
    uint256 public lastActionAt;

    uint8 public currentActorSeat;
    uint8 public lastAggressorSeat;
    uint8 public paidAnteCount;
    uint8 public activeCount;
    uint8 public remainingInHand;

    mapping(address => uint8) private seatIndexPlusOne;
    mapping(address => uint256) public stacks;
    mapping(address => uint256) public handContribution;
    mapping(address => bytes32) public committedHashes;
    mapping(address => uint8) public revealedNumbers;
    mapping(address => bool) public hasPaidAnte;
    mapping(address => bool) public isActiveInHand;
    mapping(address => bool) public hasCommitted;
    mapping(address => bool) public hasRevealed;
    mapping(address => bool) public hasFolded;
    mapping(address => bool) public hasActed;
    mapping(address => bool) private tieWinner;
    mapping(address => uint256) public pendingWithdrawals;

    event PlayerJoined(address indexed player, uint8 indexed seat, uint256 buyIn);
    event StackToppedUp(address indexed player, uint256 amount);
    event TableReady(uint8 seatsTaken);
    event HandStarted(uint256 indexed handNumber, uint256 handPot);
    event AntePaid(address indexed player, uint256 amount, uint8 activePlayers);
    event NumberCommitted(address indexed player, bytes32 commitHash);
    event PlayerBet(address indexed player, uint256 amount);
    event PlayerCalled(address indexed player, uint256 amount);
    event PlayerRaised(address indexed player, uint256 amount, uint256 newCurrentBet);
    event PlayerFolded(address indexed player);
    event PlayerChecked(address indexed player);
    event NumbersRevealed(address indexed winner, uint8 winnerNumber, uint8 loserNumber);
    event HandSettled(
        uint256 indexed handNumber,
        address indexed winner,
        uint256 grossPot,
        uint256 playerPayout,
        uint256 developerFee
    );
    event PayoutSent(address indexed to, uint256 amount);
    event PayoutCredited(address indexed to, uint256 amount);
    event StacksUpdated(address[MAX_SEATS] seats, uint256[MAX_SEATS] stacks);
    event TableClosed(address indexed closedBy);
    event WinningsClaimed(address indexed player, uint256 amount);
    event PlayerTimedOut(address indexed inactivePlayer, address indexed winner);
    event StateChanged(TableState state);
    event FeeRecipientUpdated(address indexed feeRecipient);
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

    modifier onlySeated() {
        require(isPlayer(msg.sender), "Not seated");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialFeeRecipient, uint256 initialHandAnte, uint256 initialMinBuyIn) {
        require(initialFeeRecipient != address(0), "Fee recipient required");
        require(initialHandAnte > 0, "Ante required");
        require(initialMinBuyIn >= initialHandAnte * 2, "Buy-in too low");

        owner = msg.sender;
        feeRecipient = initialFeeRecipient;
        handAnte = initialHandAnte;
        minBuyIn = initialMinBuyIn;
        tableState = TableState.WAITING;
        currentActorSeat = NO_SEAT;
        lastAggressorSeat = NO_SEAT;

        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientUpdated(initialFeeRecipient);
        emit StateChanged(tableState);
    }

    function joinGame() external payable whenNotPaused nonReentrant {
        _joinSeat(_firstEmptySeat());
    }

    function joinSeat(uint8 seat) external payable whenNotPaused nonReentrant {
        _joinSeat(seat);
    }

    function _joinSeat(uint8 seat) private {
        require(tableState != TableState.TABLE_CLOSED, "Table closed");
        require(!isPlayer(msg.sender), "Already seated");
        require(seatCount < MAX_SEATS, "Table full");
        require(seat < MAX_SEATS, "Seat out of range");
        require(seats[seat] == address(0), "Seat taken");
        require(msg.value >= minBuyIn, "Buy-in below table limit");

        seats[seat] = msg.sender;
        seatIndexPlusOne[msg.sender] = seat + 1;
        seatCount += 1;
        stacks[msg.sender] += msg.value;

        emit PlayerJoined(msg.sender, seat, msg.value);
        emitStackSnapshot();

        if (seatCount >= 2 && (tableState == TableState.WAITING || tableState == TableState.HAND_SETTLED)) {
            _openAntePhase();
        } else if (seatCount == 1) {
            emit TableReady(seatCount);
        }
    }

    function topUpStack() external payable whenNotPaused onlySeated nonReentrant {
        require(tableState != TableState.TABLE_CLOSED, "Table closed");
        require(msg.value > 0, "Top-up required");

        stacks[msg.sender] += msg.value;
        emit StackToppedUp(msg.sender, msg.value);
        emitStackSnapshot();
    }

    function payAnte() external payable whenNotPaused onlySeated nonReentrant {
        require(seatCount >= 2, "Need at least two players");
        if (tableState == TableState.HAND_SETTLED || tableState == TableState.WAITING) {
            _openAntePhase();
        }

        require(tableState == TableState.HAND_ANTE, "Not ante phase");
        require(!hasPaidAnte[msg.sender], "Ante already paid");
        require(msg.value == handAnte, "ETH must equal ante");

        hasPaidAnte[msg.sender] = true;
        isActiveInHand[msg.sender] = true;
        activeCount += 1;
        remainingInHand += 1;
        paidAnteCount += 1;
        handPot += msg.value;
        lastActionAt = block.timestamp;

        emit AntePaid(msg.sender, msg.value, activeCount);

        if (paidAnteCount == seatCount && paidAnteCount >= 2) {
            _startCommitPhase();
        }
    }

    function commitNumber(bytes32 commitHash) external whenNotPaused onlySeated {
        require(tableState == TableState.HAND_COMMIT, "Not commit phase");
        require(isActiveInHand[msg.sender], "Not in hand");
        require(commitHash != bytes32(0), "Commit required");
        require(!hasCommitted[msg.sender], "Already committed");

        committedHashes[msg.sender] = commitHash;
        hasCommitted[msg.sender] = true;
        lastActionAt = block.timestamp;

        emit NumberCommitted(msg.sender, commitHash);

        if (_allActiveCommitted()) {
            tableState = TableState.HAND_BET;
            currentActorSeat = _firstActiveSeat();
            lastActionAt = block.timestamp;
            emit StateChanged(tableState);
        }
    }

    function check() external whenNotPaused onlySeated {
        require(tableState == TableState.HAND_BET, "Not betting phase");
        require(_seatOf(msg.sender) == currentActorSeat, "Not your turn");
        require(currentBet == 0, "Bet already made");
        require(isActiveInHand[msg.sender], "Not in hand");

        hasActed[msg.sender] = true;
        emit PlayerChecked(msg.sender);

        _afterAction();
    }

    function bet(uint256 amount) external payable whenNotPaused onlySeated nonReentrant {
        require(tableState == TableState.HAND_BET, "Not betting phase");
        require(_seatOf(msg.sender) == currentActorSeat, "Not your turn");
        require(currentBet == 0, "Use raise");
        require(amount >= handAnte, "Bet below table limit");
        require(msg.value == amount, "ETH must equal bet");

        handContribution[msg.sender] += amount;
        handPot += amount;
        currentBet = handContribution[msg.sender];
        lastAggressorSeat = currentActorSeat;
        hasActed[msg.sender] = true;
        lastActionAt = block.timestamp;

        emit PlayerBet(msg.sender, amount);
        _afterAction();
    }

    function call() external payable whenNotPaused onlySeated nonReentrant {
        require(tableState == TableState.HAND_BET, "Not betting phase");
        require(_seatOf(msg.sender) == currentActorSeat, "Not your turn");
        require(currentBet > 0, "No bet to call");
        require(isActiveInHand[msg.sender], "Not in hand");

        uint256 due = currentBet - handContribution[msg.sender];
        require(due > 0, "Already matched");
        require(msg.value == due, "ETH must match call");

        handContribution[msg.sender] += due;
        handPot += due;
        hasActed[msg.sender] = true;
        lastActionAt = block.timestamp;

        emit PlayerCalled(msg.sender, due);
        _afterAction();
    }

    function raiseBet(uint256 amount) external payable whenNotPaused onlySeated nonReentrant {
        require(tableState == TableState.HAND_BET, "Not betting phase");
        require(_seatOf(msg.sender) == currentActorSeat, "Not your turn");
        require(currentBet > 0, "Use bet first");
        require(amount >= handAnte, "Raise below table limit");
        require(msg.value == amount, "ETH must equal raise");
        require(handContribution[msg.sender] + amount > currentBet, "Raise too small");

        handContribution[msg.sender] += amount;
        handPot += amount;
        currentBet = handContribution[msg.sender];
        lastAggressorSeat = currentActorSeat;
        _resetActiveActions();
        hasActed[msg.sender] = true;
        lastActionAt = block.timestamp;

        emit PlayerRaised(msg.sender, amount, currentBet);
        _afterAction();
    }

    function fold() external whenNotPaused onlySeated nonReentrant {
        require(tableState == TableState.HAND_BET, "Not betting phase");
        require(_seatOf(msg.sender) == currentActorSeat, "Not your turn");
        _fold(msg.sender);
    }

    function reveal(uint8 number, bytes32 salt) external whenNotPaused onlySeated nonReentrant {
        require(tableState == TableState.HAND_REVEAL, "Not reveal phase");
        require(isActiveInHand[msg.sender], "Not in hand");
        require(hasCommitted[msg.sender], "No commit");
        require(!hasRevealed[msg.sender], "Already revealed");
        require(number >= 1 && number <= 10, "Number must be 1-10");
        require(
            keccak256(abi.encodePacked(number, salt)) == committedHashes[msg.sender],
            "Bad reveal"
        );

        revealedNumbers[msg.sender] = number;
        hasRevealed[msg.sender] = true;
        lastActionAt = block.timestamp;

        if (_allActiveRevealed()) {
            _settleReveal();
        }
    }

    function timeout() external whenNotPaused onlySeated nonReentrant {
        require(
            tableState == TableState.HAND_ANTE ||
                tableState == TableState.HAND_COMMIT ||
                tableState == TableState.HAND_BET ||
                tableState == TableState.HAND_REVEAL,
            "No active timeout"
        );
        require(block.timestamp >= lastActionAt + ACTION_TIMEOUT, "Timeout not reached");

        if (tableState == TableState.HAND_ANTE) {
            require(paidAnteCount > 0, "No ante paid");
            if (paidAnteCount >= 2) {
                _startCommitPhase();
            } else {
                address paidPlayer = _firstActivePlayer();
                uint256 refund = handPot;
                handPot = 0;
                tableState = TableState.HAND_SETTLED;
                _payOrCredit(paidPlayer, refund);
                emit HandSettled(handNumber, address(0), refund, refund, 0);
                emit StateChanged(tableState);
            }
            return;
        }

        address inactive = _inactivePlayer();
        require(inactive != address(0), "No timeout target");
        address winner = opponentOf(inactive);

        emit PlayerTimedOut(inactive, winner);
        if (tableState == TableState.HAND_BET) {
            _fold(inactive);
        } else {
            _removeInactiveFromHand(inactive);
        }
    }

    function cashOutStack() external whenNotPaused onlySeated nonReentrant {
        require(
            tableState == TableState.WAITING ||
                tableState == TableState.HAND_ANTE ||
                tableState == TableState.HAND_SETTLED ||
                tableState == TableState.TABLE_CLOSED,
            "Finish hand first"
        );
        require(!isActiveInHand[msg.sender], "Finish active hand first");

        uint256 amount = stacks[msg.sender];
        require(amount > 0, "No stack");
        stacks[msg.sender] = 0;
        _removeSeat(msg.sender);
        _payOrCredit(msg.sender, amount);

        if (seatCount < 2 && tableState != TableState.TABLE_CLOSED) {
            tableState = TableState.WAITING;
            emit StateChanged(tableState);
        }

        emitStackSnapshot();
    }

    function claimWinnings() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to claim");
        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");

        emit WinningsClaimed(msg.sender, amount);
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

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "Fee recipient required");
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(newFeeRecipient);
    }

    function closeTable() external onlyOwner nonReentrant {
        tableState = TableState.TABLE_CLOSED;
        emit StateChanged(tableState);
        emit TableClosed(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Owner required");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function gameState() external view returns (uint8) {
        return uint8(tableState);
    }

    function roundNumber() external view returns (uint256) {
        return handNumber;
    }

    function roundAnte() external view returns (uint256) {
        return handAnte;
    }

    function roundPot() external view returns (uint256) {
        return handPot;
    }

    function getPlayers() external view returns (address player1, address player2) {
        return (seats[0], seats[1]);
    }

    function getSeats() external view returns (address[MAX_SEATS] memory) {
        return seats;
    }

    function seatOf(address player) external view returns (uint8) {
        require(isPlayer(player), "Not seated");
        return _seatOf(player);
    }

    function isPlayer(address account) public view returns (bool) {
        return seatIndexPlusOne[account] != 0;
    }

    function opponentOf(address account) public view returns (address) {
        if (remainingInHand == 1) return _firstActivePlayer();
        uint8 seat = _seatOf(account);
        uint8 nextSeat = _nextActiveSeat(seat);
        if (nextSeat == NO_SEAT) return address(0);
        return seats[nextSeat];
    }

    function timeoutAt() external view returns (uint256) {
        if (
            tableState != TableState.HAND_ANTE &&
            tableState != TableState.HAND_COMMIT &&
            tableState != TableState.HAND_BET &&
            tableState != TableState.HAND_REVEAL
        ) {
            return 0;
        }
        return lastActionAt + ACTION_TIMEOUT;
    }

    function emitStackSnapshot() public {
        uint256[MAX_SEATS] memory snapshot;
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            snapshot[i] = stacks[seats[i]];
        }
        emit StacksUpdated(seats, snapshot);
    }

    function _openAntePhase() private {
        require(seatCount >= 2, "Need at least two players");

        handNumber += 1;
        handPot = 0;
        currentBet = 0;
        currentActorSeat = NO_SEAT;
        lastAggressorSeat = NO_SEAT;
        paidAnteCount = 0;
        activeCount = 0;
        remainingInHand = 0;

        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0)) {
                _clearHandPlayer(player);
            }
        }

        tableState = TableState.HAND_ANTE;
        lastActionAt = block.timestamp;

        emit HandStarted(handNumber, 0);
        emit StateChanged(tableState);
    }

    function _startCommitPhase() private {
        require(paidAnteCount >= 2, "Need two antes");
        tableState = TableState.HAND_COMMIT;
        lastActionAt = block.timestamp;
        emit StateChanged(tableState);
    }

    function _clearHandPlayer(address player) private {
        handContribution[player] = 0;
        committedHashes[player] = bytes32(0);
        revealedNumbers[player] = 0;
        hasPaidAnte[player] = false;
        isActiveInHand[player] = false;
        hasCommitted[player] = false;
        hasRevealed[player] = false;
        hasFolded[player] = false;
        hasActed[player] = false;
        tieWinner[player] = false;
    }

    function _afterAction() private {
        if (remainingInHand == 1) {
            _settleHand(_firstActivePlayer());
            return;
        }

        if (_bettingComplete()) {
            currentActorSeat = NO_SEAT;
            tableState = TableState.HAND_REVEAL;
            lastActionAt = block.timestamp;
            emit StateChanged(tableState);
            return;
        }

        currentActorSeat = _nextActionSeat(currentActorSeat);
        lastActionAt = block.timestamp;
    }

    function _fold(address player) private {
        require(isActiveInHand[player], "Not in hand");
        isActiveInHand[player] = false;
        hasFolded[player] = true;
        hasActed[player] = true;
        remainingInHand -= 1;

        emit PlayerFolded(player);

        if (remainingInHand == 1) {
            _settleHand(_firstActivePlayer());
            return;
        }

        _afterAction();
    }

    function _removeInactiveFromHand(address player) private {
        require(isActiveInHand[player], "Not in hand");
        isActiveInHand[player] = false;
        hasFolded[player] = true;
        remainingInHand -= 1;

        emit PlayerFolded(player);

        if (remainingInHand == 1) {
            _settleHand(_firstActivePlayer());
            return;
        }

        if (tableState == TableState.HAND_COMMIT && _allActiveCommitted()) {
            tableState = TableState.HAND_BET;
            currentActorSeat = _firstActiveSeat();
            lastActionAt = block.timestamp;
            emit StateChanged(tableState);
            return;
        }

        if (tableState == TableState.HAND_REVEAL && _allActiveRevealed()) {
            _settleReveal();
        }
    }

    function _settleReveal() private {
        uint8 bestNumber = 0;
        uint8 winners = 0;
        address firstWinner = address(0);
        uint8 secondNumber = 0;

        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0) && isActiveInHand[player]) {
                uint8 number = revealedNumbers[player];
                if (number > bestNumber) {
                    bestNumber = number;
                    firstWinner = player;
                    winners = 1;
                } else if (number == bestNumber) {
                    winners += 1;
                } else if (number > secondNumber) {
                    secondNumber = number;
                }
            }
        }

        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0) && isActiveInHand[player] && revealedNumbers[player] == bestNumber) {
                tieWinner[player] = true;
            }
        }

        emit NumbersRevealed(winners == 1 ? firstWinner : address(0), bestNumber, secondNumber);
        _settleHand(winners == 1 ? firstWinner : address(0));
    }

    function _settleHand(address winner) private {
        uint256 grossPot = handPot;
        uint256 developerFee = (grossPot * DEVELOPER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 playerPayout = grossPot - developerFee;

        tableState = TableState.HAND_SETTLED;
        handPot = 0;
        currentBet = 0;
        currentActorSeat = NO_SEAT;
        lastAggressorSeat = NO_SEAT;
        lastActionAt = block.timestamp;

        if (developerFee > 0) {
            _payOrCredit(feeRecipient, developerFee);
        }

        if (winner == address(0)) {
            _splitPayout(playerPayout);
        } else {
            require(isPlayer(winner), "Winner not seated");
            _payOrCredit(winner, playerPayout);
        }

        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0)) {
                isActiveInHand[player] = false;
            }
        }

        emit HandSettled(handNumber, winner, grossPot, playerPayout, developerFee);
        emitStackSnapshot();
        emit StateChanged(tableState);
    }

    function _splitPayout(uint256 playerPayout) private {
        uint8 winners = 0;
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0) && isActiveInHand[player] && tieWinner[player]) {
                winners += 1;
            }
        }

        if (winners == 0) {
            for (uint8 i = 0; i < MAX_SEATS; i++) {
                address player = seats[i];
                if (player != address(0) && isActiveInHand[player]) {
                    winners += 1;
                }
            }
        }

        uint256 share = playerPayout / winners;
        uint256 remainder = playerPayout - (share * winners);
        bool remainderPaid = false;

        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (
                player != address(0) &&
                isActiveInHand[player] &&
                (tieWinner[player] || !_hasTieWinners())
            ) {
                uint256 amount = share;
                if (!remainderPaid) {
                    amount += remainder;
                    remainderPaid = true;
                }
                _payOrCredit(player, amount);
            }
        }
    }

    function _hasTieWinners() private view returns (bool) {
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0) && tieWinner[player]) return true;
        }
        return false;
    }

    function _payOrCredit(address to, uint256 amount) private {
        if (to == address(0) || amount == 0) return;

        (bool success, ) = to.call{value: amount}("");
        if (success) {
            emit PayoutSent(to, amount);
        } else {
            pendingWithdrawals[to] += amount;
            emit PayoutCredited(to, amount);
        }
    }

    function _removeSeat(address player) private {
        uint8 seat = _seatOf(player);
        seats[seat] = address(0);
        seatIndexPlusOne[player] = 0;
        seatCount -= 1;
    }

    function _firstEmptySeat() private view returns (uint8) {
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            if (seats[i] == address(0)) return i;
        }
        revert("No seat");
    }

    function _firstActiveSeat() private view returns (uint8) {
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0) && isActiveInHand[player]) return i;
        }
        return NO_SEAT;
    }

    function _firstActivePlayer() private view returns (address) {
        uint8 seat = _firstActiveSeat();
        return seat == NO_SEAT ? address(0) : seats[seat];
    }

    function _nextActiveSeat(uint8 fromSeat) private view returns (uint8) {
        for (uint8 step = 1; step <= MAX_SEATS; step++) {
            uint8 seat = uint8((uint256(fromSeat) + step) % MAX_SEATS);
            address player = seats[seat];
            if (player != address(0) && isActiveInHand[player]) return seat;
        }
        return NO_SEAT;
    }

    function _nextActionSeat(uint8 fromSeat) private view returns (uint8) {
        for (uint8 step = 1; step <= MAX_SEATS; step++) {
            uint8 seat = uint8((uint256(fromSeat) + step) % MAX_SEATS);
            address player = seats[seat];
            if (
                player != address(0) &&
                isActiveInHand[player] &&
                (!hasActed[player] || handContribution[player] < currentBet)
            ) {
                return seat;
            }
        }
        return NO_SEAT;
    }

    function _bettingComplete() private view returns (bool) {
        if (remainingInHand <= 1) return true;
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (
                player != address(0) &&
                isActiveInHand[player] &&
                (!hasActed[player] || handContribution[player] < currentBet)
            ) {
                return false;
            }
        }
        return true;
    }

    function _allActiveCommitted() private view returns (bool) {
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0) && isActiveInHand[player] && !hasCommitted[player]) {
                return false;
            }
        }
        return true;
    }

    function _allActiveRevealed() private view returns (bool) {
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0) && isActiveInHand[player] && !hasRevealed[player]) {
                return false;
            }
        }
        return true;
    }

    function _resetActiveActions() private {
        for (uint8 i = 0; i < MAX_SEATS; i++) {
            address player = seats[i];
            if (player != address(0) && isActiveInHand[player]) {
                hasActed[player] = false;
            }
        }
    }

    function _inactivePlayer() private view returns (address) {
        if (tableState == TableState.HAND_BET) {
            return currentActorSeat == NO_SEAT ? address(0) : seats[currentActorSeat];
        }

        if (tableState == TableState.HAND_COMMIT) {
            for (uint8 i = 0; i < MAX_SEATS; i++) {
                address player = seats[i];
                if (player != address(0) && isActiveInHand[player] && !hasCommitted[player]) {
                    return player;
                }
            }
        }

        if (tableState == TableState.HAND_REVEAL) {
            for (uint8 i = 0; i < MAX_SEATS; i++) {
                address player = seats[i];
                if (player != address(0) && isActiveInHand[player] && !hasRevealed[player]) {
                    return player;
                }
            }
        }

        return address(0);
    }

    function _seatOf(address player) private view returns (uint8) {
        uint8 plusOne = seatIndexPlusOne[player];
        require(plusOne != 0, "Not seated");
        return plusOne - 1;
    }

    receive() external payable {
        revert("Use table actions");
    }
}
