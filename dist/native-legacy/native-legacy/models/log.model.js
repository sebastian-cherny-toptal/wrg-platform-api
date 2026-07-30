const mongoose = require("mongoose");

const logSchema = new mongoose.Schema({
  status: {
    type: String,
    required: true,
    enum: ["Success", "Failure"],
  },
  description: {
    type: String,
    required: false,
  },
  errorMessage: {
    type: String,
    required: false,
  },
  errorType: {
    type: String,
    required: false,
  },
  errorStepsToResolve: {
    type: String,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Log", logSchema);
