//TODO: need a redis service on aws from devops
const Redis = require("ioredis");
const redis = new Redis(
  process.env.REDIS_URL || {
    host: process.env.APP_ENV !== "dev" ? process.env.redisHost : "127.0.0.1",
    port: 6379,
  },
);

class RedisService {
  constructor() {
    this.redis = redis;
    this.setValue = this.setValue.bind(this);
    this.getValue = this.getValue.bind(this);
    this.deleteValue = this.deleteValue.bind(this);
    this.getDataFromCache = this.getDataFromCache.bind(this);
  }

  async setValue(key, payload, expireTime) {
    try {
      await this.redis.set(key, JSON.stringify(payload), "EX", expireTime || 86400);
      return { success: true };
    } catch (err) {
      console.log(err, "======Error setValueInRedis=======");
      throw { success: false };
    }
  }

  async getValue(key) {
    try {
      const result = await this.redis.get(key);
      return result ? JSON.parse(result) : null;
    } catch (err) {
      console.log(err, "======Error getValueFromRedis=======");
      return null;
    }
  }

  async deleteValue(key) {
    try {
      return await this.redis.del(key);
    } catch (err) {
      console.log(err, "======Error deleteValueFromRedis=======");
      return null;
    }
  }

  async getDataFromCache(req, cacheLabel = "") {
    try {
      if (req.query.clearCache === "true") {
        await this.deleteValue(cacheLabel);
        return null;
      }
      return await this.getValue(cacheLabel);
    } catch (e) {
      console.log(e, `error in ${cacheLabel} cache`);
      throw e;
    }
  }
}

module.exports = new RedisService();
