var mongoose = require("mongoose"),
  Schema = mongoose.Schema,
  crypto = require("crypto");
SALT_WORK_FACTOR = 10;

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: mongoose.Schema.Types.String },
    email: { type: mongoose.Schema.Types.String, index: true },
    mobile: { type: mongoose.Schema.Types.String },
    username: { type: mongoose.Schema.Types.String, index: true, unique: true },
    profilePic: { type: mongoose.Schema.Types.String },
    password: { type: mongoose.Schema.Types.String },
    salt: { type: String },
    secret: { type: Object },
    "2faVerified": { type: Boolean, default: false },
    // organizationId for client role only
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organization",
      index: true,
    },
    dealId: { type: mongoose.Schema.Types.String, unique: true },
    organizationprogramId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizationprogram",
      index: true,
      unique: true,
    },
    mfa: { type: String, enum: ["mobile", "email"] },
    isActive: { type: mongoose.Schema.Types.Boolean, default: true },
    createAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    updatedAt: { type: mongoose.Schema.Types.Date, default: Date.now },
    emailSent: { type: Boolean, default: false },
    role: { type: String },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role" },
    // projectId for client role only
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "project" },
    projects: [{ type: mongoose.Schema.Types.ObjectId, ref: "project" }],
    programs: [{ type: mongoose.Schema.Types.ObjectId, ref: "program" }],
    permissions: { type: Object, default: {} },
    passwordChangeRequired: {
      type: Boolean,
      default: false
    },
    temporaryPasswordPlaintext: {
      type: String,
      default: null
    }
  },
  {
    timestamps: { updatedAt: "updatedAt" },
  }
);

UserSchema.pre("save", function (next) {
  var user = this;
  // only hash the password if it has been modified (or is new)
  if (user.role !== "client") {
    if (user.$isNew) {
      if (user.password.length < 6)
        return next({ message: "Password must be 6 characters long" });
      // generate a salt
      user.salt = crypto.randomBytes(10).toString("hex");
      user.password = crypto
        .pbkdf2Sync(user.password, this.salt, 1000, 64, `sha512`)
        .toString(`hex`);

      // added 2fa default for management role
      if (!user.mfa) {
        user["mfa"] = "email";
      }
    }
  }
  next();
});

UserSchema.methods.setPassword = async function (password) {
  this.salt = crypto.randomBytes(10).toString("hex");
  this.password = crypto
    .pbkdf2Sync(password, this.salt, 1000, 64, `sha512`)
    .toString(`hex`);
};
UserSchema.methods.comparePassword = function (password) {
  var hash = crypto
    .pbkdf2Sync(password, this.salt, 1000, 64, `sha512`)
    .toString(`hex`);
  return this.password === hash;
};

// to prevent the password from being sent to the client
UserSchema.set("toJSON", {
  transform: function (doc, ret, options) {
    delete ret.password;
    delete ret.salt;
    delete ret.permissions;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("User", UserSchema);
