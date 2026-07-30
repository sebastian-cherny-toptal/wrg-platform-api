const cmService = require("../helper/checkMarket.service");
const { asyncForEach } = require("../helper/helper.functions");
const orgModule = require("../models/org.model");
const clientModule = require("../models/client.model");
const surveyQuestions = require("../models/surveyQuestions.model");
const ZohoService = require("../helper/zoho.service");
class AdminController {
  async hit(req, res) {
    try {
      let arr = [];
      let data = await ZohoService.getAllClients();
      data = data.map((item) => {
        item.OrganizationId = item?.Account_Name?.id;
        return item;
      });
      await clientModule.insertMany(data);

      return res.json({ data: data });
    } catch (e) {
      console.log(e);
      res.status(500).send(e);
    }
  }
}

module.exports = new AdminController();
