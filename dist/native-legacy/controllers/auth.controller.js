const User = require("../models/user.model");
const generateAccessToken = require("../middleware/jwtSign.middleware");
// const redis = require("redis").createClient({host: "localhost", port: 6379});
const helper = require("../helper/helper.functions");
const redis = require("../helper/redis.service");
const crypto = require("crypto");
const emailService = require("../helper/email.service");
const smsService = require("../helper/sms.service");
const _ = require("lodash");
const jwt = require("jsonwebtoken");
const { isValidObjectId } = require("mongoose");
const ObjectId = require("mongoose").Types.ObjectId;
const OrganizationProgram = require("../models/orgProgram.model");
const Org = require("../models/org.model");
const speakeasy = require("speakeasy");
const LoginSession = require("../models/loginSession.model");

class AuthController {
  constructor() {
    this.generate2faSecret = this.generate2faSecret.bind(this);
    this.register2fa = this.register2fa.bind(this);
  }
  // management login with 2fa
  async adminLogin(req, res, next) {
    try {
      if (req.method === "POST") {
        const { email, password } = req.body;
        if (!email || !password) {
          return res.status(400).json({
            message: "Please provide email and password",
          });
        }
        const user = await User.findOne({ email, role: { $ne: "client" } });
        if (!user) {
          return res.status(400).json({
            message: "User not found",
          });
        }
        if (user.role === "user") {
          return res.status(400).json({
            message: "You are not authorized to login",
          });
        }
        if (!user.comparePassword(password)) {
          return res.status(400).json({
            message: "Incorrect password",
          });
        }
        return res.status(200).json({
          success: true,
          message: "Login Successfully",
          data: { userId: user._id, "2faVerified": user["2faVerified"] },
        });
      }
      if (req.method === "PUT") {
        const { userId, enteredOtp } = req.body;
        const user = await User.findById(userId).populate("roleId");
        if (!user) {
          return res.status(400).json({
            message: "User not found",
          });
        }
        if (user.role === "user") {
          return res.status(400).json({
            message: "User is not an admin",
          });
        }
        if (user["2faVerified"] !== null && user["2faVerified"] !== false) {
          let tokenValidates = speakeasy.totp.verify({
            secret: user?.secret.base32,
            encoding: "base32",
            token: enteredOtp.toString(),
            window: 1,
          });
          if (tokenValidates) {
            const { accessToken, refreshToken } = generateAccessToken(user);
            return res.status(200).json({
              success: true,
              message: "Login Successful",
              data: {
                user,
                accessToken,
                refreshToken,
              },
            });
          } else {
            return res.status(400).json({
              success: false,
              message: "Invalid OTP",
            });
          }
        } else {
          const { accessToken, refreshToken } = generateAccessToken(user);
          return res.status(200).json({
            success: true,
            message: "Login Successful",
            data: {
              user,
              accessToken,
              refreshToken,
            },
          });
        }
      }
    } catch (err) {
      console.log(err, "error in adminLogin");
      return next({ success: false, err });
    }
  }

  // user login with username only
  async login(req, res, next) {
    try {
      const { username, userEmail } = req.body;
      const user = await User.findOne({ username: username })
        .sort({ createAt: -1 })
        .populate("organizationId")
        .populate("projectId")
        .populate("projects")
        .populate("programs");
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "username is incorrect" });
      }
      let organizationId = user.organizationId._id;
      const { accessToken, refreshToken } = generateAccessToken(user);
      let organizationProgram = await OrganizationProgram.find({
        organizationId: ObjectId(organizationId),
        projectId: ObjectId(user.projectId._id),
      })
        .populate("programId")
        .lean();
      organizationProgram.sort((a, b) =>
        a?.programId?.Program_Year.localeCompare(b?.programId?.Program_Year)
      );

      const salesUser = await User.aggregate([
        {
          $match: {
            $and: [
              { role: "sales" },
              { projects: { $in: [ObjectId(user.projectId._id)] } },
            ],
          },
        },
        {
          $project: {
            _id: 1,
            email: 1,
            fullName: 1,
          },
        },
      ]);
      let userData = user.toObject();
      userData["organizationProgram"] = organizationProgram;
      // userData["organizationProgram"]['programId'] = organizationProgram.map(item => item.programId);
      const data = {
        userData,
        accessToken,
        salesUser: salesUser ? salesUser[0] : [],
        refreshToken,
      };
      if (!req.query.skipLastLogin) {
        await Org.updateOne(
          { _id: ObjectId(organizationId) },
          { lastLogin: new Date() }
        );
      }

      // Save the login session in the LoginSession model
      if (!userEmail?.includes("workforcerg.com") && !req.query.skipLastLogin) {
        await LoginSession.create({
          username: user.username,
          organizationId: user.organizationId._id,
          email: userEmail || user.email,
          loginTime: new Date(),
        });
      }
      return res.status(200).json({ success: true, message: "true", data });
    } catch (err) {
      console.log(err);
      return res
        .status(500)
        .send({ success: false, message: "something went wrong." });
    }
  }

  async refreshToken(req, res) {
    try {
      const refreshTokenReq = req.body[`refreshToken`];
      if (refreshTokenReq) {
        const decoded = await jwt.verify(refreshTokenReq, secrets.JWT_SECRET);
        const user = await User.findById(decoded.user._id);
        const { accessToken, refreshToken } = generateAccessToken(user);
        const response = {
          message: "true",
          userId: decoded.user._id,
          role: decoded.user.role,
          token: accessToken,
          refreshToken: refreshToken,
        };
        res.status(200).json(response);
      } else {
        res.status(404).send("Invalid request");
      }
    } catch (err) {
      console.log(err.message, "error in refreshToken");
      if (err.message === "jwt expired")
        return res
          .status(401)
          .send({ success: false, message: "Token expired" });
      return res
        .status(500)
        .send({ success: false, message: "something went wrong." });
    }
  }

  async forgotPassword(req, res) {
    try {
      if (req.method === "POST") {
        const { email } = req.body;
        let user;
        if (!email) {
          return res.status(400).json({
            message: "Please provide email or username",
          });
        }

        user = await User.findOne({ email, role: { $ne: "client" } });
        if (!user || user.role == "user") {
          return res
            .status(404)
            .json({ success: false, message: "email is incorrect" });
        }
        const otp = helper.get6DigitOtp();
        const key = crypto.randomBytes(16).toString("hex");
        await redis.setValue(key, { userId: user._id, otp });
        await emailService.sendEmail({
          to: user.email,
          subject: "Reset Password",
          text: `Your OTP is: ${otp}`,
        });
        return res
          .status(200)
          .json({ success: true, message: "true", data: { key, otp } });
      } else if (req.method === "PUT") {
        const { key, otp, password } = req.body;
        if (!key || !otp || !password) {
          return res.status(400).json({
            message: "Please provide key, otp and password",
          });
        }
        const data = await redis.getValue(key);
        if (!data) {
          return res
            .status(404)
            .json({ success: false, message: "key is incorrect" });
        }
        if (data.otp != otp) {
          return res
            .status(404)
            .json({ success: false, message: "otp is incorrect" });
        }
        const user = await User.findById(data.userId);
        if (!user) {
          return res
            .status(404)
            .json({ success: false, message: "user is not found" });
        }
        if (password.length < 6)
          return res
            .status(403)
            .json({ message: "Password must be 6 characters long" });
        await user.setPassword(password);
        await user.save();
        await redis.deleteValue(key);
        return res
          .status(200)
          .json({ success: true, message: "password changed successfully" });
      } else {
        return res
          .status(404)
          .json({ success: false, message: "method is not allowed" });
      }
    } catch (err) {
      console.log(err);
      return res
        .status(500)
        .send({ success: false, message: "something went wrong." });
    }
  }

  async forgotUsername(req, res) {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "username is incorrect" });
      }
      await emailService.sendEmail({
        to: user.email,
        subject: "Username",
        text: `Your username is: ${user.username}`,
      });
      return res.json({ success: true, message: "sent successfully" });
    } catch (err) {
      console.log(err, "error in resetUsername");
      return res
        .status(500)
        .send({ success: false, message: "something went wrong." });
    }
  }

  async adminResetPassword(req, res) {
    try {
      const { userId } = req.body;
      if (!userId)
        return res
          .status(400)
          .json({ success: false, message: "Please provide userId" });
      const user = await User.findById({ _id: ObjectId(userId) });
      if (!user) return res.status(404).json({ message: "user not found" });
      const key = crypto.randomBytes(16).toString("hex");
      await redis.setValue(key, { userId: user._id });
      await emailService.sendEmail({
        to: user.email,
        subject: "Password Reset",
        text: `Click on the link to reset your password: ${secrets.FRONTEND_URL}/reset-password/?token=${key}`,
      });
      return res
        .status(200)
        .json({ success: true, message: "sent successfully" });
    } catch (e) {
      console.log(e, "error in adminResetPassword");
      return res
        .status(500)
        .send({ success: false, message: "something went wrong." });
    }
  }

  async adminResetPasswordVerify(req, res) {
    try {
      const { key, password } = req.body;
      if (!key || !password) {
        return res.status(400).json({
          message: "Please provide key and password",
        });
      }
      const data = await redis.getValue(key);
      if (!data) {
        return res
          .status(404)
          .json({ success: false, message: "key is incorrect" });
      }
      const user = await User.findById(data.userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "user is not found" });
      }
      if (password.length < 6)
        return res
          .status(403)
          .json({ message: "Password must be 6 characters long" });
      await user.setPassword(password);
      await user.save();
      await redis.deleteValue(key);
      return res
        .status(200)
        .json({ success: true, message: "password changed successfully" });
    } catch (e) {
      console.log(e, "error in resetPassword");
      return res
        .status(500)
        .send({ success: false, message: "something went wrong." });
    }
  }

  async adminGenerateTemporaryPassword(req, res) {
    try {
      const { userId } = req.body;
      if (!userId)
        return res
          .status(400)
          .json({ success: false, message: "Please provide userId" });

      const user = await User.findById({ _id: ObjectId(userId) });
      if (!user) return res.status(404).json({ message: "User not found" });

      // Generate random temporary password
      const tempPassword = crypto.randomBytes(4).toString('hex');

      // Save both hashed and plaintext temporary password
      await user.setPassword(tempPassword);
      user.passwordChangeRequired = true;  // Flag for forced password change
      user.temporaryPasswordPlaintext = tempPassword;  // Store plaintext for admin to view
      await user.save();

      // Return temporary credentials
      return res.status(200).json({
        success: true,
        message: "Temporary password generated",
        data: {
          username: user.username || user.email,
          email: user.email,
          temporaryPassword: tempPassword
        }
      });
    } catch (e) {
      console.log(e, "error in adminGenerateTemporaryPassword");
      return res
        .status(500)
        .send({ success: false, message: "Something went wrong." });
    }
  }

  async changePasswordAfterReset(req, res) {
    try {
      const { newPassword } = req.body;
      if (!newPassword)
        return res.status(400).json({ message: "Please provide new password" });

      if (newPassword.length < 6)
        return res.status(403).json({ message: "Password must be 6 characters long" });

      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      // No need to check old password if it's a reset flow

      await user.setPassword(newPassword);
      user.passwordChangeRequired = false;
      user.temporaryPasswordPlaintext = null;  // Clear the stored plaintext password
      await user.save();

      return res.status(200).json({ success: true, message: "Password changed successfully" });
    } catch (err) {
      console.log(err);
      return res.status(500).send({ success: false, message: "Something went wrong." });
    }
  }

  async getTemporaryPassword(req, res) {
    try {
      const { userId } = req.params;
      if (!userId)
        return res
          .status(400)
          .json({ success: false, message: "Please provide userId" });

      const user = await User.findById({ _id: ObjectId(userId) });
      if (!user) return res.status(404).json({ message: "User not found" });

      if (!user.temporaryPasswordPlaintext) {
        return res.status(404).json({
          success: false,
          message: "No temporary password set for this user"
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          username: user.username || user.email,
          email: user.email,
          temporaryPassword: user.temporaryPasswordPlaintext
        }
      });
    } catch (e) {
      console.log(e, "error in getTemporaryPassword");
      return res
        .status(500)
        .send({ success: false, message: "Something went wrong." });
    }
  }

  async register2fa(req, res) {
    try {
      return res.json(
        await this.generate2faSecret({
          userId: req.user._id,
          name: `WRG Admin: ${req.user.email}`,
        })
      );
    } catch (e) {
      console.log(e, "error in register2fa");
      return res
        .status(500)
        .send({ success: false, message: "something went wrong." });
    }
  }

  async validate2fa(req, res) {
    const { token } = req.body;
    try {
      const verified = speakeasy.totp.verify({
        secret: req.user.secret.base32,
        encoding: "base32",
        token,
      });
      await User.updateOne(
        { _id: req.user._id },
        { $set: { "2faVerified": verified } }
      );
      if (verified) {
        return res.json({ verified: true });
      } else {
        return res.json({ verified: false });
      }
    } catch (e) {
      console.log(e, "error in register2fa");
      return res
        .status(500)
        .send({ success: false, message: "something went wrong." });
    }
  }

  async generate2faSecret({ userId, name }) {
    return new Promise(async (resolve, reject) => {
      try {
        const secret = speakeasy.generateSecret({ name });
        await User.updateOne(
          { _id: ObjectId(userId) },
          { $set: { secret, "2faVerified": false } }
        );
        return resolve(secret);
      } catch (e) {
        console.log(e, "error in generate2faSecret");
        return reject(e);
      }
    });
  }
}

module.exports = new AuthController();
