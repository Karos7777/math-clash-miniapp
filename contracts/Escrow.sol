// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library VRFV2PlusClientLite {
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }

    function argsToBytes(ExtraArgsV1 memory extraArgs) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, extraArgs);
    }
}

interface IVRFCoordinatorV2PlusLite {
    function requestRandomWords(VRFV2PlusClientLite.RandomWordsRequest calldata req) external returns (uint256 requestId);
}

/// @title Escrow
/// @notice Testnet MVP escrow for a two-player ETH poker table on Base Sepolia.
/// @dev Chainlink VRF supplies the hand seed, but cards are still dealt off-chain in this prototype.
contract Escrow {
    uint256 public constant ACTION_TIMEOUT = 60 seconds;
    uint256 public constant VRF_TIMEOUT = 15 minutes;
    uint256 public constant DEVELOPER_FEE_BPS = 200;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint32 public constant VRF_NUM_WORDS = 1;

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
        Finished,
        WaitingForVrf
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
    }

    struct HandSeed {
        bytes32 commit1;
        bytes32 commit2;
        string secret1;
        string secret2;
        bool revealed1;
        bool revealed2;
        bytes32 seed;
        bool ready;
        uint256 vrfRequestId;
        uint256 vrfWord;
        bool vrfReady;
    }

    address public owner;
    address public feeRecipient;
    uint256 public defaultStake;
    uint256 public defaultStreetAnte;
    address public vrfCoordinator;
    uint256 public vrfSubscriptionId;
    bytes32 public vrfKeyHash;
    uint32 public vrfCallbackGasLimit;
    uint16 public vrfRequestConfirmations;
    bool public vrfNativePayment;
    bool public paused;
    bool private locked;

    mapping(bytes32 => Table) private tables;
    mapping(bytes32 => mapping(uint256 => HandSeed)) private handSeeds;
    mapping(uint256 => bytes32) private vrfRequestTableIds;
    mapping(uint256 => uint256) private vrfRequestHandIds;
    mapping(bytes32 => mapping(address => address)) public playerResult;
    mapping(address => uint256) public pendingWithdrawals;

    event TableJoined(bytes32 indexed tableId, address indexed player, uint256 stake);
    event TableCreated(bytes32 indexed tableId, address indexed creator, uint256 stake);
    event PlayerJoined(bytes32 indexed tableId, address indexed player, uint8 seat, uint256 stake);
    event TableReady(bytes32 indexed tableId, address indexed player1, address indexed player2, uint256 pot);
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
    event VrfSeedRequested(bytes32 indexed tableId, uint256 indexed handId, uint256 indexed requestId);
    event VrfSeedFulfilled(bytes32 indexed tableId, uint256 indexed handId, uint256 indexed requestId, uint256 randomWord);
    event VrfTimedOut(bytes32 indexed tableId, uint256 indexed handId, uint256 indexed requestId);
    event RevealTimedOut(bytes32 indexed tableId, uint256 indexed handId, address indexed inactivePlayer, address winner);
    event VrfConfigUpdated(
        address indexed coordinator,
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        bool nativePayment
    );
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

    constructor(
        address initialFeeRecipient,
        uint256 initialDefaultStake,
        address initialVrfCoordinator,
        uint256 initialVrfSubscriptionId,
        bytes32 initialVrfKeyHash,
        uint32 initialVrfCallbackGasLimit,
        uint16 initialVrfRequestConfirmations,
        bool initialVrfNativePayment
    ) {
        require(initialFeeRecipient != address(0), "Fee recipient required");
        require(initialDefaultStake > 0, "Stake required");

        owner = msg.sender;
        feeRecipient = initialFeeRecipient;
        defaultStake = initialDefaultStake;
        defaultStreetAnte = initialDefaultStake / 10;
        if (defaultStreetAnte == 0) {
            defaultStreetAnte = 1;
        }
        _setVrfConfig(
            initialVrfCoordinator,
            initialVrfSubscriptionId,
            initialVrfKeyHash,
            initialVrfCallbackGasLimit,
            initialVrfRequestConfirmations,
            initialVrfNativePayment
        );

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
            table.player1 = msg.sender;
            table.stake = msg.value;
            table.streetAnte = defaultStreetAnte;
            table.pot = msg.value;
            table.stage = Stage.Waiting;
            emit TableCreated(tableId, msg.sender, msg.value);
            emit PlayerJoined(tableId, msg.sender, 1, msg.value);
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

        emit PlayerJoined(tableId, msg.sender, 2, msg.value);
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
        emit ActionSubmitted(tableId, msg.sender, "confirm", 0);

        if (table.confirmed1 && table.confirmed2) {
            table.handId += 1;
            _startCommit(tableId, table);
        }
    }

    function commitSeed(bytes32 tableId, uint256 handId, bytes32 commit) external whenNotPaused {
        Table storage table = _table(tableId);
        require(table.stage == Stage.WaitingForCommit, "Not commit stage");
        require(table.handId == handId, "Wrong hand");
        require(block.timestamp <= table.actionDeadline, "Commit timed out");
        require(_isPlayer(table, msg.sender), "Not player");
        require(commit != bytes32(0), "Commit required");

        HandSeed storage hand = handSeeds[tableId][handId];
        if (msg.sender == table.player1) {
            require(hand.commit1 == bytes32(0), "Already committed");
            hand.commit1 = commit;
        } else {
            require(hand.commit2 == bytes32(0), "Already committed");
            hand.commit2 = commit;
        }

        emit SeedCommitted(tableId, handId, msg.sender, commit);

        if (hand.commit1 != bytes32(0) && hand.commit2 != bytes32(0)) {
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
        require(_isPlayer(table, msg.sender), "Not player");
        require(bytes(secret).length > 0, "Secret required");

        HandSeed storage hand = handSeeds[tableId][handId];
        bytes32 expected = keccak256(abi.encodePacked(secret, msg.sender, tableId, handId));

        if (msg.sender == table.player1) {
            require(!hand.revealed1, "Already revealed");
            require(hand.commit1 == expected, "Bad reveal");
            hand.secret1 = secret;
            hand.revealed1 = true;
        } else {
            require(!hand.revealed2, "Already revealed");
            require(hand.commit2 == expected, "Bad reveal");
            hand.secret2 = secret;
            hand.revealed2 = true;
        }

        emit SeedRevealed(tableId, handId, msg.sender, secret);

        if (hand.revealed1 && hand.revealed2) {
            _requestVrfSeed(tableId, table, hand);
        }
    }

    function requestVrfSeed(bytes32 tableId, uint256 handId) external whenNotPaused {
        Table storage table = _table(tableId);
        require(table.stage == Stage.WaitingForVrf, "Not waiting for VRF");
        require(table.handId == handId, "Wrong hand");

        HandSeed storage hand = handSeeds[tableId][handId];
        require(hand.revealed1 && hand.revealed2, "Reveals required");
        require(!hand.ready, "Seed already ready");
        require(hand.vrfRequestId == 0, "VRF already requested");
        _requestVrfSeed(tableId, table, hand);
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        require(msg.sender == vrfCoordinator, "Only VRF coordinator");
        require(randomWords.length > 0, "No random word");

        bytes32 tableId = vrfRequestTableIds[requestId];
        uint256 handId = vrfRequestHandIds[requestId];
        require(tableId != bytes32(0), "Unknown VRF request");

        Table storage table = tables[tableId];
        HandSeed storage hand = handSeeds[tableId][handId];
        if (!table.exists || table.handId != handId || table.stage != Stage.WaitingForVrf || hand.ready) {
            return;
        }

        uint256 randomWord = randomWords[0];
        bytes32 seed = keccak256(
            abi.encodePacked(hand.secret1, hand.secret2, tableId, handId, randomWord, block.chainid, address(this))
        );

        hand.vrfWord = randomWord;
        hand.vrfReady = true;
        hand.seed = seed;
        hand.ready = true;
        table.stage = Stage.SeedReady;
        table.turn = address(0);
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        table.currentBet = 0;
        table.actionsThisStage = 0;
        table.streetAntePaid1 = false;
        table.streetAntePaid2 = false;

        emit VrfSeedFulfilled(tableId, handId, requestId, randomWord);
        emit HandSeedReady(tableId, handId, seed);
        emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
    }

    function payStreetAnte(bytes32 tableId) external payable whenNotPaused nonReentrant {
        Table storage table = _table(tableId);
        require(_isPlayer(table, msg.sender), "Not player");
        require(table.stage == Stage.SeedReady || _isActionStage(table.stage), "No street ante");
        require(table.turn == address(0), "Street already active");
        require(block.timestamp <= table.actionDeadline, "Street ante timed out");
        require(msg.value == table.streetAnte, "Bad street ante");

        if (msg.sender == table.player1) {
            require(!table.streetAntePaid1, "Already paid");
            table.streetAntePaid1 = true;
        } else {
            require(!table.streetAntePaid2, "Already paid");
            table.streetAntePaid2 = true;
        }

        table.pot += msg.value;
        emit StreetAntePaid(tableId, table.handId, msg.sender, msg.value, table.stage);
        emit ActionSubmitted(tableId, msg.sender, "street_ante", msg.value);

        if (table.streetAntePaid1 && table.streetAntePaid2) {
            Stage nextStage = table.stage == Stage.SeedReady ? Stage.Preflop : table.stage;
            _startActionStage(tableId, table, nextStage, table.player1);
        }
    }

    function check(bytes32 tableId) external whenNotPaused {
        Table storage table = _activeTurnTable(tableId);
        require(table.currentBet == 0, "Call or fold");
        require(msg.sender == table.turn, "Not your turn");

        table.actionsThisStage += 1;
        emit PlayerChecked(tableId, msg.sender);
        emit ActionSubmitted(tableId, msg.sender, "check", 0);

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
        emit ActionSubmitted(tableId, msg.sender, "bet", msg.value);
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
        emit ActionSubmitted(tableId, msg.sender, "call", msg.value);
        _advanceStage(tableId, table);
    }

    function fold(bytes32 tableId) external whenNotPaused nonReentrant {
        Table storage table = _activeTurnTable(tableId);
        require(msg.sender == table.turn, "Not your turn");

        address winner = _opponent(table, msg.sender);
        emit PlayerFolded(tableId, msg.sender, winner);
        emit ActionSubmitted(tableId, msg.sender, "fold", 0);
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

        if (table.stage == Stage.WaitingForCommit || table.stage == Stage.WaitingForReveal) {
            _timeoutSeed(tableId, table);
            return;
        }

        if (table.stage == Stage.WaitingForVrf) {
            HandSeed storage hand = handSeeds[tableId][table.handId];
            emit VrfTimedOut(tableId, table.handId, hand.vrfRequestId);
            _refund(tableId, table);
            return;
        }

        if (table.stage == Stage.SeedReady || (_isActionStage(table.stage) && table.turn == address(0))) {
            _timeoutStreetAnte(tableId, table);
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

    function setDefaultStreetAnte(uint256 newDefaultStreetAnte) external onlyOwner {
        require(newDefaultStreetAnte > 0, "Street ante required");
        defaultStreetAnte = newDefaultStreetAnte;
        emit DefaultStreetAnteUpdated(newDefaultStreetAnte);
    }

    function setVrfConfig(
        address newCoordinator,
        uint256 newSubscriptionId,
        bytes32 newKeyHash,
        uint32 newCallbackGasLimit,
        uint16 newRequestConfirmations,
        bool newNativePayment
    ) external onlyOwner {
        _setVrfConfig(
            newCoordinator,
            newSubscriptionId,
            newKeyHash,
            newCallbackGasLimit,
            newRequestConfirmations,
            newNativePayment
        );
    }

    function vrfConfigured() public view returns (bool) {
        return vrfCoordinator != address(0) && vrfSubscriptionId != 0 && vrfKeyHash != bytes32(0) && vrfCallbackGasLimit != 0;
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

    function _startCommit(bytes32 tableId, Table storage table) private {
        table.stage = Stage.WaitingForCommit;
        table.turn = address(0);
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        table.currentBet = 0;
        table.actionsThisStage = 0;
        table.streetAntePaid1 = false;
        table.streetAntePaid2 = false;
        emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
    }

    function _requestVrfSeed(bytes32 tableId, Table storage table, HandSeed storage hand) private {
        require(vrfConfigured(), "VRF not configured");
        require(hand.revealed1 && hand.revealed2, "Reveals required");
        require(!hand.ready, "Seed already ready");
        require(hand.vrfRequestId == 0, "VRF already requested");

        table.stage = Stage.WaitingForVrf;
        table.turn = address(0);
        table.actionDeadline = block.timestamp + VRF_TIMEOUT;
        table.currentBet = 0;
        table.actionsThisStage = 0;
        table.streetAntePaid1 = false;
        table.streetAntePaid2 = false;

        uint256 requestId = IVRFCoordinatorV2PlusLite(vrfCoordinator).requestRandomWords(
            VRFV2PlusClientLite.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: vrfRequestConfirmations,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: VRF_NUM_WORDS,
                extraArgs: VRFV2PlusClientLite.argsToBytes(
                    VRFV2PlusClientLite.ExtraArgsV1({nativePayment: vrfNativePayment})
                )
            })
        );

        hand.vrfRequestId = requestId;
        vrfRequestTableIds[requestId] = tableId;
        vrfRequestHandIds[requestId] = table.handId;

        emit VrfSeedRequested(tableId, table.handId, requestId);
        emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
    }

    function _startActionStage(bytes32 tableId, Table storage table, Stage stage, address turn) private {
        table.stage = stage;
        table.turn = turn;
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        table.actionsThisStage = 0;
        table.currentBet = 0;
        emit StageChanged(tableId, stage, turn, table.actionDeadline);
    }

    function _startStreetAnteStage(bytes32 tableId, Table storage table, Stage stage) private {
        table.stage = stage;
        table.turn = address(0);
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        table.actionsThisStage = 0;
        table.currentBet = 0;
        table.streetAntePaid1 = false;
        table.streetAntePaid2 = false;
        emit StageChanged(tableId, stage, address(0), table.actionDeadline);
    }

    function _passTurn(bytes32 tableId, Table storage table) private {
        table.turn = _opponent(table, table.turn);
        table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
        emit StageChanged(tableId, table.stage, table.turn, table.actionDeadline);
    }

    function _advanceStage(bytes32 tableId, Table storage table) private {
        if (table.stage == Stage.Preflop) {
            _startStreetAnteStage(tableId, table, Stage.Flop);
        } else if (table.stage == Stage.Flop) {
            _startStreetAnteStage(tableId, table, Stage.Turn);
        } else if (table.stage == Stage.Turn) {
            _startStreetAnteStage(tableId, table, Stage.River);
        } else if (table.stage == Stage.River) {
            table.stage = Stage.Showdown;
            table.turn = address(0);
            table.actionDeadline = block.timestamp + ACTION_TIMEOUT;
            table.actionsThisStage = 0;
            table.currentBet = 0;
            table.streetAntePaid1 = false;
            table.streetAntePaid2 = false;
            emit StageChanged(tableId, table.stage, address(0), table.actionDeadline);
        } else {
            revert("Cannot advance");
        }
    }

    function _timeoutSeed(bytes32 tableId, Table storage table) private {
        HandSeed storage hand = handSeeds[tableId][table.handId];
        address winner = address(0);
        address inactive = address(0);

        if (table.stage == Stage.WaitingForCommit) {
            if (hand.commit1 != bytes32(0) && hand.commit2 == bytes32(0)) {
                winner = table.player1;
                inactive = table.player2;
            } else if (hand.commit2 != bytes32(0) && hand.commit1 == bytes32(0)) {
                winner = table.player2;
                inactive = table.player1;
            }
        } else {
            if (hand.revealed1 && !hand.revealed2) {
                winner = table.player1;
                inactive = table.player2;
            } else if (hand.revealed2 && !hand.revealed1) {
                winner = table.player2;
                inactive = table.player1;
            }
        }

        emit RevealTimedOut(tableId, table.handId, inactive, winner);
        if (winner == address(0)) {
            _refund(tableId, table);
        } else {
            emit PlayerTimedOut(tableId, inactive, winner);
            _settle(tableId, table, winner);
        }
    }

    function _timeoutStreetAnte(bytes32 tableId, Table storage table) private {
        if (table.streetAntePaid1 && !table.streetAntePaid2) {
            emit PlayerTimedOut(tableId, table.player2, table.player1);
            _settle(tableId, table, table.player1);
            return;
        }
        if (table.streetAntePaid2 && !table.streetAntePaid1) {
            emit PlayerTimedOut(tableId, table.player1, table.player2);
            _settle(tableId, table, table.player2);
            return;
        }
        _refund(tableId, table);
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
        emit HandFinished(tableId, winner, payout, developerFee);
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

    function _setVrfConfig(
        address newCoordinator,
        uint256 newSubscriptionId,
        bytes32 newKeyHash,
        uint32 newCallbackGasLimit,
        uint16 newRequestConfirmations,
        bool newNativePayment
    ) private {
        if (newCoordinator == address(0) || newSubscriptionId == 0 || newKeyHash == bytes32(0)) {
            require(newCoordinator == address(0), "Incomplete VRF config");
            require(newSubscriptionId == 0, "Incomplete VRF config");
            require(newKeyHash == bytes32(0), "Incomplete VRF config");
            require(newCallbackGasLimit == 0, "Incomplete VRF config");
        } else {
            require(newCallbackGasLimit > 0, "Callback gas required");
        }

        vrfCoordinator = newCoordinator;
        vrfSubscriptionId = newSubscriptionId;
        vrfKeyHash = newKeyHash;
        vrfCallbackGasLimit = newCallbackGasLimit;
        vrfRequestConfirmations = newRequestConfirmations;
        vrfNativePayment = newNativePayment;
        emit VrfConfigUpdated(
            newCoordinator,
            newSubscriptionId,
            newKeyHash,
            newCallbackGasLimit,
            newRequestConfirmations,
            newNativePayment
        );
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
