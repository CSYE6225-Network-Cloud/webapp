// Imports
import express from 'express';
import dotenv from 'dotenv';
import { sequelize, createDatabaseIfNotExists } from './db.js';
import healthzRoutes from './routes/healthz.js';

// Load environment variables
dotenv.config();

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT;

app.use(express.urlencoded({ extended: true }));

// Use the healthz route
app.use('/', healthzRoutes)
// Middleware to handle unimplemented routes
.use((req, res) => {
    res.status(404).send();
});

// Ensure database exists before starting
await createDatabaseIfNotExists();

// Sync database and start the server
sequelize.sync().then(() => {
    console.log('Database synchronized.');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});