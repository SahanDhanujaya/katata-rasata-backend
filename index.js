require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const router = require("./routes/auth.routes");
const cookieParser = require("cookie-parser");

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: ["http://localhost:5173", "https://lakas-take-away.netlify.app"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(cookieParser());

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error(err));

// --- MODELS ---
const ItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
});
const Item = mongoose.model("Item", ItemSchema);

const SaleSchema = new mongoose.Schema({
  items: Array,
  totalAmount: Number,
  date: { type: Date, default: Date.now },
});
const Sale = mongoose.model("Sale", SaleSchema);

// --- BACKUP MODEL ---
const BackupOrderSchema = new mongoose.Schema({
  order: mongoose.Schema.Types.Mixed, // snapshot of the deleted item
  deletedAt: { type: Date, default: Date.now },
});
const BackupOrder = mongoose.model("BackupOrder", BackupOrderSchema);

// --- ITEM ROUTES ---

// Get all items
app.get("/api/items", async (req, res) => {
  const items = await Item.find();
  res.json(items);
});

// Register new item
app.post("/api/items", async (req, res) => {
  const newItem = new Item(req.body);
  await newItem.save();
  res.json(newItem);
});

// Update existing item
app.put("/api/items/:id", async (req, res) => {
  try {
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    res.json(updatedItem);
  } catch (err) {
    res.status(500).json({ error: "Update failed" });
  }
});

// Delete item by ID
app.delete("/api/items/:id", async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("Item delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// --- SALES & REPORTING ROUTES ---

// Save a new sale
app.post("/api/sales", async (req, res) => {
  const newSale = new Sale(req.body);
  const savedSale = await newSale.save();
  if (savedSale) {
  }
  res.status(201).json(newSale);
});

/**
 * Enhanced Report Route — now paginated
 * Query Params: startDate, endDate (YYYY-MM-DD), page, limit
 * Returns: { bills: Sale[], totalRevenue: number, page, totalPages }
 */
app.get("/api/sales/report", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    let start = new Date();
    let end = new Date();

    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    }

    // Normalize time to cover the full range of the selected days
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const filter = { date: { $gte: start, $lte: end } };

    const [bills, allMatching] = await Promise.all([
      Sale.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
      Sale.find(filter), // used to compute total revenue across the whole range, not just this page
    ]);

    const totalRevenue = allMatching.reduce(
      (sum, s) => sum + (s.totalAmount || 0),
      0,
    );
    const totalCount = allMatching.length;

    res.json({
      bills,
      totalRevenue,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1,
      totalCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// Original daily route (kept for backward compatibility if needed)
app.get("/api/sales/daily", async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const sales = await Sale.find({ date: { $gte: start, $lte: end } });
  res.json(sales);
});

// Update an existing sale (Super Admin edit)
app.put("/api/sales/:id", async (req, res) => {
  try {
    const { items, totalAmount } = req.body;

    // Recalculate the total server-side rather than trusting the client blindly
    const recalculatedTotal = Array.isArray(items)
      ? items.reduce((sum, it) => sum + it.price * it.qty, 0)
      : totalAmount;

    const updatedSale = await Sale.findByIdAndUpdate(
      req.params.id,
      { items, totalAmount: recalculatedTotal },
      { new: true, runValidators: true },
    );

    if (!updatedSale) {
      return res.status(404).json({ error: "Sale not found" });
    }

    res.json(updatedSale);
  } catch (err) {
    console.error("Sale update error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

app.delete("/api/sales/:id", async (req, res) => {
  try {
    const backup = await Sale.findById(req.params.id);

    if (!backup) {
      return res.status(404).json({ error: "Sale not found" });
    }

    await BackupOrder.create({ order: backup.toObject() });
    await Sale.findByIdAndDelete(req.params.id);

    res.json({ message: "Deleted", id: req.params.id });
  } catch (err) {
    console.error("Sale delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

app.get("/api/sales/backups", async (req, res) => {
  try {
    const backups = await BackupOrder.find().sort({ deletedAt: -1 });
    res.json(backups);
  } catch (err) {
    console.error("Fetch backups error:", err);
    res.status(500).json({ error: "Failed to fetch backups" });
  }
});

const escpos = require("escpos");
const SerialPortModule = require("escpos-serialport");

escpos.SerialPort = SerialPortModule.SerialPort || SerialPortModule.default || SerialPortModule;

// Sanity check on startup — fail loudly instead of mysteriously at print time
if (typeof escpos.SerialPort !== "function") {
  console.error("FATAL: escpos.SerialPort did not resolve to a constructor. Check escpos-serialport version.");
}

const CANDIDATE_PORTS = ["COM8", "COM7", "COM5", "/dev/rfcomm0"];
const CANDIDATE_BAUD_RATES = [9600, 19200, 38400, 57600];
const CONNECT_TIMEOUT_MS = 4000;
const WARMUP_DELAY_MS = 400;

function tryOpenPort(port, baudRate) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const device = new escpos.SerialPort(port, {
      baudRate,
      autoOpen: false,
      lock: false,
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out on ${port} @ ${baudRate}`));
      }
    }, CONNECT_TIMEOUT_MS);

    device.open((error) => {
      if (settled) return;
      clearTimeout(timeout);
      settled = true;

      if (error) {
        reject(new Error(`${port} @ ${baudRate}: ${error.message}`));
      } else {
        setTimeout(() => resolve(device), WARMUP_DELAY_MS);
      }
    });
  });
}

async function connectToPrinter() {
  const errors = [];

  for (const port of CANDIDATE_PORTS) {
    for (const baudRate of CANDIDATE_BAUD_RATES) {
      try {
        const device = await tryOpenPort(port, baudRate);
        const printer = new escpos.Printer(device);
        console.log(`Connected on ${port} @ ${baudRate} baud`);
        return { device, printer, port, baudRate };
      } catch (err) {
        errors.push(err.message);
        console.warn("Connect attempt failed:", err.message);
      }
    }
  }

  throw new Error(
    `No printer found on any port/baud combo. Tried: ${errors.join(" | ")}`,
  );
}

function safeClose(device, cb) {
  try {
    device.close(cb);
  } catch (err) {
    console.warn("Error closing device:", err.message);
    if (cb) cb();
  }
}

app.post("/api/print-bluetooth", async (req, res) => {
  const { items, total, orderId } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "No items provided" });
  }
  if (typeof total !== "number" || Number.isNaN(total)) {
    return res.status(400).json({ error: "Invalid total" });
  }
  if (!orderId) {
    return res.status(400).json({ error: "Missing orderId" });
  }
  for (const item of items) {
    if (
      !item.name ||
      typeof item.qty !== "number" ||
      typeof item.price !== "number"
    ) {
      return res
        .status(400)
        .json({ error: `Invalid item: ${JSON.stringify(item)}` });
    }
  }

  let device;
  let responded = false;

  try {
    const conn = await connectToPrinter();
    device = conn.device;
    const printer = conn.printer;

    printer
      .font("a")
      .align("ct")
      .style("b")
      .size(1, 1)
      .text("LAKA'S TAKE AWAY")
      .style("normal")
      .size(0, 0)
      .text("Horana road Wadaka panadura")
      .text("0763243716")
      .text(new Date().toLocaleString())
      .text(`ID: ${orderId}`)
      .text("--------------------------------");

    printer.align("lt").style("b");
    printer.tableCustom([
      { text: "Item", align: "LEFT", width: 0.5 },
      { text: "Qty", align: "CENTER", width: 0.2 },
      { text: "Price", align: "RIGHT", width: 0.3 },
    ]);
    printer.style("normal");

    items.forEach((item) => {
      printer.tableCustom([
        { text: item.name, align: "LEFT", width: 0.5 },
        { text: `x${item.qty}`, align: "CENTER", width: 0.2 },
        {
          text: `Rs.${(item.price * item.qty).toFixed(2)}`,
          align: "RIGHT",
          width: 0.3,
        },
      ]);
    });

    printer
      .text("--------------------------------")
      .align("rt")
      .style("b")
      .size(1, 1)
      .text(`TOTAL: Rs.${total.toFixed(2)}`)
      .size(0, 0);

    printer
      .align("ct")
      .style("b")
      .text("\nThank You Visit Again!")
      .style("normal")
      .text("Powered by Trovix Tech")
      .text("0756519837/0764726820")
      .text(`Copyright (c) ${new Date().getFullYear()}`)
      .text("\n")
      .cut()
      .close(() => {
        responded = true;
        res.json({ success: true, message: "Receipt sent to printer" });
      });
  } catch (err) {
    console.error("Print job failed:", err.message);
    if (device) safeClose(device);
    if (!responded) {
      res.status(500).json({
        error: "Failed to connect to printer",
        detail: err.message,
      });
    }
  }
});

app.get("/api/printer/status", async (req, res) => {
  try {
    const { device, port, baudRate } = await connectToPrinter();
    safeClose(device);
    res.json({ connected: true, port, baudRate });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});
app.use("/api", router);

app.listen(5000, () => console.log("🚀 Inventory Engine Online on Port 5000"));
