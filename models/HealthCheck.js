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
        defaultValue: () => {
            // Get the current time in EST
            const now = new Date();
            const estOffset = -5 * 60; // Offset for EST (UTC-5)
            const estTime = new Date(now.getTime() + estOffset * 60 * 1000);
            return estTime;
        },
        allowNull: false,
    },

},
{
    timestamps: false
});

module.exports = HealthCheck;
