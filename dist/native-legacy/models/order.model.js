var mongoose = require("mongoose");

const Ordets = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organization",
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
    },
    programId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "program",
    },
    itemTitle: { type: String },
    organizationprogramId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizationprogram",
    },
    paymentId: { type: String },
    keys: { type: Object },
    isPaid: { type: Boolean, default: false },
    amount: { type: String },
    currency: { type: String },
    paymentMethod: { type: String },
    createAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    updatedAt: { type: mongoose.Schema.Types.Date, default: Date.now },
  },
  {
    timestamps: { updatedAt: "updatedAt", createdAt: "createAt" },
  }
);

module.exports = mongoose.model("order", Ordets);
