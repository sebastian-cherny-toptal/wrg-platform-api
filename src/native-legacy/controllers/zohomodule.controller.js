const zohoService = require('../helper/zoho.service');
const Client = require('../models/client.model');
const Organization = require('../models/org.model');
const Project = require('../models/project.model');
const Program = require('../models/program.model');

class ZohoModuleController {
    syncProjects = async (req, res, next) => {
        try {
            const projects = await zohoService.getAllProjects();
            await Project.deleteMany();
            projects.map(async project => {
                let existProject = await Project.findOne({ id: project.id });
                if (!existProject) {
                    existProject = new Project(project);
                }
                existProject.save();
            });
            return res.json(projects);
        } catch (e) {
            console.log(e);
            return res.status(500).json(e.message);
        }
    }
    syncPrograms = async (req, res, next) => {
        try {
            const programs = await zohoService.getAllProgram();
            await Program.deleteMany();
            programs.map(async program => {
                await zohoService.addProgram(program);
            });
            return res.json(programs);
        } catch (e) {
            console.log(e);
            return res.status(500).json(e.message);
        }
    }
    syncOrganizations = async (req, res, next) => {
        try {
            const organizations = await zohoService.getAllOrganizations();
            await Organization.deleteMany();
            organizations.map(async organization => {
                await zohoService.addOrganization(organization);
            });
            return res.json(organizations);
        } catch (e) {
            console.log(e);
            return res.status(500).json(e.message);
        }
    }
    syncClients = async (req, res, next) => {
        try {
            const clients = await zohoService.getAllClients();
            await Client.deleteMany();
            clients.map(async client => {
                let existClient = await Client.findOne({ id: client.id });
                if (!existClient) {
                    existClient = new Client(client);
                }
                existClient.save();
            });
            return res.json(clients);
        } catch (e) {
            console.log(e);
            return res.status(500).json(e.message);
        }
    }
}

module.exports = new ZohoModuleController();