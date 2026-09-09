const DEFAULT_WINDOW_MS = 10 * 1000;
const DEFAULT_MAX_REQUESTS = 8;
const DEFAULT_BLOCK_MS = 30 * 1000;

function toPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createAntiSpamMiddleware({ isExempt, windowMs, maxRequests, blockMs } = {}) {
  const requestWindowMs = toPositiveNumber(windowMs, DEFAULT_WINDOW_MS);
  const requestLimit = Math.max(1, Math.floor(toPositiveNumber(maxRequests, DEFAULT_MAX_REQUESTS)));
  const blockDurationMs = toPositiveNumber(blockMs, DEFAULT_BLOCK_MS);
  const users = new Map();

  // Dọn dữ liệu người dùng không còn hoạt động để Map không tăng vô hạn.
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [userId, state] of users) {
      state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < requestWindowMs);
      if (!state.timestamps.length && state.blockedUntil <= now) {
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
    const state = users.get(userId) || { timestamps: [], blockedUntil: 0, warningSent: false };

    if (state.blockedUntil > now) {
      if (!state.warningSent) {
        state.warningSent = true;
        try {
          await ctx.reply("🚫 Bạn thao tác quá nhanh. Vui lòng chờ vài giây rồi thử lại.");
        } catch {}
      }
      users.set(userId, state);
      return;
    }

    state.timestamps = state.timestamps.filter((timestamp) => now - timestamp < requestWindowMs);
    state.timestamps.push(now);

    if (state.timestamps.length > requestLimit) {
      state.blockedUntil = now + blockDurationMs;
      state.warningSent = false;
      users.set(userId, state);

      try {
        const blockSeconds = Math.ceil(blockDurationMs / 1000);
        await ctx.reply(`⚠️ Phát hiện thao tác quá liên tục. Bot tạm ngừng xử lý tài khoản của bạn trong ${blockSeconds} giây để chống spam.`);
      } catch {}
      return;
    }

    state.warningSent = false;
    users.set(userId, state);
    return next();
  };
}

module.exports = createAntiSpamMiddleware;
