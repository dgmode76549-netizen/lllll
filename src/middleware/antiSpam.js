const DEFAULT_WINDOW_MS = 10 * 1000;
const DEFAULT_MAX_REQUESTS = 8;
const DEFAULT_BLOCK_MS = 2 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_TRACKED_USERS = 10000;

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function notifyBlocked(ctx, message) {
  if (ctx.callbackQuery) {
    return ctx.answerCbQuery(message, { show_alert: true }).catch(() => {});
  }
  return ctx.reply(message).catch(() => {});
}

function createAntiSpamMiddleware({ isExempt, windowMs, maxRequests, blockMs, maxConcurrent, maxTrackedUsers } = {}) {
  const requestWindowMs = toPositiveNumber(windowMs, DEFAULT_WINDOW_MS);
  const requestLimit = Math.max(1, Math.floor(toPositiveNumber(maxRequests, DEFAULT_MAX_REQUESTS)));
  const blockDurationMs = toPositiveNumber(blockMs, DEFAULT_BLOCK_MS);
  const concurrentLimit = Math.max(1, Math.floor(toPositiveNumber(maxConcurrent, DEFAULT_MAX_CONCURRENT)));
  const trackedUsersLimit = Math.max(100, Math.floor(toPositiveNumber(maxTrackedUsers, DEFAULT_MAX_TRACKED_USERS)));
  const users = new Map();

  // Dọn dữ liệu người dùng không còn hoạt động để Map không tăng vô hạn.
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [userId, state] of users) {
      state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < requestWindowMs);
      if (!state.timestamps.length && state.blockedUntil <= now && state.inFlight === 0) {
        users.delete(userId);
      }
    }
  }, Math.max(requestWindowMs, 60 * 1000));
  cleanupTimer.unref?.();

  return async (ctx, next) => {
    const userId = ctx.from?.id;

    // Không chặn update hệ thống không gắn với người dùng hoặc tài khoản admin.
    if (!userId || ctx.from?.is_bot || isExempt?.(userId)) {
      return next();
    }

    const now = Date.now();
    if (!users.has(userId) && users.size >= trackedUsersLimit) {
      const evictable = [...users.entries()].find(([, item]) => item.inFlight === 0 && item.blockedUntil <= now);
      if (evictable) users.delete(evictable[0]);
    }
    const state = users.get(userId) || { timestamps: [], blockedUntil: 0, warningSent: false, inFlight: 0 };

    if (state.blockedUntil > now) {
      if (!state.warningSent) {
        state.warningSent = true;
        const remainingSeconds = Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
        await notifyBlocked(ctx, `🚫 Phát hiện thao tác liên tục. Bot tạm khóa ${Math.ceil(remainingSeconds / 60)} phút để chống spam.`);
      }
      users.set(userId, state);
      return;
    }

    // Chặn các callback/tin nhắn chạy chồng lên nhau, tránh một người dùng
    // bấm liên tục làm treo hàng đợi gọi API/Supabase.
    if (state.inFlight >= concurrentLimit) {
      await notifyBlocked(ctx, "⏳ Yêu cầu trước của bạn đang được xử lý, vui lòng chờ một chút.");
      return;
    }

    state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < requestWindowMs);
    state.timestamps.push(now);

    if (state.timestamps.length > requestLimit) {
      state.blockedUntil = now + blockDurationMs;
      state.warningSent = true;
      users.set(userId, state);

      const blockMinutes = Math.max(1, Math.ceil(blockDurationMs / 60000));
      await notifyBlocked(ctx, `⚠️ Bạn thao tác quá liên tục. Bot tạm ngừng xử lý trong ${blockMinutes} phút để chống spam.`);
      return;
    }

    state.warningSent = false;
    state.inFlight += 1;
    users.set(userId, state);

    try {
      return await next();
    } finally {
      const current = users.get(userId);
      if (current) {
        current.inFlight = Math.max(0, current.inFlight - 1);
        current.lastSeenAt = Date.now();
        users.set(userId, current);
      }
    }
  };
}

module.exports = createAntiSpamMiddleware;
