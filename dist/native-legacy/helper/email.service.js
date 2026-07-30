const sgMail = require('@sendgrid/mail');

class SendGridService {
    constructor() {
        this.sendEmail = this.sendEmail.bind(this);

    }
    sendEmail(payload) {
        sgMail.setApiKey(secrets.SENDGRID_KEY);
        if(process.env.APP_ENV !== 'prod'){
            payload.to = ['paras@bright-development.com',"timtim@bright-development.com"]
            // payload.to = ["knageotte@workforcerg.com","andrii@hierarchyadvertising.com"]
            // payload.to = ["paras@sumfactor.com","timtim@bright-development.com","andrii@hierarchyadvertising.com","andrii.baraniuk@gmail.com",'johna@bright-development.com']
        }else{
            if(payload.to !=="knageotte@workforcerg.com"){
                payload.bcc = 'knageotte@workforcerg.com'
            }
        }
        console.log(process.env.APP_ENV,"process.env.APP_ENV")
        return new Promise(async (resolve, reject) => {
            try {
                let msg;
                if(Array.isArray(payload)) {
                    msg = payload
                }else{
                   msg = {
                        // TODO: replace email with domain email
                        from: `Workforce Research Group <${secrets['sendGridDomain']}>`, // Use the email address or domain you verified above
                        ...payload
                    }
                }
                console.log(msg,"email payload")
                let result = await sgMail.send(msg);
                if(result[0].statusCode === 202) console.log(`Email sent to ${payload.to}`);
                return resolve();
            } catch (e) {
                console.log(JSON.stringify(e), "error in sendEmail")
                reject(e);
            }
        });
    }
}


module.exports = new SendGridService();
