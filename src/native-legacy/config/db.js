const mongoose = require("mongoose");

// Fix Mongoose 7 deprecation warning
mongoose.set('strictQuery', false);

const connectDB = async () => {
  try {
    console.log('🔧 Starting database connection process...');
    console.log('🔍 Environment variables:');
    console.log(`   APP_ENV: ${process.env.APP_ENV || 'undefined'}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
    console.log(`   ECS Container Metadata: ${!!(process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.ECS_CONTAINER_METADATA_URI || process.env.ECS_CONTAINER_METADATA_URI_V4)}`);

    global.secrets = await awsSecrets();
    console.log('✅ AWS Secrets retrieved successfully');

    await mongoConnect(secrets.MONGO_URI).catch((err) => {
      console.error('❌ MongoDB connection failed:', err.message);
      throw err;
    });
    console.log('✅ Database connection established successfully');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.error('💡 Troubleshooting steps:');
    console.error('   1. Check if AWS Secrets Manager secret exists: ha-staging-secrets or ha-prod-secrets');
    console.error('   2. Verify secret contains valid JSON with MONGO_URI key');
    console.error('   3. Ensure ECS task has proper IAM permissions to access Secrets Manager');
    console.error('   4. Check VPC configuration and security groups');

    // Don't exit immediately, let the app handle graceful failure
    throw error;
  }
};

function mongoConnect(url) {
  return new Promise((resolve, reject) => {
    mongoose.connect(
      url,
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        keepAlive: true,
        keepAliveInitialDelay: 300000,
      },
      function (err) {
        if (err) {
          console.log(err, "error from mongoose connect");
          return reject(err);
        } else {
          console.log("Mongoose Connected!");
          return resolve();
        }
      }
    );
  });
}

// Function to detect environment more robustly
function detectEnvironment() {
  // First priority: explicit APP_ENV setting with backward compatibility
  if (process.env.APP_ENV) {
    // Maintain backward compatibility: dev environment uses staging secrets
    if (process.env.APP_ENV === "dev") {
      return "staging";
    }
    return process.env.APP_ENV;
  }

  // Second priority: detect ECS environment from task metadata
  if (process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      process.env.ECS_CONTAINER_METADATA_URI ||
      process.env.ECS_CONTAINER_METADATA_URI_V4) {
    console.log("🔧 Detected ECS environment");

    // In ECS, if NODE_ENV is production, use prod secrets
    if (process.env.NODE_ENV === 'production') {
      console.log("🔧 ECS production environment detected, using prod secrets");
      return 'prod';
    }

    // Default to staging for ECS if not explicitly production
    console.log("🔧 ECS environment detected, defaulting to staging secrets");
    return 'staging';
  }

  // Third priority: detect based on hostname or other indicators
  const hostname = require('os').hostname();
  if (hostname.includes('prod') || hostname.includes('production')) {
    console.log("🔧 Production hostname detected, using prod secrets");
    return 'prod';
  }

  // Fourth priority: default fallback
  console.log("🔧 No environment detected, defaulting to staging");
  return 'staging';
}

function secretsFromEnv() {
  if (process.env.LEGACY_SECRETS_JSON) {
    console.log("🔧 Loading legacy secrets from LEGACY_SECRETS_JSON");
    return JSON.parse(process.env.LEGACY_SECRETS_JSON);
  }

  if (process.env.LEGACY_SECRETS_FILE) {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.resolve(process.env.LEGACY_SECRETS_FILE);
    console.log(`🔧 Loading legacy secrets from file: ${filePath}`);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  if (process.env.LEGACY_SECRETS_FROM_ENV === "true") {
    if (!process.env.MONGO_URI) {
      throw new Error(
        "LEGACY_SECRETS_FROM_ENV=true requires MONGO_URI (and usually JWT_SECRET)",
      );
    }
    console.log("🔧 Loading legacy secrets from process.env");
    return {
      MONGO_URI: process.env.MONGO_URI,
      JWT_SECRET: process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET,
      JWT_EXPIRE: process.env.JWT_EXPIRE || process.env.JWT_ACCESS_TTL || "15m",
      JWT_REFRESH_EXPIRE:
        process.env.JWT_REFRESH_EXPIRE ||
        `${process.env.JWT_REFRESH_TTL_DAYS || 30}d`,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      ZOHO_CLIENT_ID: process.env.ZOHO_CLIENT_ID,
      ZOHO_CLIENT_SECRET: process.env.ZOHO_CLIENT_SECRET,
      ZOHO_REFRESH_TOKEN: process.env.ZOHO_REFRESH_TOKEN,
      ZOHO_ACCOUNTS_URL: process.env.ZOHO_ACCOUNTS_URL,
      ZOHO_API_URL: process.env.ZOHO_API_URL || process.env.ZOHO_BASE_URL,
      CHECKMARKET_URL: process.env.CHECKMARKET_URL || process.env.CHECKMARKET_BASE_URL,
      "X-Master-Key": process.env.CHECKMARKET_MASTER_KEY || process.env.CHECKMARKET_API_KEY,
      "X-Key": process.env.CHECKMARKET_KEY || process.env.CHECKMARKET_API_KEY,
      SENDGRID_KEY: process.env.SENDGRID_KEY,
      sendGridDomain: process.env.SENDGRID_DOMAIN || process.env.sendGridDomain,
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
      TWILIO_FROM: process.env.TWILIO_FROM,
      FRONTEND_URL: process.env.FRONTEND_URL,
      CLIENT_URL: process.env.CLIENT_URL || process.env.FRONTEND_URL,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: process.env.AWS_REGION || "us-east-1",
      AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || process.env.OBJECT_STORAGE_BUCKET,
      redisHost: process.env.REDIS_HOST || process.env.redisHost,
    };
  }

  return null;
}

async function awsSecrets() {
  try {
    const fromEnv = secretsFromEnv();
    if (fromEnv) {
      return fromEnv;
    }

    const AWS = require('aws-sdk');

    const region = "us-east-1";
    const secretName = `ha-${process.env.APP_ENV === "dev" ? "staging" : process.env.APP_ENV}-secrets`;

    console.log(`🔍 Attempting to fetch secret: ${secretName} from region: ${region}`);

    if (process.env.APP_ENV === "dev") {
      console.log("🔧 Development mode - using 'wrg' AWS profile");
      AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: 'wrg' });
      console.log("🔑 AWS SDK v2 configured with 'wrg' profile");
    }
    
    // Configure AWS SDK
    AWS.config.update({ region });

    const secretsManager = new AWS.SecretsManager();
    const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    
    let secret;
    if (data.SecretString) {
      try {
        secret = JSON.parse(data.SecretString);
        console.log("✅ String secret successfully parsed as JSON");
      } catch (jsonError) {
        console.error("❌ String secret JSON parsing failed:", jsonError.message);
        console.error("❌ Raw secret content:", data.SecretString);
        throw new Error(`Secret value is not valid JSON. Please ensure the secret in AWS Secrets Manager is stored as a JSON string. Error: ${jsonError.message}`);
      }
    } else {
      // Handle binary secret
      const buff = Buffer.from(data.SecretBinary, "base64");
      const binaryString = buff.toString("ascii");
      console.log("🔍 Binary secret received (first 100 chars):", binaryString.substring(0, 100));
      try {
        secret = JSON.parse(binaryString);
        console.log("✅ Binary secret successfully parsed as JSON");
      } catch (jsonError) {
        console.error("❌ Binary secret JSON parsing failed:", jsonError.message);
        console.error("❌ Raw binary secret content:", binaryString);
        throw new Error(`Binary secret value is not valid JSON. Please ensure the secret in AWS Secrets Manager is stored as a JSON string. Error: ${jsonError.message}`);
      }
    }

    console.log("✅ AWS Secret successfully retrieved and parsed using SDK v2");
    return secret;

  } catch (error) {
    console.error("=====error in awsSecrets=====", error.message);
    if (error.name === 'SyntaxError' && error.message.includes('Unexpected token')) {
      console.error("💡 This error typically occurs when the secret value in AWS Secrets Manager is not stored as valid JSON.");
      console.error("💡 Please check your AWS Secrets Manager console and ensure the secret value is a properly formatted JSON string.");
    }
    throw error;
  }
}

module.exports = { connectDB };
