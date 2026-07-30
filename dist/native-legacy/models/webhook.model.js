var mongoose = require('mongoose');

const WebhookSchema = new mongoose.Schema({
    data: { type: Object },
    header: { type: Object },
    x_hook_key: {type:String},
    createAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    updatedAt: { type: mongoose.Schema.Types.Date, default: Date.now },
},{
    timestamps: {updatedAt: 'updatedAt' },
});


module.exports =  mongoose.model('webhook', WebhookSchema);
