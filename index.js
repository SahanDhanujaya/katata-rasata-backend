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
  orderId: { type: String }, // <-- added: was being sent but silently dropped before
  items: Array,
  totalAmount: Number,
  date: { type: Date, default: Date.now },
});
const Sale = mongoose.model("Sale", SaleSchema);

// --- BACKUP MODEL ---
const BackupOrderSchema = new mongoose.Schema({
  order: mongoose.Schema.Types.Mixed,
  deletedAt: { type: Date, default: Date.now },
});
const BackupOrder = mongoose.model("BackupOrder", BackupOrderSchema);

// --- ITEM ROUTES ---

app.get("/api/items", async (req, res) => {
  const items = await Item.find();
  res.json(items);
});

app.post("/api/items", async (req, res) => {
  const newItem = new Item(req.body);
  await newItem.save();
  res.json(newItem);
});

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

app.post("/api/sales", async (req, res) => {
  const newSale = new Sale(req.body);
  const savedSale = await newSale.save();
  res.status(201).json(savedSale); // was `newSale` before save resolved fields like _id in some cases — return the saved doc explicitly
});

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

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const filter = { date: { $gte: start, $lte: end } };

    const [bills, allMatching] = await Promise.all([
      Sale.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
      Sale.find(filter),
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

app.get("/api/sales/daily", async (req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const sales = await Sale.find({ date: { $gte: start, $lte: end } });
  res.json(sales);
});

app.put("/api/sales/:id", async (req, res) => {
  try {
    const { items, totalAmount } = req.body;

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

// --- BLUETOOTH PRINT (Android tablet, "Bluetooth Print" by Mate Technologies) ---
// Tablet's browser navigates to my.bluetoothprint.scheme://<this route's URL>,
// the app fetches this route directly and prints the JSON it gets back.

function padLine(name, qty, priceStr) {
  const nameCol = name.length > 16 ? name.slice(0, 15) + "." : name.padEnd(16);
  const qtyCol = `x${qty}`.padStart(4);
  return `${nameCol}${qtyCol}  ${priceStr}`;
}

app.get("/api/print/bill/:saleId", async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.saleId);

    if (!sale) {
      return res.json([
        { type: 0, content: "Order not found", bold: 1, align: 1, format: 0 },
      ]);
    }

    const receipt = [
      { type: 0, content: "LAKA'S TAKE AWAY", bold: 1, align: 1, format: 1 },
      {
        type: 0,
        content: "Horana road Wadaka panadura",
        bold: 0,
        align: 1,
        format: 4,
      },
      { type: 0, content: "0763243716", bold: 0, align: 1, format: 4 },
      {
        type: 0,
        content: new Date(sale.date).toLocaleString(),
        bold: 0,
        align: 1,
        format: 4,
      },
      {
        type: 0,
        content: `ID: ${sale.orderId || sale._id}`,
        bold: 0,
        align: 1,
        format: 4,
      },
      {
        type: 0,
        content: "--------------------------------",
        bold: 0,
        align: 0,
        format: 0,
      },
    ];

    (sale.items || []).forEach((item) => {
      const priceStr = `Rs.${(item.price * item.qty).toFixed(2)}`;
      receipt.push({
        type: 0,
        content: padLine(item.name, item.qty, priceStr),
        bold: 0,
        align: 0,
        format: 0,
      });
    });

    receipt.push({
      type: 0,
      content: "--------------------------------",
      bold: 0,
      align: 0,
      format: 0,
    });
    receipt.push({
      type: 0,
      content: `TOTAL   Rs.${sale.totalAmount.toFixed(2)}`,
      bold: 1,
      align: 0,
      format: 1,
    });
    receipt.push({ type: 0, content: " ", bold: 0, align: 0, format: 0 });
    receipt.push({
      type: 0,
      content: "Thank You Visit Again!",
      bold: 1,
      align: 1,
      format: 0,
    });
    receipt.push({
      type: 0,
      content: "Powered by Trovix Tech",
      bold: 0,
      align: 1,
      format: 4,
    });
    receipt.push({
      type: 0,
      content: "0756519837/0764726820",
      bold: 0,
      align: 1,
      format: 4,
    });
    receipt.push({ type: 0, content: " ", bold: 0, align: 0, format: 0 });

    const responseObject = {};

    receipt.forEach((item, index) => {
      responseObject[index] = item;
    });

    res.json(responseObject);
  } catch (err) {
    console.error("Print bill error:", err.message);
    res.json([
      {
        type: 0,
        content: "Error generating receipt",
        bold: 1,
        align: 1,
        format: 0,
      },
    ]);
  }
});

app.use("/api", router);

app.listen(5000, () => console.log("🚀 Inventory Engine Online on Port 5000"));
