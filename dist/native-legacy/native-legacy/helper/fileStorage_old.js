const { S3Client, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
let expireTimeinSec = 900;
let currentDate = new Date()
let expiresAt = currentDate.setSeconds(currentDate.getSeconds() + expireTimeinSec);

module.exports.uploadMediaToStorage = async function uploadMediaToStorage(data) {
    let {awsBucket,key} = data;
    return new Promise(async (resolve, reject) => {
        let awsConfig = {
            apiVersion: "2010-12-01",
            accessKeyId: secrets.AWS_ACCESS_KEY_ID,
            secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
            region: secrets.AWS_REGION,
            signatureVersion: 'v4'
        };
        let s3 = new AWS.S3(awsConfig);
        let obj = {};
        try {
            let bucketName = awsBucket ? `${awsBucket}-${(process.env.APP_ENV || "dev")}` : "custom-reports-dev";
            let params = {Bucket: bucketName, Key:key, Expires: expireTimeinSec};
            s3.getSignedUrl('putObject', params, function (err, url) {
                if (err) {
                    console.log(err);
                    return reject({success: false,err});
                }
                console.log("aws signed url", url);
                obj['signedUrl'] = url;
                obj['expires'] = expiresAt;
                return resolve({success: true,data:obj});
            });
        } catch (error) {
            return reject(error);
        }
    })
}

module.exports.getMediaFromStorage = async function getMediaFromStorage(params) {
    let {key,awsBucket} = params;
    return new Promise(async (resolve, reject) => {
        let awsConfig = {
            apiVersion: "2010-12-01",
            accessKeyId: secrets.AWS_ACCESS_KEY_ID,
            secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
            region: secrets.AWS_REGION,
            signatureVersion: 'v4'
        };
        let haedCheck = await headCheckObject({key,awsBucket});
        if(!haedCheck.success) return resolve({success: false});
        let obj = {};
        const s3 = new AWS.S3(awsConfig);
        let bucketName = awsBucket;
        let params = {Bucket: bucketName, Key: key, Expires: expireTimeinSec};
        s3.getSignedUrl('getObject', params, function (err, url) {
                if (err) {
                    console.log(err);
                    return resolve({success: false,err});
                }
                console.log("aws signed url", url);
                obj['signedUrl'] = url;
                obj['expires'] = expiresAt;
                return resolve({success: true,data:obj});

        })
    })
}

module.exports.deleteObjectFromS3  = async function deleteObjectFromS3(params){
    let {key,awsBucket} = params;
    return new Promise(async (resolve, reject) => {
        let awsConfig = {
            apiVersion: "2010-12-01",
            accessKeyId: secrets.AWS_ACCESS_KEY_ID,
            secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
            region: secrets.AWS_REGION,
            signatureVersion: 'v4'
        };
        let haedCheck = await headCheckObject({key,awsBucket});
        if(!haedCheck.success) return resolve({success: false});
        let obj = {};
        const s3 = new AWS.S3(awsConfig);
        let bucketName = awsBucket;
        let params = {Bucket: bucketName, Key: key};
        s3.deleteObject( params, function (err, data) {
                if (err) {
                    console.log(err);
                    return resolve({success: false,err});
                }
                console.log(data,"data")
                return resolve({success: true,data});

        })
    })
}
// check if file exists in s3
async function headCheckObject(params) {
    let {key,awsBucket} = params;
    let awsConfig = {
        apiVersion: "2010-12-01",
        accessKeyId: secrets.AWS_ACCESS_KEY_ID,
        secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
        region: secrets.AWS_REGION,
        signatureVersion: 'v4'
    };
    const s3 = new AWS.S3(awsConfig);
    let bucketName = awsBucket;
    return new Promise((resolve, reject) => {
        s3.headObject({Bucket: bucketName, Key: key}, function (err, data) {
            if (err) {
                console.log(err,"error in headObject");
                return resolve({success: false,err});
            }
            console.log("aws signed url", data);
            return resolve({success: true,data});
        });
    })
}

module.exports.downloadFileStream = async function downloadFileStream(params){
    let {key,awsBucket} = params;
    let haedCheck = await headCheckObject({key,awsBucket});
    if(!haedCheck.success) return false
    let awsConfig = {
        apiVersion: "2010-12-01",
        accessKeyId: secrets.AWS_ACCESS_KEY_ID,
        secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
        region: secrets.AWS_REGION,
        signatureVersion: 'v4'
    };
    const s3 = new AWS.S3(awsConfig);
    let bucketName = awsBucket;
    const stream = await s3.getObject({ Bucket: bucketName, Key: key}).createReadStream();
    return stream;
}

module.exports.s3Service = async function s3Service() {
    try{
        let awsConfig = {
            apiVersion: "2010-12-01",
            accessKeyId: secrets.AWS_ACCESS_KEY_ID,
            secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
            region: secrets.AWS_REGION,
            signatureVersion: 'v4'
        };
        return new AWS.S3(awsConfig);
    }catch (e) {
        console.log(e, "error in s3Service");
        return e;
    }

}

module.exports.uploadToS3WithStream = async function uploadToS3WithStream(params) {
    let {stream,key,contentType,awsBucket} = params;
    let awsConfig = {
        apiVersion: "2010-12-01",
        accessKeyId: secrets.AWS_ACCESS_KEY_ID,
        secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
        region: secrets.AWS_REGION,
        signatureVersion: 'v4'
    };
    const s3 = new AWS.S3(awsConfig);
    let bucketName = awsBucket;
    const data = {
        Bucket: bucketName,
        Key: key,
        Body: stream,
        ContentType: contentType,
    };
    return new Promise((resolve, reject) => {
        s3.putObject(data, function (err, data) {
            if (err) {
                console.log(err,"error in uploadToS3WithStream");
                return reject({success: false,err});
            }
            console.log("aws signed url", data);
            return resolve({success: true,data});
        });
    })
}

// upload file to s3 with file path
module.exports.uploadToS3WithFilePath = async function uploadToS3WithFilePath(params) {
    let {filePath,key,contentType,awsBucket} = params;
    let awsConfig = {
        apiVersion: "2010-12-01",
        accessKeyId: secrets.AWS_ACCESS_KEY_ID,
        secretAccessKey: secrets.AWS_SECRECT_ACCESS_KEY,
        region: secrets.AWS_REGION,
        signatureVersion: 'v4'
    };
    const s3 = new AWS.S3(awsConfig);
    let bucketName = awsBucket;
    const data = {
        Bucket: bucketName,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: contentType,
    };
    return new Promise((resolve, reject) => {
        s3.putObject(data, function (err, data) {
            if (err) {
                console.log(err,"error in uploadToS3WithFilePath");
                return reject({success: false,err});
            }
            console.log("aws signed url", data);
            return resolve({success: true,data});
        });
    })
}

