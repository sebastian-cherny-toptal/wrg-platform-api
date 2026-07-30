const AWS = require('aws-sdk');
const fs = require('fs');

let expireTimeinSec = 900;
let currentDate = new Date();
let expiresAt = currentDate.setSeconds(currentDate.getSeconds() + expireTimeinSec);

// Helper function to get S3 client
function getS3Client() {
    // Configure AWS SDK
    AWS.config.update({
        region: secrets.AWS_REGION || 'us-east-1'
    });

    // Use profile in development
    if (process.env.APP_ENV === 'dev') {
        AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: 'wrg' });
    } else {
        AWS.config.credentials = {
            accessKeyId: secrets.AWS_ACCESS_KEY_ID,
            secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
        };
    }

    return new AWS.S3();
}

module.exports.uploadMediaToStorage = async function uploadMediaToStorage(data) {
    let { awsBucket, key } = data;
    try {
        const s3Client = getS3Client();
        let bucketName = awsBucket ? `${awsBucket}-${(process.env.APP_ENV || "dev")}` : "custom-reports-dev";

        const signedUrl = s3Client.getSignedUrl('putObject', {
            Bucket: bucketName,
            Key: key,
            Expires: expireTimeinSec
        });

        let obj = {
            signedUrl: signedUrl,
            expires: expiresAt
        };

        console.log("aws signed url", signedUrl);
        return { success: true, data: obj };
    } catch (error) {
        console.log("Error in uploadMediaToStorage:", error);
        return { success: false, err: error };
    }
}

module.exports.getMediaFromStorage = async function getMediaFromStorage(params) {
    let { key, awsBucket } = params;
    try {
        let headCheck = await headCheckObject({ key, awsBucket });
        if (!headCheck.success) return { success: false };

        const s3Client = getS3Client();
        let bucketName = awsBucket;

        const signedUrl = s3Client.getSignedUrl('getObject', {
            Bucket: bucketName,
            Key: key,
            Expires: expireTimeinSec
        });

        let obj = {
            signedUrl: signedUrl,
            expires: expiresAt
        };

        console.log("aws signed url", signedUrl);
        return { success: true, data: obj };
    } catch (error) {
        console.log("Error in getMediaFromStorage:", error);
        return { success: false, err: error };
    }
}

module.exports.deleteObjectFromS3 = async function deleteObjectFromS3(params) {
    let { key, awsBucket } = params;
    try {
        let headCheck = await headCheckObject({ key, awsBucket });
        if (!headCheck.success) return { success: false };

        const s3Client = getS3Client();
        let bucketName = awsBucket;

        const data = await s3Client.deleteObject({
            Bucket: bucketName,
            Key: key
        }).promise();

        console.log(data, "data");
        return { success: true, data };
    } catch (error) {
        console.log("Error in deleteObjectFromS3:", error);
        return { success: false, err: error };
    }
}

// check if file exists in s3
async function headCheckObject(params) {
    let { key, awsBucket } = params;
    try {
        const s3Client = getS3Client();
        let bucketName = awsBucket;

        const data = await s3Client.headObject({
            Bucket: bucketName,
            Key: key
        }).promise();

        console.log("head object response", data);
        return { success: true, data };
    } catch (error) {
        console.log(error, "error in headObject");
        return { success: false, err: error };
    }
}

module.exports.downloadFileStream = async function downloadFileStream(params) {
    let { key, awsBucket } = params;
    try {
        let headCheck = await headCheckObject({ key, awsBucket });
        if (!headCheck.success) return false;

        const s3Client = getS3Client();
        let bucketName = awsBucket;

        const response = await s3Client.getObject({
            Bucket: bucketName,
            Key: key
        }).promise();

        return response.Body; // This is a readable stream in AWS SDK v2
    } catch (error) {
        console.log("Error in downloadFileStream:", error);
        return false;
    }
}

module.exports.s3Service = async function s3Service() {
    try {
        return getS3Client();
    } catch (e) {
        console.log(e, "error in s3Service");
        return e;
    }
}

module.exports.uploadToS3WithStream = async function uploadToS3WithStream(params) {
    let { stream, key, contentType, awsBucket } = params;
    try {
        const s3Client = getS3Client();
        let bucketName = awsBucket;
        
        const data = await s3Client.upload({
            Bucket: bucketName,
            Key: key,
            Body: stream,
            ContentType: contentType,
        }).promise();
        
        console.log("upload response", data);
        return { success: true, data };
    } catch (error) {
        console.log(error, "error in uploadToS3WithStream");
        return { success: false, err: error };
    }
}

// upload file to s3 with file path
module.exports.uploadToS3WithFilePath = async function uploadToS3WithFilePath(params) {
    let { filePath, key, contentType, awsBucket } = params;
    try {
        const s3Client = getS3Client();
        let bucketName = awsBucket;
        
        const fileStream = fs.createReadStream(filePath);
        
        const data = await s3Client.upload({
            Bucket: bucketName,
            Key: key,
            Body: fileStream,
            ContentType: contentType,
        }).promise();
        
        console.log("upload response", data);
        return { success: true, data };
    } catch (error) {
        console.log(error, "error in uploadToS3WithFilePath");
        return { success: false, err: error };
    }
}
