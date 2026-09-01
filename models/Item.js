const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    display_name: { type: String, required: true },
    price: { type: Number, required: true },
    category: String
});

module.exports = mongoose.model('Item', ItemSchema);