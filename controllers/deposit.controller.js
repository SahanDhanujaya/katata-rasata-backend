// controllers/deposits.controller.js
const Deposit = require("../models/Deposit");

/**
 * GET /api/deposits/report?startDate&endDate
 * Source-aggregated totals for the given date range.
 */
exports.getDepositReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let filter = {};
    if (startDate && endDate) {
      filter.date = {
        $gte: new Date(`${startDate}T00:00:00.000Z`),
        $lte: new Date(`${endDate}T23:59:59.999Z`),
      };
    }

    const [deposits, sourceAgg] = await Promise.all([
      Deposit.find(filter).sort({ date: -1 }),
      Deposit.aggregate([
        { $match: filter },
        {
          $group: {
            _id: "$source",
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { total: -1 } },
      ]),
    ]);

    const totalDeposits = sourceAgg.reduce((sum, s) => sum + s.total, 0);

    res.json({
      deposits,
      totalDeposits,
      totalCount: deposits.length,
      bySource: sourceAgg.map((s) => ({
        source: s._id,
        total: s.total,
        count: s.count,
      })),
    });
  } catch (err) {
    console.error("Deposit report error:", err);
    res.status(500).json({ message: "Failed to generate deposit report" });
  }
};

/**
 * GET /api/deposits?startDate&endDate&source&status&page&limit
 * Paginated list, optionally filtered by date range, source, and/or status.
 */
exports.getDeposits = async (req, res) => {
  try {
    const { startDate, endDate, source, status } = req.query;
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
    if (source) filter.source = source;
    if (status) filter.status = status;

    const [deposits, totalCount] = await Promise.all([
      Deposit.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
      Deposit.countDocuments(filter),
    ]);

    res.json({
      deposits,
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit) || 1,
    });
  } catch (err) {
    console.error("Fetch deposits error:", err);
    res.status(500).json({ message: "Failed to fetch deposits" });
  }
};

/**
 * GET /api/deposits/:id
 */
exports.getDepositById = async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id);
    if (!deposit) {
      return res.status(404).json({ message: "Deposit not found" });
    }
    res.json(deposit);
  } catch (err) {
    console.error("Fetch deposit error:", err);
    res.status(400).json({ message: "Invalid deposit id" });
  }
};

/**
 * POST /api/deposits
 * Body: { source, amount, date?, referenceId?, status?, notes? }
 */
exports.createDeposit = async (req, res) => {
  try {
    const { source, amount, date, referenceId, status, notes } = req.body;

    if (!source || amount === undefined) {
      return res.status(400).json({ message: "source and amount are required" });
    }
    if (amount < 0) {
      return res.status(400).json({ message: "amount cannot be negative" });
    }

    const deposit = await Deposit.create({
      source,
      amount,
      date: date ? new Date(date) : undefined,
      referenceId,
      status,
      notes,
    });

    res.status(201).json(deposit);
  } catch (err) {
    console.error("Create deposit error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: "Failed to create deposit" });
  }
};

/**
 * PUT /api/deposits/:id
 * Partial updates allowed. Commonly used to flip status pending -> settled.
 */
exports.updateDeposit = async (req, res) => {
  try {
    const { source, amount, date, referenceId, status, notes } = req.body;

    if (amount !== undefined && amount < 0) {
      return res.status(400).json({ message: "amount cannot be negative" });
    }

    const update = {};
    if (source !== undefined) update.source = source;
    if (amount !== undefined) update.amount = amount;
    if (date !== undefined) update.date = new Date(date);
    if (referenceId !== undefined) update.referenceId = referenceId;
    if (status !== undefined) update.status = status;
    if (notes !== undefined) update.notes = notes;

    const deposit = await Deposit.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!deposit) {
      return res.status(404).json({ message: "Deposit not found" });
    }

    res.json(deposit);
  } catch (err) {
    console.error("Update deposit error:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    res.status(400).json({ message: "Failed to update deposit" });
  }
};

/**
 * DELETE /api/deposits/:id
 */
exports.deleteDeposit = async (req, res) => {
  try {
    const deposit = await Deposit.findByIdAndDelete(req.params.id);
    if (!deposit) {
      return res.status(404).json({ message: "Deposit not found" });
    }
    res.json({ message: "Deposit deleted", deposit });
  } catch (err) {
    console.error("Delete deposit error:", err);
    res.status(400).json({ message: "Invalid deposit id" });
  }
};