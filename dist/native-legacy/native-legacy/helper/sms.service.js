class SmsService {
    async sendSMS(payload) {
        const {to, message} = payload;
        const client = require('twilio')(secrets.TWILIO_ACCOUNT_SID, secrets.TWILIO_AUTH_TOKEN)
        return new Promise(async (resolve, reject) => {
            try {
                await client.messages.create({
                    body: message,
                    to: to,
                    from: secrets.TWILIO_PHONE_NUMBER
                })
                resolve(true)
            } catch (err) {
                console.log(err.stack, err.message, "error while sending sms");
                reject(false)
            }

        })
    }
}


module.exports = new SmsService();
