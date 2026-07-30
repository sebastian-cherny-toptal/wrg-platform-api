const mongoose = require('mongoose');


const roleSchema = new mongoose.Schema({
    role: {type: String, required: true},
    permissions: {type: Array, default: []},
    permissionObject: {type: Object, default: {}},
    createAt: {type: mongoose.Schema.Types.Date, default: Date.now},
    updatedAt: {type: mongoose.Schema.Types.Date, default: Date.now},
},{
    timestamps: {updatedAt: 'updatedAt' },
});


module.exports = mongoose.model('Role', roleSchema);
