const axios = require("axios");
const FormData = require("form-data");
const Organization = require("../models/org.model");
const Project = require("../models/project.model");
const Program = require("../models/program.model");
const _ = require("lodash");
const { setValue, getValue } = require("../helper/redis.service");
const helper = require("../helper/helper.functions");
const Bottleneck = require("bottleneck");
const projectValidationService = require("../helper/projectValidation.service");
const baseURL =
  process.env.APP_ENV === "dev"
    ? "https://crmsandbox.zoho.com"
    : "https://www.zohoapis.com";
class ZohoService {
  constructor() {
    this.getAuthToken = this.getAuthToken.bind(this);
    this.getZohoModules = this.getZohoModules.bind(this);
    this.fetchDataWithRecursiveCall =
      this.fetchDataWithRecursiveCall.bind(this);
    this.org_module = "Accounts";
    this.project_module = "Main_Projects";
    this.program_module = "Programs";
    this.client_module = "Contacts";
    this.deal_module = "Deals";
    this.product_module = "Products";
    this.fetchDataWithCOQL = this.fetchDataWithCOQL.bind(this);
    this.updateCrmWithRateLimit = this.updateCrmWithRateLimit.bind(this);
    this.updateCrm = this.updateCrm.bind(this);
    // More aggressive limiter for normal operations
    this.limiter = new Bottleneck({
      maxConcurrent: 8,
      minTime: 150, // ~7 requests per second
      reservoir: 200,
      reservoirRefreshAmount: 200,
      reservoirRefreshInterval: 60 * 1000,
    });
    
    // Conservative limiter for when we hit rate limits
    this.conservativeLimiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 2000,
      reservoir: 30,
      reservoirRefreshAmount: 30,
      reservoirRefreshInterval: 60 * 1000,
    });
    
    this.currentLimiter = this.limiter;
    this.lastRateLimit = 0;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isRateLimitError(error) {
    const status = error?.response?.status;
    const data = error?.response?.data || {};
    const message = (data?.error_description || data?.message || "").toString().toLowerCase();
    return (
      status === 429 ||
      status === 420 ||
      (status === 400 && message.includes("too many requests")) ||
      message.includes("too many requests")
    );
  }

  switchToConservativeMode() {
    this.lastRateLimit = Date.now();
    this.currentLimiter = this.conservativeLimiter;
    // Switch back after 2 minutes
    setTimeout(() => {
      if (Date.now() - this.lastRateLimit >= 120000) {
        this.currentLimiter = this.limiter;
      }
    }, 120000);
  }

  async zohoRequest(config, { maxRetries = 3, baseDelayMs = 1000 } = {}) {
    let attempt = 0;
    
    while (attempt <= maxRetries) {
      try {
        const response = await this.currentLimiter.schedule(async () => {
          return await axios({ ...config, timeout: 60000 }); // 60s timeout to reduce false timeouts under load
        });
        return response;
      } catch (error) {
        attempt += 1;
        const status = error?.response?.status;
        const isRateLimit = this.isRateLimitError(error);
        
        if (isRateLimit) {
          this.switchToConservativeMode();
          if (attempt <= maxRetries) {
            const retryAfter = error?.response?.headers?.["retry-after"];
            const delay = retryAfter ? parseInt(retryAfter) * 1000 : baseDelayMs * attempt;
            await this.sleep(delay);
            continue;
          }
        }
        
        const isTimeout =
          error?.code === "ECONNABORTED" ||
          error?.code === "ECONNRESET" || // <-- FIX: Retry socket hang ups
          `${error?.message || ""}`.toLowerCase().includes("timeout") ||
          `${error?.message || ""}`.toLowerCase().includes("socket hang up"); // <-- FIX
        const transient = isTimeout || [408, 500, 502, 503, 504].includes(status);
        if (transient && attempt <= maxRetries) {
          await this.sleep(baseDelayMs * attempt);
          continue;
        }
        
        throw error;
      }
    }
  }

  getAuthToken() {
    return new Promise(async (resolve, reject) => {
      try {
        let token = await getValue(`zoho_access_token_${process.env.APP_ENV}`);
        if (token) {
          return resolve({ access_token: token });
        }

        let data = new FormData();
        data.append("client_id", secrets.ZOHO_CLIENT_ID);
        data.append("client_secret", secrets.ZOHO_CLIENT_SECRET);
        data.append("refresh_token", secrets.ZOHO_REFRESH_TOKEN);
        data.append("grant_type", secrets.ZOHO_GRANT_TYPE);
        // data.append("client_id", '1000.JQEA9B9CWLG0V9288QSQ71NN4WBGQM');
        // data.append("client_secret", '720e1c5d2d5d3aa36dc250bd89ca990b7d9e8296d5');
        // data.append("refresh_token", '1000.e901990434e331ef163faa88a6cac5ab.a08235fe2a9a0d1d63bc429e23354dac');

        // Define the URL based on the environment
        let authTokenURL = "https://accounts.zoho.com/oauth/v2/token";

        let config = {
          method: "post",
          url: authTokenURL,
          headers: {
            ...data.getHeaders(),
          },
          data: data,
        };

        const response = await this.zohoRequest(config);
        await setValue(
          `zoho_access_token_${process.env.APP_ENV}`,
          response.data.access_token,
          response.data.expires_in
        );
        return resolve(response.data);
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  async fetchDataWithRecursiveCall(module, access_token, ids = []) {
    let page = 1;
    let promises = [];
    let results = [];
    let responseCount;

    if (ids.length) {
      for (let item of ids) {
        let url = `${baseURL}/crm/v5/${module}/${item}`;
        let config = {
          method: "get",
          url: url,
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        };

        promises.push(this.zohoRequest(config));
        page++;
      }
      let responses = await Promise.all(promises);
      results = responses.flatMap((item) => item.data.data);
    } else {
      let config = {
        method: "get",
        url: `${baseURL}/crm/v5/${module}/actions/count`,
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      };

      responseCount = await this.zohoRequest(config);
      responseCount = responseCount.data.count;

      while (page <= Math.ceil(responseCount / 200)) {
        let url = `${baseURL}/crm/v5/${module}?page=${page}&per_page=200`;
        let config = {
          method: "get",
          url: url,
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        };

        promises.push(this.zohoRequest(config));
        page++;
      }
      let responses = await Promise.all(promises);
      results = responses.flatMap((item) => item.data.data);
    }

    return results;
  }

  async fetchDataWithRecursiveCallV2(module, access_token, ids = []) {
    try {
      let results = [];

      if (ids?.length) {
        // Use bulk fetch for multiple IDs
        const batchSize = 50; // Zoho allows bulk fetch of up to 50 records
        
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize);
          const idsParam = batch.join(',');
          
          const config = {
            method: "get",
            url: `${baseURL}/crm/v2/${module}?ids=${idsParam}`,
            headers: {
              Authorization: `Bearer ${access_token}`,
            },
          };
          
          try {
            const response = await this.zohoRequest(config);
            if (response?.data?.data) {
              results = results.concat(response.data.data);
            }
          } catch (error) {
            // Fallback to individual requests if bulk fails
            console.log("Bulk fetch failed, falling back to individual requests");
            for (const id of batch) {
              try {
                const url = `${baseURL}/crm/v2/${module}/${id?.toString()}`;
                const config = {
                  method: "get",
                  url: url,
                  headers: {
                    Authorization: `Bearer ${access_token}`,
                  },
                };
                const response = await this.zohoRequest(config);
                if (response?.data?.data) {
                  results = results.concat(response.data.data);
                }
              } catch (individualError) {
                console.log(`Failed to fetch ${module} ${id}:`, individualError.message);
              }
            }
          }
        }
      } else {
        // Fetch all records with optimized pagination
        let page = 1;
        let hasMore = true;
        const perPage = 200;

        while (hasMore) {
          const config = {
            method: "get",
            url: `${baseURL}/crm/v2/${module}?page=${page}&per_page=${perPage}`,
            headers: {
              Authorization: `Bearer ${access_token}`,
            },
          };

          const response = await this.zohoRequest(config);
          const data = response?.data?.data || [];
          
          if (data.length > 0) {
            results = results.concat(data);
            page++;
            hasMore = data.length === perPage; // Continue if we got a full page
          } else {
            hasMore = false;
          }
        }
      }
      
      return _.compact(results);
    } catch (e) {
      helper.logAxiosError(e);
      throw e;
    }
  }

  async fetchDataWithCOQLV2(query) {
    return new Promise(async (resolve, reject) => {
      try {
        let page = 1;
        let results = [];
        let responseCount;
        let per_page = 200; // As per the Zoho CRM limit
        let { access_token } = await this.getAuthToken();
        const postRequest = async (url, data) => {
          return new Promise(async (resolve, reject) => {
            try {
              let config = {
                method: "post",
                url: url,
                headers: {
                  Authorization: `Bearer ${access_token}`,
                  "Content-Type": "application/json",
                },
                data: data,
              };
              const response = await this.zohoRequest(config);
              return resolve(response.data.data);
            } catch (e) { helper.logAxiosError(e); return reject(e); }
          });
        };

        // First, get the total count of records that match the COQL query
        const countQuery = query.replace(
          /select .*? from/i,
          "SELECT COUNT(id) FROM"
        );
        const countResponse = await postRequest(`${baseURL}/crm/v5/coql`, {
          select_query: countQuery,
        });
        responseCount = countResponse[0]["COUNT(id)"];

        let totalPages = Math.ceil(responseCount / per_page);

        let requests = [];
        for (; page <= totalPages; page++) {
          // Adapt the COQL query to fetch specific page
          const pagedQuery = `${query} LIMIT ${per_page} OFFSET ${
            (page - 1) * per_page
          }`;
          requests.push(
            postRequest(`${baseURL}/crm/v4/coql`, { select_query: pagedQuery })
          );
        }

        let allResults = await Promise.all(requests);
        results = [].concat(...allResults);

        return resolve(results);
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  fetchDataWithCOQL(module, access_token, ids = null) {
    return new Promise(async (resolve, reject) => {
      try {
        let selectQuery;

        if (ids !== null && ids.length > 0) {
          // Create a condition for each id, joined by 'or'
          let idConditions = ids.map((id) => `(Id = '${id}')`).join(" or ");
          selectQuery = `select id from ${module} where ${idConditions} limit 200`;
        } else {
          selectQuery = `select id from ${module} limit 200`;
        }

        let config = {
          method: "post",
          url: `${baseURL}/crm/v5/coql`,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${access_token}`,
          },
          data: {
            select_query: selectQuery,
          },
        };
        let response = await this.zohoRequest(config);
        if (response.data) {
          return resolve(response.data.data);
        } else {
          return reject(new Error("No data found"));
        }
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  getZohoModules() {
    return new Promise(async (resolve, reject) => {
      try {
        let { access_token } = await this.getAuthToken();
        let config = {
          method: "get",
          url: `${baseURL}/crm/v5/settings/modules`,
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        };
        const response = await this.zohoRequest(config);
        return resolve(response.data);
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  getAllProjects() {
    return new Promise(async (resolve, reject) => {
      try {
        //ZOHO Description:
        //  module_name = 'CustomModule1'
        //  api_name = 'Main_Projects'
        // plural_label = 'Main Projects'
        let { access_token } = await this.getAuthToken();
        return resolve(
          await this.fetchDataWithRecursiveCall(
            this.project_module,
            access_token
          )
        );
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  getAllProgram() {
    return new Promise(async (resolve, reject) => {
      try {
        //ZOHO Description:
        //  module_name = 'CustomModule2'
        //  api_name = 'Programs'
        // plural_label = 'Programs'
        let { access_token } = await this.getAuthToken();
        return resolve(
          await this.fetchDataWithRecursiveCall(
            this.program_module,
            access_token
          )
        );
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  getAllOrganizations() {
    return new Promise(async (resolve, reject) => {
      try {
        //ZOHO Description:
        //  module_name = 'Accounts'
        //  api_name = 'Accounts'
        // plural_label = 'Companies'
        let { access_token } = await this.getAuthToken();
        return resolve(
          await this.fetchDataWithRecursiveCall(this.org_module, access_token)
        );
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  getAllClients() {
    return new Promise(async (resolve, reject) => {
      try {
        //ZOHO Description:
        //  module_name = 'Accounts'
        //  api_name = 'Accounts'
        // plural_label = 'Companies'
        let { access_token } = await this.getAuthToken();
        return resolve(
          await this.fetchDataWithRecursiveCall(
            this.client_module,
            access_token
          )
        );
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  getAllDeals(ids = null) {
    return new Promise(async (resolve, reject) => {
      try {
        let { access_token } = await this.getAuthToken();
        return resolve(
          await this.fetchDataWithRecursiveCallV2(
            this.deal_module,
            access_token,
            ids
          )
        );
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }
  getAllRecords({ module, ids }) {
    return new Promise(async (resolve, reject) => {
      try {
        let { access_token } = await this.getAuthToken();
        return resolve(
          await this.fetchDataWithRecursiveCallV2(module, access_token, ids)
        );
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }
  getAllProducts() {
    return new Promise(async (resolve, reject) => {
      try {
        //ZOHO Description:
        //  module_name = 'Products'
        //  api_name = 'Products'
        // plural_label = 'Products'
        let { access_token } = await this.getAuthToken();
        return resolve(
          await this.fetchDataWithRecursiveCall(
            this.product_module,
            access_token
          )
        );
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  getRecordById(data) {
    return new Promise(async (resolve, reject) => {
      try {
        let { access_token } = await this.getAuthToken();
        let config = {
          method: "get",
          url: `${baseURL}/crm/v5/${data.module}/${data.id}`,
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        };
        let response = await this.zohoRequest(config);
        return resolve(response.data.data);
      } catch (e) { helper.logAxiosError(e); return reject(e); }
    });
  }

  getRecordBySearch(data) {
    return new Promise(async (resolve, reject) => {
      try {
        let { access_token } = await this.getAuthToken();
        const { module, criteria } = data;
        let config = {
          method: "get",
          url: `${baseURL}/crm/v5/${module}/search?criteria=${criteria}`,
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        };
        let response = await this.zohoRequest(config);
        return resolve(response.data.data);
      } catch (e) {
        helper.logAxiosError(e);
        return reject();
      }
    });
  }
  addProgram(program) {
    return new Promise(async (resolve, reject) => {
      try {
        let existProgram = await Program.findOne({ id: program.id });
        if (!existProgram) {
          existProgram = new Program(program);
        } else {
          existProgram.set(_.omit(program, ["_id", "__v"]));
        }
        const existProject = await projectValidationService.validateAndGetProject(program);
        if (existProject?._id) {
          existProgram.projectId = existProject._id;
          if (!Array.isArray(existProject.Programs)) {
            existProject.Programs = [];
          }
          if (!existProject.Programs.includes(existProgram._id)) {
            existProject.Programs.push(existProgram._id);
          }
          await existProject.save();
        }
        await existProgram.save();
        return resolve(existProgram);
      } catch (error) {
        console.log(error);
        return reject(error);
      }
    });
  }

  addOrganization(organization) {
    return new Promise(async (resolve, reject) => {
      try {
        let existOrganization = await Organization.findOne({
          id: organization.id,
        });
        if (!existOrganization) {
          existOrganization = new Organization(organization);
        }
        existOrganization.save();
        return resolve(existOrganization);
      } catch (error) {
        console.log(error);
        return reject(error);
      }
    });
  }
  async updateCrm(params) {
    let { module, id, payload } = params;
    
    try {
      let { access_token } = await this.getAuthToken();
      
      // Try modern v6 API first for better performance
      const v6Config = {
        method: "patch",
        url: `${baseURL}/crm/v6/${module}/${id}`,
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        data: payload,
      };
      
      try {
        const response = await this.zohoRequest(v6Config);
        return response;
      } catch (v6Error) {
        // Fallback to v2 for compatibility
        const v2Config = {
          method: "put",
          url: `${baseURL}/crm/v2/${module}/${id}`,
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          data: {
            data: [{ ...payload }],
            trigger: [],
          },
        };
        
        const response = await this.zohoRequest(v2Config);
        const body = response?.data;
        const result = body?.data && Array.isArray(body.data) ? body.data[0] : null;
        
        if (!result || result.status?.toLowerCase() !== "success") {
          const code = result?.code || body?.code || "unknown_error";
          const msg = result?.message || body?.message || "Update failed";
          throw new Error(`Zoho update failed: ${code} - ${msg}`);
        }
        
        return response;
      }
    } catch (error) {
      console.log("Zoho update error", module, id, JSON.stringify(payload));
      throw error;
    }
  }

  async bulkUpdateCrm(module, updates) {
    if (!updates || updates.length === 0) return [];
    
    // For large batches, use the modern bulk write API
    if (updates.length > 100) {
      return this.bulkWriteUpdates(module, updates);
    }
    
    // For smaller batches, use traditional bulk update
    const batchSize = 100;
    const results = [];
    
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      try {
        const { access_token } = await this.getAuthToken();
        
        const config = {
          method: "put",
          url: `${baseURL}/crm/v2/${module}`,
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          data: {
            data: batch,
            trigger: [],
          },
        };
        
        const response = await this.zohoRequest(config);
        results.push(...(response?.data?.data || []));
        
        // Log success for each batch
        console.log(`Bulk update batch ${i / batchSize + 1} completed: ${batch.length} records`);
        
      } catch (error) {
        console.log(`Bulk update error for batch ${i / batchSize + 1}:`, error.message);
        
        // Try individual updates as fallback for this batch
        for (const record of batch) {
          try {
            await this.updateCrm({
              module,
              id: record.id,
              payload: { ...record, id: undefined }
            });
          } catch (individualError) {
            console.log(`Individual update failed for record ${record.id}:`, individualError.message);
          }
        }
      }
    }
    
    return results;
  }

  async bulkWriteUpdates(module, updates) {
    try {
      const { access_token } = await this.getAuthToken();
      
      // Create CSV content for bulk write
      const csvContent = this.createCSVForBulkWrite(updates);
      
      // Create form data for file upload
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', Buffer.from(csvContent), {
        filename: 'bulk_update.csv',
        contentType: 'text/csv'
      });
      
      // Upload file first
      const uploadConfig = {
        method: 'post',
        url: `${baseURL}/crm/v2/files`,
        headers: {
          Authorization: `Bearer ${access_token}`,
          ...form.getHeaders()
        },
        data: form
      };
      
      const uploadResponse = await this.zohoRequest(uploadConfig);
      const fileId = uploadResponse?.data?.details?.file_id;
      
      if (!fileId) {
        throw new Error('Failed to upload bulk update file');
      }
      
      // Initiate bulk write job
      const bulkWriteConfig = {
        method: 'post',
        url: `${baseURL}/crm/v6/write`,
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        data: {
          operations: [{
            operation: 'update',
            module: {
              api_name: module
            },
            file_id: fileId,
            field_mappings: this.getFieldMappings(updates[0])
          }]
        }
      };
      
      const bulkWriteResponse = await this.zohoRequest(bulkWriteConfig);
      const jobId = bulkWriteResponse?.data?.details?.job_id;
      
      console.log(`Bulk write job initiated for ${updates.length} records. Job ID: ${jobId}`);
      
      // Monitor job status (non-blocking)
      this.monitorBulkWriteJob(jobId, access_token);
      
      return { job_id: jobId, status: 'initiated' };
      
    } catch (error) {
      console.log('Bulk write failed, falling back to traditional bulk update:', error.message);
      return this.bulkUpdateCrm(module, updates);
    }
  }

  createCSVForBulkWrite(updates) {
    if (updates.length === 0) return '';
    
    // Get all unique keys from updates
    const allKeys = new Set(['id']); // Always include id
    updates.forEach(update => {
      Object.keys(update).forEach(key => allKeys.add(key));
    });
    
    const headers = Array.from(allKeys);
    const csvRows = [headers.join(',')];
    
    updates.forEach(update => {
      const row = headers.map(header => {
        const value = update[header] || '';
        // Escape commas and quotes in CSV
        return typeof value === 'string' && (value.includes(',') || value.includes('"')) 
          ? `"${value.replace(/"/g, '""')}"` 
          : value;
      });
      csvRows.push(row.join(','));
    });
    
    return csvRows.join('\n');
  }

  getFieldMappings(sampleRecord) {
    return Object.keys(sampleRecord).map(key => ({
      api_name: key,
      index: Object.keys(sampleRecord).indexOf(key)
    }));
  }

  async monitorBulkWriteJob(jobId, accessToken) {
    if (!jobId) return;
    
    const checkStatus = async () => {
      try {
        const config = {
          method: 'get',
          url: `${baseURL}/crm/v6/write/${jobId}`,
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        };
        
        const response = await this.zohoRequest(config);
        const status = response?.data?.state;
        
        console.log(`Bulk write job ${jobId} status: ${status}`);
        
        if (status === 'COMPLETED') {
          console.log('Bulk write job completed successfully');
        } else if (status === 'FAILED') {
          console.log('Bulk write job failed');
        } else if (status === 'IN_PROGRESS') {
          // Check again in 10 seconds
          setTimeout(checkStatus, 10000);
        }
      } catch (error) {
        console.log('Error checking bulk write job status:', error.message);
      }
    };
    
    // Start monitoring after 5 seconds
    setTimeout(checkStatus, 5000);
  }

  async updateCrmWithRateLimit(options) {
    return this.currentLimiter.schedule(() => this.updateCrm(options));
  }
}

module.exports = new ZohoService();
