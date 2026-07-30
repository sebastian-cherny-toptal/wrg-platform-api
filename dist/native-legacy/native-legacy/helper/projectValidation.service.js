const Project = require("../models/project.model");
const Program = require("../models/program.model");
const OrganizationProgram = require("../models/orgProgram.model");
const Users = require("../models/user.model");
const Order = require("../models/order.model");
const CustomReport = require("../models/customReport.model");
const KeyImpactAnalysis = require("../models/KeyImpactAnalysis.model");
// Lazy load zohoService to avoid circular dependency
let zohoService;
function getZohoService() {
  if (!zohoService) {
    zohoService = require("./zoho.service");
  }
  return zohoService;
}
const _ = require("lodash");

class ProjectValidationService {
    async mergeDuplicateProjects(primaryProject, projectIdentifier) {
        const identifierName = projectIdentifier?.Name || projectIdentifier?.name || primaryProject?.Name || primaryProject?.name;
        
        if (!identifierName) {
            return primaryProject;
        }

        const duplicates = await Project.find({
            _id: { $ne: primaryProject._id },
            Name: identifierName
        }).lean();
        if (!duplicates?.length) {
            return primaryProject;
        }
        for (const duplicate of duplicates) {
            const duplicateId = duplicate._id;
            const primaryId = primaryProject._id;
            await Program.updateMany(
                { projectId: duplicateId },
                { $set: { projectId: primaryId, "Project.id": primaryProject.id } }
            );
            await OrganizationProgram.updateMany(
                { projectId: duplicateId },
                { $set: { projectId: primaryId } }
            );
            await Users.updateMany(
                { projectId: duplicateId },
                { $set: { projectId: primaryId } }
            );
            await Users.updateMany(
                { projects: duplicateId },
                { $addToSet: { projects: primaryId } }
            );
            await Users.updateMany(
                { projects: duplicateId },
                { $pull: { projects: duplicateId } }
            );
            await Order.updateMany(
                { projectId: duplicateId },
                { $set: { projectId: primaryId } }
            );
            await CustomReport.updateMany(
                { projectId: duplicateId },
                { $set: { projectId: primaryId } }
            );
            await KeyImpactAnalysis.updateMany(
                { projectId: duplicateId },
                { $set: { projectId: primaryId } }
            );
            const dupPrograms = Array.isArray(duplicate?.Programs) ? duplicate.Programs : [];
            if (dupPrograms.length) {
                await Project.findByIdAndUpdate(primaryId, { $addToSet: { Programs: { $each: dupPrograms } } });
            }
            await Project.deleteOne({ _id: duplicateId });
        }
        const refreshed = await Project.findById(primaryProject._id);
        return refreshed || primaryProject;
    }
    async validateAndGetProject(programData) {
        try {
            if (!programData?.Project?.id) {
                throw new Error("Program does not have associated project information");
            }

            // First try to find by Zoho project ID
            let existingProject = await Project.findOne({ id: programData.Project.id });
            let projectDetailsFromZoho = null;
            
            // Fetch project details from Zoho if not found or needs validation
            if (!existingProject || !existingProject.Project_Abbreviation) {
                // Fetch complete project details from Zoho
                const projectData = await getZohoService().getRecordById({
                    module: "Main_Projects",
                    id: programData.Project.id
                });

                const projectDetails = projectData && Array.isArray(projectData) ? _.first(projectData) : projectData;
                projectDetailsFromZoho = projectDetails;

                if (!existingProject && projectDetails) {
                    const projectToSave = {
                        ...projectDetails,
                        id: programData.Project.id,
                        Name: projectDetails.Name || projectDetails.name || projectDetails.Project_Name || programData.Project.Name || programData.Project.name,
                    };

                    if (projectDetails.Project_Abbreviation) {
                        projectToSave.Project_Abbreviation = projectDetails.Project_Abbreviation;
                    }

                    existingProject = new Project(projectToSave);
                    await existingProject.save();
                } else if (existingProject && projectDetails?.Project_Abbreviation && !existingProject.Project_Abbreviation) {
                    existingProject = await Project.findOneAndUpdate(
                        { _id: existingProject._id },
                        { $set: { Project_Abbreviation: projectDetails.Project_Abbreviation } },
                        { new: true }
                    );
                }
            }

            if (existingProject) {
                // Get the current program document to check its MongoDB ID
                const currentProgram = await Program.findOne({ id: programData.id });
                
                // Check if we found a different project than what's in the program
                const projectIdMismatch = existingProject.id !== programData.Project.id;
                // Check if program needs to be added to project's Programs array
                const programNeedsToBeAdded = currentProgram && (!existingProject.Programs || !existingProject.Programs.some(progId => 
                    progId.toString() === currentProgram._id.toString()
                ));
                const isProgramDocumentMissing = !currentProgram;
                const isProgramProjectIdNull = currentProgram && (currentProgram.projectId === null || currentProgram.projectId === undefined);

                if (projectIdMismatch || programNeedsToBeAdded || isProgramDocumentMissing || isProgramProjectIdNull) {
                    // Update the program to point to the correct existing project
                    const updatedProgram = await Program.findOneAndUpdate(
                        { id: programData.id },
                        { 
                            $set: { 
                                projectId: existingProject._id,
                                'Project.id': existingProject.id,
                                lastUpdated: new Date()
                            }
                        },
                        { new: true, upsert: true }
                    );

                    // Update project's Programs array
                    await Project.findOneAndUpdate(
                        { _id: existingProject._id },
                        { 
                            $addToSet: { 
                                Programs: updatedProgram._id 
                            }
                        },
                        { new: true }
                    );

                    if (projectIdMismatch) {
                        console.log(`Updated program ${programData.id} to point to correct project ${existingProject._id}`);
                    }
                    if (programNeedsToBeAdded) {
                        console.log(`Added missing program ${updatedProgram._id} to project's Programs array`);
                    }
                }
            }

            const identifierSource = projectDetailsFromZoho || existingProject;
            try {
                existingProject = await this.mergeDuplicateProjects(existingProject, identifierSource);
            } catch (mergeError) {
                console.error("Error merging duplicate projects:", mergeError);
            }

            return existingProject;
        } catch (error) {
            console.error('Error in validateAndGetProject:', error);
            throw error;
        }
    }

    async validateProgramProject(program) {
        try {
            if (!program?.Project?.id) {
                throw new Error("Invalid program data - missing Project information");
            }

            const project = await this.validateAndGetProject(program);
            
            // Update program with validated project
            const updatedProgram = await Program.findOneAndUpdate(
                { id: program.id },
                { 
                    $set: { 
                        projectId: project._id,
                    }
                },
                { new: true, upsert: true }
            );

            // Update project's Programs array
            await Project.findOneAndUpdate(
                { _id: project._id },
                { 
                    $addToSet: { 
                        Programs: updatedProgram._id 
                    }
                },
                { new: true }
            );

            console.log(`Updated project ${project._id} with program ${updatedProgram._id}`);

            return {
                project,
                program: updatedProgram
            };
        } catch (error) {
            console.error('Error in validateProgramProject:', error);
            throw error;
        }
    }
}

module.exports = new ProjectValidationService();
