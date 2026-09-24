const express = require("express");

const { register, login, me, logout, checkIsPaid, handlePayment } = require("../controllers/auth.controller");
const {verifyAuth, authorizeRole} = require("../middlewares/auth.middleware");
const ROLES = require("../enum/roles");

const authRouter = express.Router();

authRouter.post("/auth/register", register);
authRouter.post("/auth/login", login);
authRouter.post("/auth/logout", verifyAuth, logout);
authRouter.get("/auth/me", verifyAuth, me);
authRouter.get("/pay/check", verifyAuth, checkIsPaid)
authRouter.patch("/pay/pay", verifyAuth, handlePayment)

module.exports = authRouter;