const express = require('express');
const dotenv = require('dotenv');
const { sequelize, createDatabaseIfNotExists } = require('./db.js');
const healthzRoutes = require('./routes/healthz.js');
const fileRoutes = require('./routes/file.js');

// Load environment variables
dotenv.config();

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Middleware to check for request body in GET and DELETE requests - applies to all routes
app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'DELETE') &&
        (Object.keys(req.body).length > 0 ||
            (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0))) {
        res.status(400);
        res.set('Content-Length', '0');
        return res.end();
    }
    next();
});

// Global middleware to handle HEAD requests
app.use((req, res, next) => {
    if (req.method === 'HEAD') {
        res.status(405);
        res.set('Content-Length', '0');
        return res.end();
    }
    next();
});

// Use the routes
app.use('/', healthzRoutes);
app.use('/v1', fileRoutes);

// Middleware to handle unimplemented routes
app.use((req, res) => {
    res.status(404);
    res.set('Content-Length', '0');
    res.end();
});

// Ensure database exists before starting
const startServer = async () => {
    await createDatabaseIfNotExists();
    await sequelize.sync();
    console.log('Database synchronized.');

    if (process.env.NODE_ENV !== 'test') {
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    }
};

// Start the server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
    startServer();
}

module.exports = app;