const _ = require("lodash");
const orderModel = require("../models/order.model");
const orgModel = require("../models/org.model");
const ObjectId = require("mongoose").Types.ObjectId;
const { asyncForEach } = require("../helper/helper.functions");
const zohoService = require("../helper/zoho.service");
const emailService = require("../helper/email.service");
class Ecom {
  async stripePaymentIntent(req, res) {
    try {
      if (_.isEmpty(data.amount)) return res.send("bad request");
      const stripe = require("stripe")(secrets["STRIPE_SECRET_KEY"]);
      let stripeUser;
      const currency = req.body.currency?.toUpperCase() || "USD";
      const allowedCurrencies = ["USD", "CAD", "GBP"];
      if (!allowedCurrencies.includes(currency)) {
        return res.status(400).send("Bad request: Invalid currency");
      }
      if (req.user.organizationId.stripeCustomerId) {
        stripeUser = await stripe.customers.retrieve(
          req.user.organizationId.stripeCustomerId
        );
      } else {
        stripeUser = await stripe.customers.create({
          email: req.user.email,
          name: req.user.organizationId.Account_Name,
        });
        await orgModel.updateOne(
          { _id: ObjectId(req.user.organizationId._id) },
          {
            $set: {
              stripeCustomerId: req.user.organizationId.stripeCustomerId,
            },
          }
        );
      }
      const paymentIntent = await stripe.paymentIntents.create({
        amount: data.amount * 1000,
        currency: currency,
        customer: stripeUser.stripeCustomerId,
      });
      await orderModel.create({
        organizationId: req.user.organizationId._id,
        projectId: req.program.projectId,
        programId: req.program._id,
        organizationprogramId: req.organizationprogramId._id,
        paymentId: paymentIntent.id,
        amount: data.amount * 1000,
        paymentMethod: "Paid via Credit Card",
        currency,
      });
      return res.json(paymentIntent);
    } catch (e) {
      console.log(e, "stripePaymentIntent");
      res.json({ success: false, message: "something went wrong" });
    }
  }

  async checkout(req, res) {
    try {
      let data = req.body;
      if (req.query.stripe) {
        if (!_.isEmpty(data.total)) return res.send("bad request");
        if (process.env.APP_ENV !== "prod") data.total = 1;
        const stripe = require("stripe")(secrets["STRIPE_SECRET_KEY"]);
        let stripeUser;
        if (req.user.organizationId.stripeCustomerId) {
          stripeUser = await stripe.customers.retrieve(
            req.user.organizationId.stripeCustomerId
          );
        } else {
          stripeUser = await stripe.customers.create({
            email: req.user.email,
            name: req.user.organizationId.Account_Name,
          });
          await orgModel.updateOne(
            { _id: ObjectId(req.user.organizationId._id) },
            { $set: { stripeCustomerId: stripeUser.id } }
          );
        }
        const paymentIntent = await stripe.paymentIntents.create({
          amount: parseInt(data.total) * 100,
          currency: req.program?.Currency?.toLowerCase() || "usd",
          customer: stripeUser.id || req.user.organizationId.Account_Name,
        });
        res.json(paymentIntent);
        await asyncForEach(data.items, async (item) => {
          if (item.keys["EV_Sorting_Filter"])
            item.title += ` ${item.keys["EV_Sorting_Filter"]}`;
          await orderModel.create({
            organizationId: req.user.organizationId._id,
            projectId: req.program.projectId._id,
            programId: req.program._id,
            organizationprogramId: req.organizationProgramData._id,
            paymentId: paymentIntent.id,
            keys: item.keys,
            itemTitle: item.title,
            amount: item.amount * 100,
            paymentMethod: "Paid via Credit Card",
          });
          return item;
        });
        return;
      } else {
        await asyncForEach(data.items, async (item) => {
          if (item.keys["EV_Sorting_Filter"])
            item.title += ` ${item.keys["EV_Sorting_Filter"]}`;
          await orderModel.create({
            organizationId: req.user.organizationId._id,
            projectId: req.program.projectId,
            programId: req.program._id,
            organizationprogramId: req.organizationProgramData._id,
            itemTitle: item.title,
            amount: item.amount,
            keys: item.keys,
            paymentMethod: "Needs Invoiced",
          });
          if (item.keys) {
            for (const key in item.keys) {
              if (item.keys[key] === "Invoice") {
                item.keys[key] = "Needs Invoiced";
              } else if (item.keys[key] === "Stripe") {
                item.keys[key] = "Paid via Credit Card";
              }
            }
          }
          if (item.keys) {
            await zohoService.updateCrm({
              module: "Deals",
              id: req.organizationProgramData.DealId,
              payload: item.keys,
            });
          }
          return item;
        });
        // let obj = {
        //   to: req.user.email,
        // };
        // obj.templateId = "d-8542575215fe4d1b90ad95cf637a463c";
        // obj.dynamicTemplateData = {
        //   orders: data.items,
        // };
        // await emailService.sendEmail(obj);
        // if (req.salesUser) {
        //   await emailService.sendEmail({
        //     to: req.salesUser.email,
        //     templateId: "d-d57d67c223af4872a6fb23ef1181fac2",
        //     dynamicTemplateData: {
        //       orders: data.items,
        //       orgName: req.user.organizationId.Account_Name,
        //       program: req.program.Name,
        //     },
        //   });
        // }
        return res.json("ok");
      }
    } catch (e) {
      console.log(e, "error in checkout");
      return res.send(e);
    }
  }
}

module.exports = new Ecom();
