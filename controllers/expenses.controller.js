// controllers/expenses.controller.js
const Expense = require("../models/Expense");

/**
 * GET /api/expenses/report?startDate&endDate
 * Category-aggregated totals for the given date range.
 */
exports.getExpenseReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let filter = {};
    if (startDate && endDate) {
      filter.date = {
        $gte: new Date(`${startDate}T00:00:00.000Z`),
        $lte: new Date(`${endDate}T23:59:59.999Z`),
      };
    }

    const [expenses, categoryAgg] = await Promise.all([
      Expense.find(filter).sort({ date: -1 }),
      Expense.aggregate([
        { $match: filter },
        {
          $group: {
            _id: "$category",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),
    ]);

    const totalExpenses = categoryAgg.reduce((sum, c) => sum + c.total, 0);

    res.json({
      expenses,
      totalExpenses,
      totalCount: expenses.length,
      byCategory: categoryAgg.map((c) => ({
        category: c._id,
        total: c.total,
        count: c.count,
      })),
    });
  } catch (err) {
    console.error("Expense report error:", err);
    res.status(500).json({ message: "Failed to generate expense report" });
  }
};

/**
 * GET /api/expenses?startDate&endDate&category&page&limit
 * Paginated list, optionally filtered by date range and/or category.
 */
exports.getExpenses = async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const filter = {};
    if (startDate && endDate) {
      filter.date = {
        $gte: new Date(`${startDate}T00:00:00.000Z`),
        $lte: new Date(`${endDate}T23:59:59.999Z`),
      };
    }
    if (category) {
      filter.category = category;
    }

    const [expenses, totalCount] = await Promise.all([
      Expense.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
      Expense.countDocuments(filter),
    ]);

    res.json({
      expenses,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    });
  } catch (err) {
    console.error("Fetch expenses error:", err);
    res.status(500).json({ message: "Failed to fetch expenses" });
  }
};

/**
 * GET /api/expenses/:id
 */
exports.getExpenseById = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }
    res.json(expense);
  } catch (err) {
    console.error("Fetch expense error:", err);
    res.status(400).json({ message: "Invalid expense id" });
  }
};

/**
 * POST /api/expenses
 * Body: { category, amount, description?, date?, paymentMethod?, notes? }
 */
exports.createExpense = async (req, res) => {
  try {
    const { category, amount, description, date, paymentMethod, notes } = req.body;

    if (!category || amount === undefined) {
      return res.status(400).json({ message: "category and amount are required" });
    }
    if (amount < 0) {
      return res.status(400).json({ message: "amount cannot be negative" });
    }

    const expense = await Expense.create({
      category,
      amount,
      description,
      date: date ? new Date(date) : undefined,
      paymentMethod,
      notes,
    });

    res.status(201).json(expense);
  } catch (err) {
    console.error("Create expense error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to create expense" });
  }
};

/**
 * PUT /api/expenses/:id
 * Partial updates allowed.
 */
exports.updateExpense = async (req, res) => {
  try {
    const { category, amount, description, date, paymentMethod, notes } = req.body;

    if (amount !== undefined && amount < 0) {
      return res.status(400).json({ message: "amount cannot be negative" });
    }

    const update = {};
    if (category !== undefined) update.category = category;
    if (amount !== undefined) update.amount = amount;
    if (description !== undefined) update.description = description;
    if (date !== undefined) update.date = new Date(date);
    if (paymentMethod !== undefined) update.paymentMethod = paymentMethod;
    if (notes !== undefined) update.notes = notes;

    const expense = await Expense.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    res.json(expense);
  } catch (err) {
    console.error("Update expense error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(400).json({ message: "Failed to update expense" });
  }
};

/**
 * DELETE /api/expenses/:id
 */
exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }
    res.json({ message: "Expense deleted", expense });
  } catch (err) {
    console.error("Delete expense error:", err);
    res.status(400).json({ message: "Invalid expense id" });
  }
};