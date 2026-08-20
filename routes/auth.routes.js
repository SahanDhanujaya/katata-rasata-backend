const express = require("express");

const { register, login, me, logout } = require("../controllers/auth.controller");
const {verifyAuth, authorizeRole} = require("../middlewares/auth.middleware");
const ROLES = require("../enum/roles");

const authRouter = express.Router();

authRouter.post("/auth/register", register);
authRouter.post("/auth/login", login);
authRouter.post("/auth/logout", verifyAuth, logout);
authRouter.get("/auth/me", verifyAuth, me);

module.exports = authRouter;