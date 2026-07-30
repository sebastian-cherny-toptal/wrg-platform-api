const jwt = require("jsonwebtoken");
const user = require("../models/user.model");
const role = require("../models/role.model");
const { ObjectId } = require('mongoose').Types;
module.exports = async function (req, res, next) {
    const header = req.header("authorization") || req.query["authorization"];
    if (!header) {
        return res.status(401).json({msg: "No Token, Authorization Denied!"});
    }
    try {
        const bearer = header.split(' ');
        const token = bearer[1];
        const decoded = await jwt.verify(token, secrets.JWT_SECRET);
        req.user = await user.findOne({_id: ObjectId(decoded.user._id)}).populate('organizationId').populate('roleId').lean();
        req.salesUser = await user.findOne({projects:{$in:[ObjectId(req.user.projectId)]}, role:{$regex:/^sale/i}}).lean();
        return next();
    } catch (error) {
        console.log(error);
        res.status(401).json({msg: "Token is not Valid!", error});
    }
};
