const User = require("../models/user.model")
const ObjectId = require("mongoose").Types.ObjectId;
const roleModel  = require("../models/role.model");
const helper = require('../helper/helper.functions');
const emailService = require('../helper/email.service');

class UserController {

    async createUser(req, res) {
        try{
            if(!req.body.email) return res.status(400).send({success: false, message: "Email is required"})
            if(req.body?.roleId){
                const roleData = await roleModel.findOne({_id: ObjectId(req.body.roleId)});
                if(roleData.role === 'admin'){
                    let adminUser = await User.findOne({role: 'admin'});
                    if(adminUser) return res.status(403).send({success: false, message: "admin user already exist", data: {email:adminUser.email}});
                }
                if(!roleData) return res.status(404).send({success: false, message: "Role not found"});
                req.body.role = roleData.role;
            }
            if(req.body?.mfa){
                if(!["mobile","email"].includes(req.body?.mfa)) return res.status(400).send({success: false, message: "Invalid MFA preference accepted only mobile or email"})
            }
            if(!req.body?.password){
                req.body.password = helper.randomPassword(6);
            }
            let userExist = await User.count({email: req.body.email});
            if(userExist) return res.status(403).send({success: false, message: "User already exist"});
            if(req.body?.projects?.length>0) {
                req.body.projects = req.body.projects.map(project => ObjectId(project));
            }
            console.log(req.body.password,"password from user create for "+req.body.email)
            let newUser = new User(req.body);
            let user = await newUser.save();
            await emailService.sendEmail({
                to: req.body.email,
                subject: 'Welcome to the application',
                text: `Your password is ${req.body.password}`
            }); 
            return res.json({success: true, message:  `User created successfully`,data:user});
        }catch(e){
            console.log(e,"error in createUser")
            return res.status(500).json({success: false, message: "something went wrong", error: e})
        }
    }
    async updateUser(req, res){
        try {
            if(!req.params?.userId) return res.status(400).send({success: false, message: "Invalid user id"})
            if(req.body.email){
                const existingCheck = await User.count({email: req.body.email});
                if (existingCheck) {
                    return res.status(403).send({success: "false", message: "Already exist"});
                }
            }
            /* fetch permissions for that particular role from role collection*/
            if(req.body?.roleId){                
                const roleData = await roleModel.findOne({_id: ObjectId(req.body?.roleId)});
                if(roleData.role === 'admin') return res.status(403).send({success: false, message: `admin role already exist for another user`});
                if(!roleData) return res.status(404).send({success: false, message: "Role not found"});
                if(req.user.role == "admin") return res.status(403).send("admin can not change thier user role")
                req.body.role = roleData.role;
                req.body.roleId = roleData._id;
            }
            if(req.body?.mfa){
                if(!["mobile","email"].includes(req.body?.mfa)) return res.status(400).send({success: false, message: "Invalid MFA preference accepted only mobile or email"})
            }
            if(req.body?.projects?.length>0) {
                req.body.projects = req.body.projects.map(project => ObjectId(project));
                await User.updateOne({_id: ObjectId(req.params.userId)}, {$addToSet: {projects: req.body.projects}});
            }
            let updatedUser = await User.findByIdAndUpdate({_id: ObjectId(req.params?.userId)}, req.body, {new: true}).populate('projects');
            return res.json({success: true, message:  `User updated successfully`,data:updatedUser});
        } catch (e) {
            console.log(e)
            res.status(500).send({success: false, message: "something went wrong.",error:e})
        }
    }
    async getUsers(req, res) {
        try{
            const q = User.find({"role": {$nin: ["client"]}})
            if(req.query["expand"]){
                if(req.query["expand"] == "projects"){
                    q.populate("projects")
                }else{
                    return res.status(400).json({success: false, message: "if expand is provided, it should be projects"})
                }
            }
            if(req.query["select"]){
                console.log(req.query["select"])
                const select = req.query["select"].split(",")
                if(select.length){
                    select.forEach(element => {
                        q.select({[element]:1})
                    });
                }else{
                    q.select(req.query["select"])
                }
                
            }
            // let users = await User.find({"role": {$nin: ["admin","client"]}}).populate('roleId',{});
            return res.status(200).json({success: true, message: "success", data: await q.exec()});
        }catch(e){
            console.log(e, 'error in getUsers')
            return res.status(500).json({success: false, message: "something went wrong"})
        }
    }
    async listUsers(req, res) {
        // if(params.role == 'admin') return res.send({success: true, message: "Forbidden"})
        let data = await User.find({role:{$ne: 'client'}}).select('_id fullName lastName email mobile role roleId').populate('projectId');
        res.json({success:true,data,message:"success"}) 
    }

    async deleteUserById(req, res) {
        try{
            let userId = req.params.userId;
            let userData = await User.findOne({_id: ObjectId(userId)});
            if(!userData) return res.status(404).send({success: false, message: "User not found"});
            if(userData.role == 'admin') return res.status(403).send({success: false, message: "Forbidden"})
            await User.deleteOne({_id: ObjectId(userId)});
            return res.json({success: true, message: "User deleted successfully"});
        }catch(e){
            console.log(e)
            return res.status(500).json({success: false, message: "error", error: e})
        }
        
    }

}


module.exports = new UserController();
