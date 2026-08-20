// models/Deposit.js
const mongoose = require("mongoose");

const depositSchema = new mongoose.Schema(
  {
    // Where the money came from — adjust this list to match your real
    // platforms/partners (delivery apps, card settlements, bank deposits...)
    source: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "Uber Eats",
        "PickMe Food",
        "Bank Deposit",
        "Card Settlement",
        "Cash Deposit",
        "Other",
      ],
    },
    amount: {
      type: Number,
      required: true,
      min: [0, "Amount cannot be negative"],
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Order ref / bank transaction id / settlement batch id, whatever the
    // source gives you to cross-check the deposit later
    referenceId: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "settled"],
      default: "pending",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

// Speeds up the date-range + source-filtered queries the report route runs
depositSchema.index({ date: -1 });
depositSchema.index({ source: 1, date: -1 });

module.exports = mongoose.model("Deposit", depositSchema);