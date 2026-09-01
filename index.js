require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const { createCanvas, registerFont, loadImage } = require("canvas");
const { authorizeRole, verifyAuth } = require("./middlewares/auth.middleware");
const authRouter = require("./routes/auth.routes");
const expenseRouter = require("./routes/expense.routes");
const depositRouter = require("./routes/deposit.routes");

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: ["http://localhost:5173", "https://katata-rasata.netlify.app"],
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
  display_name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
});
const Item = mongoose.model("Item", ItemSchema);

const SaleSchema = new mongoose.Schema({
  // <-- added: Don't Drop orderId
  orderId: { type: String, unique: true },
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

// app.get("/api/sales/report", async (req, res) => {
//   try {
//     const { startDate, endDate } = req.query;
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const skip = (page - 1) * limit;

//     let start = new Date();
//     let end = new Date();

//     if (startDate && endDate) {
//       start = new Date(startDate);
//       end = new Date(endDate);
//     }

//     start.setHours(0, 0, 0, 0);
//     end.setHours(23, 59, 59, 999);

//     const filter = { date: { $gte: start, $lte: end } };

//     const [bills, allMatching] = await Promise.all([
//       Sale.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
//       Sale.find(filter),
//     ]);

//     const totalRevenue = allMatching.reduce(
//       (sum, s) => sum + (s.totalAmount || 0),
//       0,
//     );
//     const totalCount = allMatching.length;

//     res.json({
//       bills,
//       totalRevenue,
//       page,
//       totalPages: Math.ceil(totalCount / limit) || 1,
//       totalCount,
//     });
//   } catch (err) {
//     res.status(500).json({ error: "Failed to generate report" });
//   }
// });

app.get("/api/sales/report", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    let start, end;

    if (startDate && endDate) {
      start = new Date(startDate + "T00:00:00.000Z");
      end = new Date(endDate + "T23:59:59.999Z");
    } else {
      const now = new Date();
      start = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          0,
          0,
          0,
          0,
        ),
      );
      end = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          23,
          59,
          59,
          999,
        ),
      );
    }

    const filter = { date: { $gte: start, $lte: end } };

    const [bills, revenueAgg] = await Promise.all([
      Sale.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
      Sale.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$totalAmount" },
            totalCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    const totalRevenue = revenueAgg[0]?.totalRevenue || 0;
    const totalCount = revenueAgg[0]?.totalCount || 0;

    res.json({
      bills,
      totalRevenue,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1,
      totalCount,
    });
  } catch (err) {
    console.error(err);
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
    const { items, totalAmount, orderId } = req.body;

    const updatePayload = {};

    if (Array.isArray(items)) {
      updatePayload.items = items;
    }

    if (typeof totalAmount !== "undefined") {
      updatePayload.totalAmount = Array.isArray(items)
        ? items.reduce((sum, it) => sum + it.price * it.qty, 0)
        : totalAmount;
    }

    if (typeof orderId !== "undefined") {
      updatePayload.orderId = orderId;
    }

    const updatedSale = await Sale.findByIdAndUpdate(
      req.params.id,
      updatePayload,
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

app.get(
  "/api/sales/backups",
  verifyAuth,
  authorizeRole("admin"),
  async (req, res) => {
    try {
      const backups = await BackupOrder.find().sort({ deletedAt: -1 });
      res.json(backups);
    } catch (err) {
      console.error("Fetch backups error:", err);
      res.status(500).json({ error: "Failed to fetch backups" });
    }
  },
);

// last-invoice
app.get('/api/sales/last-invoice', async (req, res) => {
  try {
    const lastInvoice = await Sale.findOne().sort({ date: -1 });
    res.json(lastInvoice);
  } catch (err) {
    console.error('Failed to fetch last invoice:', err);
    res.status(500).json({ error: 'Failed to fetch last invoice' });
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

try {
  registerFont(path.join(__dirname, "fonts", "NotoSansSinhala-Regular.ttf"), {
    family: "Noto Sans Sinhala",
  });
  registerFont(path.join(__dirname, "fonts", "NotoSansSinhala-Bold.ttf"), {
    family: "Noto Sans Sinhala",
    weight: "bold",
  });
} catch (err) {
  console.error("Failed to register Sinhala fonts:", err.message);
}

function sinhalaTextToBase64(text, options = {}) {
  const {
    fontSize = 32,
    fontFamily = "Noto Sans Sinhala",
    bold = false,
    padding = 8,
    width = 384,
  } = options;

  const canvas = createCanvas(width, fontSize + padding * 2); // <-- not document.createElement
  const ctx = canvas.getContext("2d");

  ctx.font = `${bold ? "bold " : ""}${fontSize}px "${fontFamily}"`;
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  ctx.fillText(text, width / 2, canvas.height / 2, width - padding * 2);

  return canvas.toBuffer("image/png").toString("base64"); // <-- not canvas.toDataURL
}

// Render a full receipt as a PNG (base64). widthMm defaults to 47mm (typical 58mm paper with 47mm print area)
function renderReceiptImage(sale, opts = {}) {
  const {
    widthMm = 47,
    dpiPerMm = 8, // ~203 DPI -> ~8 pixels/mm
    padding = 8,
    fontFamily = "Noto Sans Sinhala",
  } = opts;

  const width = Math.round(widthMm * dpiPerMm);

  // Build lines to draw
  const lines = [];
  // Keep hotel name size unchanged; increase other text sizes
  lines.push({ text: "HOTEL KATATA RASATA", size: 32, align: "center", bold: true });
  lines.push({ text: "NO: 20/7/8/9", size: 20, align: "center" });
  lines.push({ text: "Private Bus Stand Panadura", size: 20, align: "center" });
  lines.push({ text: "0722838281", size: 20, align: "center" });
  lines.push({ text: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Colombo", hour: "numeric", minute: "numeric", hour12: true }), size: 20, align: "center" });
  lines.push({ text: `ID: ${sale.orderId || sale._id}`, size: 20, align: "center" });
  lines.push({ text: "--------------------------------", size: 12, align: "center" });

  (sale.items || []).forEach((item) => {
    // increase item font size
    lines.push({ item: item, size: 22, align: "left" });
  });

  lines.push({ text: "--------------------------------", size: 12, align: "center" });
  lines.push({ text: `TOTAL   Rs.${(sale.totalAmount || 0).toFixed(2)}`, size: 40, align: "center", bold: true });
  lines.push({ text: "", size: 12 });
  lines.push({ text: "Thank You Visit Again!", size: 18, align: "center", bold: true });
  lines.push({ text: "Powered by Trovix Tech", size: 18, align: "center" });
  lines.push({ text: "0756519837/0764726820", size: 18, align: "center" });

  // Estimate height
  const lineHeights = lines.map((ln) => Math.ceil((ln.size || 12) * 1.3));
  const height = padding * 2 + lineHeights.reduce((a, b) => a + b, 0) + (sale.items || []).length * 6;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";

  let y = padding;

  lines.forEach((ln, idx) => {
    const size = ln.size || 12;
    ctx.font = `${ln.bold ? "bold " : ""}${size}px "${fontFamily}"`;
    ctx.textBaseline = "top";

    if (ln.item) {
      // Draw item row: name on left, qty & price on right
      const item = ln.item;
      const name = item.name;
      const qty = `x${item.qty}`;
      const price = `Rs.${(item.price * item.qty).toFixed(2)}`;

      const leftX = padding;
      const rightX = width - padding;

      // item name (may wrap) - simple truncation if too long
      const maxNameWidth = width - padding * 2 - 120;
      let drawName = name;
      while (ctx.measureText(drawName).width > maxNameWidth && drawName.length > 3) {
        drawName = drawName.slice(0, -1);
      }
      ctx.fillText(drawName, leftX, y);

      // qty + price on right
      const meta = `${qty}  ${price}`;
      const metaWidth = ctx.measureText(meta).width;
      ctx.fillText(meta, rightX - metaWidth, y);
      y += Math.ceil(size * 1.3);
      return;
    }

    const text = ln.text || "";
    const textWidth = ctx.measureText(text).width;

    if (ln.align === "center") {
      ctx.fillText(text, Math.round((width - textWidth) / 2), y);
    } else if (ln.align === "right") {
      ctx.fillText(text, width - padding - textWidth, y);
    } else {
      ctx.fillText(text, padding, y);
    }

    y += Math.ceil(size * 1.3);
  });

  return canvas.toBuffer("image/png").toString("base64");
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
      // keep hotel name format unchanged (do not increase)
      { type: 0, content: "HOTEL KATATA RASATA", bold: 1, align: 1, format: 1 },
      {
        type: 0,
        content: "NO: 20/7/8/9",
        bold: 1,
        align: 1,
        // larger detail font
        format: 0,
      },
      {
        type: 0,
        content: "Private Bus Stand Panadura",
        bold: 1,
        align: 1,
        format: 0,
      },
      { type: 0, content: "0722838281", bold: 1, align: 1, format: 0 },
      {
        type: 0,
        content: new Date().toLocaleTimeString("en-US", {
          timeZone: "Asia/Colombo",
          hour: "numeric",
          minute: "numeric",
          hour12: true,
        }),
        bold: 0,
        align: 1,
        format: 3,
      },
      {
        type: 0,
        content: `ID: ${sale.orderId || sale._id}`,
        bold: 0,
        align: 1,
        format: 3,
      },
      {
        type: 0,
        content: "--------------------------------",
        bold: 0,
        align: 1,
        format: 0,
      },
    ];

    (sale.items || []).forEach((item) => {
      const priceStr = `Rs.${(item.price * item.qty).toFixed(2)}`;
      receipt.push({
        type: 0,
        content: padLine(item.name, item.qty, priceStr),
        bold: 1,
        align: 1,
        // increased item font (keep hotel name unchanged)
        format: 0,
      });
    });

    receipt.push({
      type: 0,
      content: "--------------------------------",
      bold: 0,
      align: 1,
      format: 0,
    });
    receipt.push({
      type: 0,
      content: `TOTAL   Rs.${sale.totalAmount.toFixed(2)}`,
      bold: 1,
      align: 1,
      // increased total font
      format: 2,
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

    // If client requested an image mode, return a PNG base64 representation
    if (req.query && req.query.mode === "image") {
      try {
        const base64 = renderReceiptImage(sale, { widthMm: 47 });
        return res.json({ type: "image", base64 });
      } catch (err) {
        console.error("Failed to render image receipt:", err);
        // fall back to JSON text lines below
      }
    }

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

app.use("/api", authRouter);
app.use("/api/expenses", expenseRouter);
app.use("/api/deposits", depositRouter);

app.listen(5000, () => console.log("🚀 Inventory Engine Online on Port 5000"));
