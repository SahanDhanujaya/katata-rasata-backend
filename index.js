require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error(err));

// --- MODELS ---
const ItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true }
});
const Item = mongoose.model('Item', ItemSchema);

const SaleSchema = new mongoose.Schema({
    items: Array,
    totalAmount: Number,
    date: { type: Date, default: Date.now }
});
const Sale = mongoose.model('Sale', SaleSchema);

// --- ITEM ROUTES ---

// Get all items
app.get('/api/items', async (req, res) => {
    const items = await Item.find();
    res.json(items);
});

// Register new item
app.post('/api/items', async (req, res) => {
    const newItem = new Item(req.body);
    await newItem.save();
    res.json(newItem);
});

// Update existing item
app.put('/api/items/:id', async (req, res) => {
    try {
        const updatedItem = await Item.findByIdAndUpdate(
            req.params.id, 
            req.body, 
            { new: true }
        );
        res.json(updatedItem);
    } catch (err) {
        res.status(500).json({ error: "Update failed" });
    }
});

// Delete item
app.delete('/api/items/:id', async (req, res) => {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

// --- SALES & REPORTING ROUTES ---

// Save a new sale
app.post('/api/sales', async (req, res) => {
    const newSale = new Sale(req.body);
    await newSale.save();
    res.json(newSale);
});

/**
 * Enhanced Report Route
 * Query Params: startDate, endDate (YYYY-MM-DD)
 */
app.get('/api/sales/report', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        let start = new Date();
        let end = new Date();

        if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
        }
        
        // Normalize time to cover the full range of the selected days
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        const sales = await Sale.find({
            date: { $gte: start, $lte: end }
        }).sort({ date: -1 }); // Newest transactions first

        res.json(sales);
    } catch (err) {
        res.status(500).json({ error: "Failed to generate report" });
    }
});

// Original daily route (kept for backward compatibility if needed)
app.get('/api/sales/daily', async (req, res) => {
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(); end.setHours(23,59,59,999);
    const sales = await Sale.find({ date: { $gte: start, $lte: end } });
    res.json(sales);
});

app.listen(5000, () => console.log("🚀 Inventory Engine Online on Port 5000"));