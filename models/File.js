const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');
const { v4: uuidv4 } = require('uuid');

// File model
const File = sequelize.define('Files', {
    id: {
        type: DataTypes.UUID,
        defaultValue: () => uuidv4(),
        primaryKey: true
    },
    file_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    url: {
        type: DataTypes.STRING,
        allowNull: false
    },
    upload_date: {
        type: DataTypes.DATEONLY,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: false
});

module.exports = File;