const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

// HealthCheck model
const HealthCheck = sequelize.define('HealthCheck', {
    CheckId: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    Datetime: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
        },
},
{
    timestamps: false
});

module.exports = HealthCheck;
