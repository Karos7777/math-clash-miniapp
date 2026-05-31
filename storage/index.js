const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SOCIAL_TASKS = {
  share_result: {
    id: "share_result",
    type: "share_result",
    title: "Share result on Farcaster",
    description: "Share your Poker Clash result and add the cast URL for review.",
    xpReward: 20,
    repeatable: true,
    active: true
  },
  invite_friend: {
    id: "invite_friend",
    type: "invite_friend",
    title: "Invite a friend",
    description: "Invite a friend to play Poker Clash and submit proof for review.",
    xpReward: 50,
    repeatable: true,
    active: true
  },
  support_project: {
    id: "support_project",
    type: "support_project",
    title: "Support the project",
    description: "Follow, like, or recast a project update and submit proof for review.",
    xpReward: 15,
    repeatable: false,
    active: true
  }
};

function createStorage(options = {}) {
  const stateFile =
    options.stateFile ||
    process.env.MATH_CLASH_STATE_FILE ||
    path.join(options.dataDir || path.join(options.root || process.cwd(), "data"), "state.json");
  const databaseConfigured = Boolean(
    process.env.DATABASE_URL ||
      (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  );

  return {
    provider: databaseConfigured ? "json-with-database-env-configured" : "json",
    stateFile,
    loadState() {
      return loadJsonState(stateFile);
    },
    saveState(state) {
      saveJsonState(stateFile, normalizeState(state));
    },
    info() {
      return {
        provider: this.provider,
        stateFile,
        databaseConfigured
      };
    }
  };
}

function createEmptyState() {
  return {
    matches: {},
    stats: {},
    chatMessages: {},
    players: {},
    xpEvents: {},
    socialTasks: { ...DEFAULT_SOCIAL_TASKS },
    taskClaims: {}
  };
}

function normalizeState(raw) {
  const state = raw && typeof raw === "object" ? raw : {};
  return {
    matches: state.matches && typeof state.matches === "object" ? state.matches : {},
    stats: state.stats && typeof state.stats === "object" ? state.stats : {},
    chatMessages:
      state.chatMessages && typeof state.chatMessages === "object" ? state.chatMessages : {},
    players: state.players && typeof state.players === "object" ? state.players : {},
    xpEvents: state.xpEvents && typeof state.xpEvents === "object" ? state.xpEvents : {},
    socialTasks: {
      ...DEFAULT_SOCIAL_TASKS,
      ...(state.socialTasks && typeof state.socialTasks === "object" ? state.socialTasks : {})
    },
    taskClaims: state.taskClaims && typeof state.taskClaims === "object" ? state.taskClaims : {}
  };
}

function loadJsonState(stateFile) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  if (!fs.existsSync(stateFile)) {
    return createEmptyState();
  }

  try {
    return normalizeState(JSON.parse(fs.readFileSync(stateFile, "utf8")));
  } catch (error) {
    console.warn("Could not read state file, starting fresh:", error.message);
    return createEmptyState();
  }
}

function saveJsonState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const temp = `${stateFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(normalizeState(state), null, 2));
  fs.renameSync(temp, stateFile);
}

module.exports = {
  DEFAULT_SOCIAL_TASKS,
  createEmptyState,
  createStorage,
  normalizeState
};
