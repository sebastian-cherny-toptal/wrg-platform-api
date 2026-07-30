const redis = require("../helper/redis.service");
const connectDB = require("../config/db");


// will not use this middleware
// exports.updateSecrets = async (req, res, next) => {
//     try {
//         let payloadJson = await redis.getValue('secrets1');
//         if (!payloadJson) {
//             payloadJson = await awsSecrets();
//         }
//         global.secrets = payloadJson;
//         next();
//     } catch (e) {
//         console.log("=====error updateSecrets=======", e);
//         res.status(500).send({
//             message: "Error while updating secrets"
//         });
//     }
//
// };

// This function is not used anymore - keeping for reference
// The awsSecrets function has been migrated to AWS SDK v3 in config/db.js
function awsSecrets() {
    // This function is deprecated - use the one in config/db.js instead
    throw new Error('awsSecrets function is deprecated. Use the one in config/db.js instead.');
}
