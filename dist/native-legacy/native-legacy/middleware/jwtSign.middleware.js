const jwt = require("jsonwebtoken");


const generateAccessToken = (user) => {
    // user = {
    //     id: user.id,
    //     email: user.email,
    //     name: user.firstName,
    //     role: user.role
    // }
    return {
        accessToken: jwt.sign({user}, secrets.JWT_SECRET, {expiresIn: secrets.JWT_EXPIRE}),
        refreshToken: jwt.sign({user}, secrets.JWT_SECRET, {expiresIn: secrets.JWT_REFRESH_EXPIRE})
    }
};


module.exports = generateAccessToken;
