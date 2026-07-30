var mongoose = require("mongoose");

const LoginSession = new mongoose.Schema(
    {
        username: { type: String, required: true },
        organizationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "organization",
            required: true,
        },
        email: { type: String, required: true },
        loginTime: { type: mongoose.Schema.Types.Date, default: Date.now, required: true },
    },
    {
        timestamps: { createdAt: "loginTime" },
    }
);

module.exports = mongoose.model("LoginSession", LoginSession);