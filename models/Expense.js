// models/Expense.js
const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      trim: true,
      // Adjust this list to match your actual expense categories
      enum: [
        "Ingredients",
        "Utilities",
        "Rent",
        "Salaries",
        "Maintenance",
        "Packaging",
        "Transport",
        "Other",
      ],
    },
    description: {
      type: String,
      trim: true,
      default: "",
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
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "bank_transfer", "other"],
      default: "cash",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

// Speeds up the date-range queries the report route runs constantly
expenseSchema.index({ date: -1 });
expenseSchema.index({ category: 1, date: -1 });

module.exports = mongoose.model("Expense", expenseSchema);