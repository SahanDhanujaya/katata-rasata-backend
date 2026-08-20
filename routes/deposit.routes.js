// routes/deposits.js
const express = require("express");
const depositRouter = express.Router();
const depositController = require("../controllers/deposit.controller");

// IMPORTANT: "/report" must be registered before "/:id",
// otherwise Express treats "report" as an :id param.
depositRouter.get("/report", depositController.getDepositReport);

depositRouter.get("/", depositController.getDeposits);
depositRouter.get("/:id", depositController.getDepositById);
depositRouter.post("/", depositController.createDeposit);
depositRouter.put("/:id", depositController.updateDeposit);
depositRouter.delete("/:id", depositController.deleteDeposit);

module.exports = depositRouter;