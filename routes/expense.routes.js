// routes/expenses.js
const express = require("express");
const expenseRouter = express.Router();
const expenseController = require("../controllers/expenses.controller");

// IMPORTANT: "/report" must be registered before "/:id",
// otherwise Express treats "report" as an :id param.
expenseRouter.get("/report", expenseController.getExpenseReport);

expenseRouter.get("/", expenseController.getExpenses);
expenseRouter.get("/:id", expenseController.getExpenseById);
expenseRouter.post("/", expenseController.createExpense);
expenseRouter.put("/:id", expenseController.updateExpense);
expenseRouter.delete("/:id", expenseController.deleteExpense);

module.exports = expenseRouter;