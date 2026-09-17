const CREDIT_REFILL_AMOUNT = 500;
const REFILL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const refreshCreditsIfDue = async (user) => {
    const now = Date.now();
    const last = user.lastCreditRefresh
        ? new Date(user.lastCreditRefresh).getTime()
        : 0;

    if (now - last >= REFILL_INTERVAL_MS) {
        user.credits = CREDIT_REFILL_AMOUNT;
        user.lastCreditRefresh = new Date();
        await user.save();
    }

    return user;
};