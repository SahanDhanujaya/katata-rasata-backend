const express = require("express");

const { register, login, me, logout } = require("../controllers/auth.controller");
const verifyAuth = require("../middlewares/auth.middleware");

const router = express.Router();

router.post("/auth/register", register);
router.post("/auth/login", login);
router.post("/auth/logout", verifyAuth, logout);
router.get("/auth/me", verifyAuth, me);

module.exports = router;