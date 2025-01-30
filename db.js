require('dotenv').config();
const { Sequelize } = require('sequelize');
const mysql = require('mysql2/promise');

// Environment variables
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;

// Function to create the database if it doesn't exist
async function createDatabaseIfNotExists() {
    try {
        const connection = await mysql.createConnection({
            host: DB_HOST,
            port: DB_PORT,
            user: DB_USER,
            password: DB_PASSWORD,
        });

        // Check if the database exists; create it if not
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
        console.log(`Database "${DB_NAME}" is ready.`);
        await connection.end();
    } catch (error) {
        console.error('Error creating database:', error);
        process.exit(1); // Exit the process on failure
    }
}

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'mysql',
    logging: false,
});

module.exports = { sequelize, createDatabaseIfNotExists };
