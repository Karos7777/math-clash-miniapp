// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract Escrow {
    address public constant NATIVE_TOKEN = address(0);
    uint256 public constant ENTRY_FEE = 100_000; // 0.1 USDC-style token with 6 decimals.
    uint256 public constant ERC20_ENTRY_FEE = 100_000; // 0.1 USDC-style token with 6 decimals.
    uint256 public constant NATIVE_ENTRY_FEE_WEI = 100_000_000_000_000; // 0.0001 ETH.
    uint256 public constant DEVELOPER_FEE_BPS = 400; // 4% of the full pot.
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant CANCEL_DELAY = 30 minutes;

    address public owner;
    address public resolver;
    address public feeRecipient;
    bool public paused;

    bool private locked;

    struct MatchData {
        address token;
        address player1;
        address player2;
        uint256 totalDeposited;
        uint64 createdAt;
        bool resolved;
        bool canceled;
    }

    mapping(address => bool) public supportedToken;
    mapping(address => bool) public everSupportedToken;
    mapping(bytes32 => MatchData) private matches;
    mapping(bytes32 => mapping(address => bool)) public deposited;

    event Deposited(bytes32 indexed matchId, address indexed player, address indexed token, uint256 amount);
    event Resolved(
        bytes32 indexed matchId,
        address indexed winner,
        address indexed token,
        uint256 winnerPayout,
        uint256 developerFee
    );
    event Refunded(bytes32 indexed matchId, address indexed token, uint256 amountPerPlayer);
    event EmergencyRefunded(bytes32 indexed matchId, address indexed token, uint256 totalRefunded);
    event UnmatchedCanceled(bytes32 indexed matchId, address indexed player, address indexed token, uint256 amount);
    event ResolverUpdated(address indexed resolver);
    event FeeRecipientUpdated(address indexed feeRecipient);
    event TokenSupportUpdated(address indexed token, bool supported);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event UnsupportedTokenRescued(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyResolver() {
        require(msg.sender == resolver, "Not resolver");
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

    constructor(address initialResolver, address initialFeeRecipient, address[] memory initialTokens) {
        require(initialResolver != address(0), "Resolver required");
        require(initialFeeRecipient != address(0), "Fee recipient required");
        require(initialTokens.length > 0, "Token required");

        owner = msg.sender;
        resolver = initialResolver;
        feeRecipient = initialFeeRecipient;
        supportedToken[NATIVE_TOKEN] = true;
        emit TokenSupportUpdated(NATIVE_TOKEN, true);

        for (uint256 i = 0; i < initialTokens.length; i++) {
            _setSupportedToken(initialTokens[i], true);
        }

        emit OwnershipTransferred(address(0), msg.sender);
        emit ResolverUpdated(initialResolver);
        emit FeeRecipientUpdated(initialFeeRecipient);
    }

    function deposit(bytes32 matchId, address token) external payable whenNotPaused nonReentrant {
        require(matchId != bytes32(0), "Match id required");
        require(supportedToken[token], "Unsupported token");
        require(!deposited[matchId][msg.sender], "Already deposited");

        MatchData storage matchData = matches[matchId];
        require(!matchData.resolved && !matchData.canceled, "Match closed");

        if (matchData.createdAt == 0) {
            matchData.token = token;
            matchData.createdAt = uint64(block.timestamp);
        } else {
            require(matchData.token == token, "Token mismatch");
        }

        require(matchData.player2 == address(0), "Match full");

        uint256 entryFee = entryFeeFor(token);
        if (token == NATIVE_TOKEN) {
            require(msg.value == entryFee, "Bad ETH amount");
        } else {
            require(msg.value == 0, "No ETH with token");
            _safeTransferFrom(token, msg.sender, address(this), entryFee);
        }

        deposited[matchId][msg.sender] = true;
        if (matchData.player1 == address(0)) {
            matchData.player1 = msg.sender;
        } else {
            matchData.player2 = msg.sender;
        }
        matchData.totalDeposited += entryFee;

        emit Deposited(matchId, msg.sender, token, entryFee);
    }

    function resolve(bytes32 matchId, address winner, bool draw)
        external
        onlyResolver
        whenNotPaused
        nonReentrant
    {
        MatchData storage matchData = matches[matchId];
        require(!matchData.resolved && !matchData.canceled, "Match closed");
        require(matchData.player1 != address(0) && matchData.player2 != address(0), "Match not funded");
        uint256 entryFee = entryFeeFor(matchData.token);
        require(matchData.totalDeposited == entryFee * 2, "Bad pot");

        matchData.resolved = true;

        if (draw) {
            _payout(matchData.token, matchData.player1, entryFee);
            _payout(matchData.token, matchData.player2, entryFee);
            emit Refunded(matchId, matchData.token, entryFee);
            return;
        }

        require(winner == matchData.player1 || winner == matchData.player2, "Winner not player");

        uint256 developerFee = (matchData.totalDeposited * DEVELOPER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 winnerPayout = matchData.totalDeposited - developerFee;

        _payout(matchData.token, feeRecipient, developerFee);
        _payout(matchData.token, winner, winnerPayout);

        emit Resolved(matchId, winner, matchData.token, winnerPayout, developerFee);
    }

    function cancelUnmatched(bytes32 matchId) external nonReentrant {
        MatchData storage matchData = matches[matchId];
        require(!matchData.resolved && !matchData.canceled, "Match closed");
        require(matchData.player1 != address(0) && matchData.player2 == address(0), "Not unmatched");
        require(msg.sender == matchData.player1, "Only depositor");
        require(block.timestamp >= matchData.createdAt + CANCEL_DELAY, "Too early");

        matchData.canceled = true;
        uint256 entryFee = entryFeeFor(matchData.token);
        _payout(matchData.token, matchData.player1, entryFee);

        emit UnmatchedCanceled(matchId, matchData.player1, matchData.token, entryFee);
    }

    function emergencyRefund(bytes32 matchId) external onlyOwner nonReentrant {
        require(paused, "Pause first");

        MatchData storage matchData = matches[matchId];
        require(!matchData.resolved && !matchData.canceled, "Match closed");
        require(matchData.totalDeposited > 0, "No deposits");

        matchData.canceled = true;

        uint256 entryFee = entryFeeFor(matchData.token);
        uint256 refunded;
        if (matchData.player1 != address(0)) {
            _payout(matchData.token, matchData.player1, entryFee);
            refunded += entryFee;
        }
        if (matchData.player2 != address(0)) {
            _payout(matchData.token, matchData.player2, entryFee);
            refunded += entryFee;
        }

        emit EmergencyRefunded(matchId, matchData.token, refunded);
    }

    function getMatch(bytes32 matchId)
        external
        view
        returns (
            address token,
            address player1,
            address player2,
            uint256 totalDeposited,
            uint64 createdAt,
            bool resolved,
            bool canceled
        )
    {
        MatchData storage matchData = matches[matchId];
        return (
            matchData.token,
            matchData.player1,
            matchData.player2,
            matchData.totalDeposited,
            matchData.createdAt,
            matchData.resolved,
            matchData.canceled
        );
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

    function setResolver(address newResolver) external onlyOwner {
        require(newResolver != address(0), "Resolver required");
        resolver = newResolver;
        emit ResolverUpdated(newResolver);
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "Fee recipient required");
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(newFeeRecipient);
    }

    function setSupportedToken(address token, bool supported) external onlyOwner {
        require(token != NATIVE_TOKEN, "Native token always supported");
        _setSupportedToken(token, supported);
    }

    function rescueUnsupportedToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0), "Token required");
        require(to != address(0), "Recipient required");
        require(!everSupportedToken[token], "Cannot rescue game token");
        require(amount > 0, "Amount required");
        require(amount <= IERC20(token).balanceOf(address(this)), "Amount too high");

        _safeTransfer(token, to, amount);
        emit UnsupportedTokenRescued(token, to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Owner required");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _setSupportedToken(address token, bool supported) private {
        require(token != address(0), "Token required");
        supportedToken[token] = supported;
        if (supported) {
            everSupportedToken[token] = true;
        }
        emit TokenSupportUpdated(token, supported);
    }

    function entryFeeFor(address token) public pure returns (uint256) {
        if (token == NATIVE_TOKEN) {
            return NATIVE_ENTRY_FEE_WEI;
        }
        return ERC20_ENTRY_FEE;
    }

    function _payout(address token, address to, uint256 value) private {
        if (token == NATIVE_TOKEN) {
            _safeTransferNative(to, value);
        } else {
            _safeTransfer(token, to, value);
        }
    }

    function _safeTransferNative(address to, uint256 value) private {
        (bool success, ) = to.call{value: value}("");
        require(success, "ETH transfer failed");
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, value)));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20.transferFrom, (from, to, value)));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TransferFrom failed");
    }

    receive() external payable {
        revert("Use deposit");
    }
}
