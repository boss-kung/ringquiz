// Game-wide constants. Do not put secrets here.

// Countdown display duration (purely visual, does not affect server timing)
export const COUNTDOWN_DISPLAY_SECONDS = 3;

// How frequently the host panel polls get-question-stats (ms)
export const STATS_POLL_INTERVAL_MS = 2_500;

// Maximum display name length (must match DB CHECK constraint)
export const DISPLAY_NAME_MAX_LENGTH = 30;
export const DISPLAY_NAME_MIN_LENGTH = 1;

// Leaderboard rows shown on screen at once
export const LEADERBOARD_VISIBLE_ROWS = 10;

// Server time sync: re-fetch offset after this many ms (in case of long sessions)
export const SERVER_TIME_RESYNC_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

// Realtime channel name (single room, single channel)
export const REALTIME_CHANNEL = 'game-room';
