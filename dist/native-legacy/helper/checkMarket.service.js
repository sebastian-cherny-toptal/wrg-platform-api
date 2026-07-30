const axios = require("axios");
const helper = require("../helper/helper.functions");

class CheckMarketService {
  constructor() {
    this.url = "https://api-us.checkmarket.com";
  }

  apiCall(method, path, params, data) {
    return new Promise(async (resolve, reject) => {
      try {
        return resolve(
          await axios({
            method: method,
            url: this.url + path,
            params: params,
            data: data,
            headers: {
              "X-Master-Key": secrets["X-Master-Key"],
              "X-Key": secrets["X-Key"],
            },
          })
        );
      } catch (e) {
        helper.logAxiosError(e);
        return reject("Error: " + e);
      }
    });
  }

  async getContacts(payload = { top: 1000 }) {
    const { top } = payload;
    return new Promise((resolve, reject) => {
      this.apiCall("GET", "/3/contacts/", { top })
        .then((response) => {
          console.log(response.data.Data.length);
          return resolve(response.data);
        })
        .catch((err) => {
          helper.logAxiosError(err);
          return reject();
        });
    });
  }

  async getContentById(payload) {
    console.log(payload);
    return new Promise((resolve, reject) => {
      if (!payload.id) return reject("Error: id is required");
      this.apiCall("GET", "/3/contacts/" + payload.id)
        .then((response) => {
          return resolve(response.data);
        })
        .catch((err) => {
          helper.logAxiosError(err);
          return reject();
        });
    });
  }

  async fetchAllSxurvey(payload = { top: 1000 }) {
    const { top, id } = payload;
    return new Promise((resolve, reject) => {
      this.apiCall("GET", "/3/surveys/", { top })
        .then((response) => {
          return resolve(response.data);
        })
        .catch((err) => {
          helper.logAxiosError(err);
          return reject();
        });
    });
  }

  /*
   * GET - 3/surveys/{surveyId}?lang={lang}&includeQuestions={includeQuestions}
   *  By default we include the questions and responses for the survey, but if you would like to minimize the response, you can exclude them with this parameters.
   * */

  async fetchSurveyById(payload) {
    const { id, includeQuestions = true } = payload;
    return new Promise((resolve, reject) => {
      if (!id) return reject("Error: id is required");
      this.apiCall("GET", "/3/surveys/" + id, { includeQuestions })
        .then((response) => {
          return resolve(response.data);
        })
        .catch((err) => {
          helper.logAxiosError(err);
          return reject();
        });
    });
  }

  async fetchContactsBySurveyId(payload = { top: 1000 }) {
    const { id, top } = payload;
    return new Promise((resolve, reject) => {
      if (!id) return reject("Error: id is required");
      this.apiCall("GET", "/3/surveys/" + id + "/contacts", { top })
        .then((response) => {
          return resolve(response.data);
        })
        .catch((err) => {
          helper.logAxiosError(err);
          return reject();
        });
    });
  }

  async fetchQuestionKJsBySurveyId(payload = { top: 1000 }) {
    const { id, top } = payload;
    return new Promise((resolve, reject) => {
      if (!id) return reject("Error: id is required");
      this.apiCall("GET", "/3/surveys/" + id + "/questions", { top })
        .then((response) => {
          return resolve(response.data);
        })
        .catch((err) => {
          helper.logAxiosError(err);
          return reject();
        });
    });
  }

  async fetchResponsesBySurveyId(payload = { top: 1000 }) {
    const { id, top } = payload;
    return new Promise((resolve, reject) => {
      if (!id) return reject("Error: id is required");
      this.apiCall(
        "GET",
        "/3/surveys/" + id + "/respondents?expand=Responses",
        { top }
      )
        .then((response) => {
          return resolve(response.data);
        })
        .catch((err) => {
          helper.logAxiosError(err);
          return reject();
        });
    });
  }
}

module.exports = new CheckMarketService();
