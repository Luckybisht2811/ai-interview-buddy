import User from "../models/user.model.js";

export const getCurrentUser = async (req, res) => {
    try {
        const userId = req.userId;

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                message: "user does not found"
            });
        }

        return res.status(200).json({
            ...user.toObject(),
            nextRefreshAt: new Date(
                user.lastCreditRefresh.getTime() + 24 * 60 * 60 * 1000
            )
        });

    } catch (error) {
        return res.status(500).json({
            message: `failed to get currentUser ${error}`
        });
    }
};