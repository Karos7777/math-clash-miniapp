const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = 4191;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`OK ${message}`);
}

function txHash(label) {
  return `0x${Buffer.from(label).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}

async function api(route, options = {}) {
  const response = await fetch(`${BASE_URL}${route}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${route} failed: ${payload.error || response.status}`);
  }
  return payload;
}

async function waitForServer(child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (child.exitCode !== null) {
      throw new Error("server exited before health check");
    }
    try {
      const health = await api("/api/health");
      if (health.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("server did not start");
}

async function runScenario() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "math-clash-matchmaking-"));
  const stateFile = path.join(dir, "state.json");
  const env = {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    DEV_MODE: "true",
    NODE_ENV: "development",
    MATH_CLASH_STATE_FILE: stateFile,
    ESCROW_CONTRACT_ADDRESS: "0xC481234eE58f452Cd215099848e9CA653e563F8e"
  };
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  try {
    await waitForServer(child);
    assert(true, "server started with temporary storage");

    const wallet1 = "0x1000000000000000000000000000000000000001";
    const wallet2 = "0x2000000000000000000000000000000000000002";

    const reservation1 = await api("/api/matches/reserve", {
      method: "POST",
      body: {
        wallet: wallet1,
        devPlayerId: "player1",
        difficulty: "medium",
        token: "ETH"
      }
    });
    assert(reservation1.status === "funding", "searching match reservation created");
    assert(fs.existsSync(stateFile), "storage file created after first write");

    const joined1 = await api("/api/matches/join", {
      method: "POST",
      body: {
        wallet: wallet1,
        devPlayerId: "player1",
        matchId: reservation1.matchId,
        playerId: reservation1.playerId,
        escrowId: reservation1.payment.escrowId,
        difficulty: "medium",
        token: "ETH",
        txHash: txHash("player1")
      }
    });
    assert(joined1.status === "waiting", "paid player is restored as searching");

    const restored = await api(`/api/match/status?wallet=${wallet1}`);
    assert(restored.matchStatus === "searching", "refresh simulation restores searching status");
    assert(restored.match.matchId === reservation1.matchId, "refresh simulation restores same match");

    const xpAfterFirstJoin = restored.xp.total;
    await api("/api/matches/join", {
      method: "POST",
      body: {
        wallet: wallet1,
        devPlayerId: "player1",
        matchId: reservation1.matchId,
        playerId: reservation1.playerId,
        escrowId: reservation1.payment.escrowId,
        difficulty: "medium",
        token: "ETH",
        txHash: txHash("player1")
      }
    });
    const restoredAgain = await api(`/api/match/status?wallet=${wallet1}`);
    assert(restoredAgain.xp.total === xpAfterFirstJoin, "non-repeatable and daily XP are not double-awarded");

    const reservation2 = await api("/api/matches/reserve", {
      method: "POST",
      body: {
        wallet: wallet2,
        devPlayerId: "player2",
        difficulty: "medium",
        token: "ETH"
      }
    });
    assert(reservation2.matchId === reservation1.matchId, "second player attaches to searching match");

    const joined2 = await api("/api/matches/join", {
      method: "POST",
      body: {
        wallet: wallet2,
        devPlayerId: "player2",
        matchId: reservation2.matchId,
        playerId: reservation2.playerId,
        escrowId: reservation2.payment.escrowId,
        difficulty: "medium",
        token: "ETH",
        txHash: txHash("player2")
      }
    });
    assert(joined2.status === "matched", "second paid player creates matched match without auto-starting");
    assert(!joined2.currentQuestion, "matched match waits for player ready before question");

    const restoredActive1 = await api(`/api/match/status?wallet=${wallet1}`);
    assert(restoredActive1.matchStatus === "matched", "first player restores matched match after returning");
    assert(!restoredActive1.match.currentQuestion, "first player also waits for ready after refresh");

    const ready2 = await api(`/api/matches/${joined2.matchId}/ready`, {
      method: "POST",
      body: {
        wallet: wallet2,
        devPlayerId: "player2",
        playerId: joined2.playerId
      }
    });
    assert(ready2.status === "active", "ready starts only that player's timed run");
    assert(ready2.currentQuestion, "ready player receives current question");
    assert(!ready2.questions, "active match does not expose full question list");
    assert(typeof ready2.currentQuestion.expression === "string", "current question has expression");
    assert(!("answer" in ready2.currentQuestion), "current question does not expose answer");

    const restoredWaitingRun1 = await api(`/api/match/status?wallet=${wallet1}`);
    assert(restoredWaitingRun1.matchStatus === "playing", "first player sees active match after rival readies");
    assert(!restoredWaitingRun1.match.currentQuestion, "first player still has no question before pressing ready");

    const ready1 = await api(`/api/matches/${joined2.matchId}/ready`, {
      method: "POST",
      body: {
        wallet: wallet1,
        devPlayerId: "player1",
        playerId: restoredWaitingRun1.match.playerId
      }
    });
    assert(ready1.currentQuestion, "first player receives question only after pressing ready");

    const answered = await api(`/api/matches/${joined2.matchId}/answer`, {
      method: "POST",
      body: {
        wallet: wallet2,
        devPlayerId: "player2",
        playerId: joined2.playerId,
        answer: -999999,
        index: 0,
        ms: 1,
        isCorrect: true,
        winner: wallet2
      }
    });
    const answeredPlayer = answered.match.players.find((player) => player.id === joined2.playerId);
    assert(answeredPlayer.wrong === 1, "server ignores client isCorrect/winner fields");
    assert(answeredPlayer.score < 0, "wrong answer subtracts points");
    assert(answered.match.currentQuestion?.index === 1, "server advances to next question after one answer");

    const prodPort = PORT + 1;
    const prodStateFile = path.join(dir, "prod-state.json");
    const prodChild = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: {
        ...env,
        PORT: String(prodPort),
        NODE_ENV: "production",
        DEV_MODE: "false",
        MATH_CLASH_STATE_FILE: prodStateFile
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    try {
      await waitForServerOn(`http://127.0.0.1:${prodPort}`, prodChild);
      const prodResponse = await fetch(`http://127.0.0.1:${prodPort}/api/me?devPlayerId=player1`);
      const prodPayload = await prodResponse.json();
      assert(prodPayload.devMode === false, "production disables dev mode");
      assert(prodPayload.player === null, "production does not use devPlayerId without fid or wallet");
    } finally {
      prodChild.kill();
    }
  } catch (error) {
    if (logs) console.error(logs);
    throw error;
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function waitForServerOn(baseUrl, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (child.exitCode !== null) {
      throw new Error("production server exited before health check");
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const payload = await response.json();
      if (payload.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("production server did not start");
}

runScenario()
  .then(() => {
    console.log("");
    console.log("Matchmaking check passed.");
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
